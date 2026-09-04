-- ═══════════════════════════════════════════════════════════════════════════
-- Descrição do lançamento mostra o preço executado com 4 casas
--
-- O formato anterior arredondava para 2 casas: uma compra a 47,1471 aparecia
-- no extrato como "a 47.15". Valor em reais tem 2 casas, mas PREÇO tem 6 no
-- schema justamente porque o slippage vive nas casas seguintes — exibir 47,15
-- é mostrar ao usuário um preço que ele não pagou.
--
-- Só a descrição muda. Nenhum valor monetário é recalculado.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.execute_order_tx(
  p_user_id uuid,
  p_ticker text,
  p_side public.order_side,
  p_quantity integer,
  p_reference_price numeric,
  p_executed_price numeric,
  p_gross_amount numeric,
  p_fee_amount numeric,
  p_tax_amount numeric,
  p_net_amount numeric,
  p_realized_pnl numeric,
  p_new_avg_price numeric
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_portfolio public.portfolios;
  v_position public.positions;
  v_order public.orders;
  v_new_quantity integer;
begin
  -- Trava a carteira. Tudo abaixo depende de o saldo não mudar no meio.
  select p.* into v_portfolio
  from public.portfolios p
  join public.seasons s on s.id = p.season_id
  where p.user_id = p_user_id
    and s.is_active
  for update of p;

  if v_portfolio.id is null then
    raise exception 'NO_PORTFOLIO' using errcode = 'P0001';
  end if;

  select pos.* into v_position
  from public.positions pos
  where pos.portfolio_id = v_portfolio.id
    and pos.ticker = p_ticker
  for update;

  if p_side = 'BUY' then
    -- p_net_amount é negativo em compra; somar reduz o caixa.
    if v_portfolio.cash_balance + p_net_amount < 0 then
      raise exception 'INSUFFICIENT_CASH' using errcode = 'P0001';
    end if;

    v_new_quantity := coalesce(v_position.quantity, 0) + p_quantity;

    insert into public.positions (portfolio_id, ticker, quantity, avg_price)
    values (v_portfolio.id, p_ticker, v_new_quantity, p_new_avg_price)
    on conflict (portfolio_id, ticker) do update
      set quantity = v_new_quantity,
          avg_price = p_new_avg_price,
          updated_at = now();
  else
    if coalesce(v_position.quantity, 0) < p_quantity then
      raise exception 'INSUFFICIENT_POSITION' using errcode = 'P0001';
    end if;

    v_new_quantity := v_position.quantity - p_quantity;

    if v_new_quantity = 0 then
      -- Zerar é apagar. Manter linha com quantidade zero faria o ativo
      -- aparecer na carteira e no gráfico de alocação sem existir.
      delete from public.positions where id = v_position.id;
    else
      update public.positions
      set quantity = v_new_quantity, updated_at = now()
      where id = v_position.id;
    end if;
  end if;

  update public.portfolios
  set cash_balance = cash_balance + p_net_amount
  where id = v_portfolio.id;

  insert into public.orders (
    portfolio_id, ticker, side, quantity, status,
    reference_price, executed_price,
    gross_amount, fee_amount, tax_amount, net_amount, realized_pnl
  )
  values (
    v_portfolio.id, p_ticker, p_side, p_quantity, 'FILLED',
    p_reference_price, p_executed_price,
    p_gross_amount, p_fee_amount, p_tax_amount, p_net_amount, p_realized_pnl
  )
  returning * into v_order;

  -- Lançamentos separados por natureza, e não um único valor líquido: é o que
  -- permite responder "quanto paguei de taxa este mês" sem reprocessar ordem.
  insert into public.ledger_entries (portfolio_id, kind, amount, description, order_id)
  values (
    v_portfolio.id,
    case when p_side = 'BUY' then 'BUY'::public.ledger_kind else 'SELL'::public.ledger_kind end,
    case when p_side = 'BUY' then -p_gross_amount else p_gross_amount end,
    format('%s %s %s a %s', case when p_side = 'BUY' then 'Compra de' else 'Venda de' end,
           p_quantity, p_ticker, to_char(p_executed_price, 'FM999999990.0000')),
    v_order.id
  );

  if p_fee_amount > 0 then
    insert into public.ledger_entries (portfolio_id, kind, amount, description, order_id)
    values (v_portfolio.id, 'FEE', -p_fee_amount, format('Custo de operação · %s', p_ticker), v_order.id);
  end if;

  if p_tax_amount > 0 then
    insert into public.ledger_entries (portfolio_id, kind, amount, description, order_id)
    values (v_portfolio.id, 'TAX', -p_tax_amount, format('IR sobre lucro · %s', p_ticker), v_order.id);
  end if;

  return v_order;
end;
$$;


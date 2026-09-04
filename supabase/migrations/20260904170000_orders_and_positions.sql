-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 3 — ordens, posições e a escrita transacional
--
-- Regra que organiza tudo aqui: dinheiro só se move dentro de
-- `execute_order_tx`. As tabelas não têm policy de escrita, então RLS nega
-- por padrão, e a RPC é o único caminho.
--
-- O CÁLCULO não vive neste arquivo — vive em packages/core/src/fees.ts, que
-- o preview da boleta e a Edge Function compartilham. A RPC recebe os valores
-- já calculados e é responsável por outra coisa: garantir que a escrita
-- aconteça inteira ou não aconteça, e revalidar as invariantes de saldo e
-- quantidade sob trava.
--
-- Essa divisão é deliberada. Reimplementar arredondamento e slippage em
-- plpgsql daria duas fontes de verdade que divergem no primeiro centavo.
-- Mas confiar no cliente para o saldo daria compra a descoberto — daí a
-- revalidação sob `for update` aqui embaixo.
-- ═══════════════════════════════════════════════════════════════════════════

create type public.order_side as enum ('BUY', 'SELL');
create type public.order_status as enum ('FILLED', 'REJECTED');

-- ────────────────────────────────────────────────────────────── orders ─────

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  ticker text not null references public.assets (ticker),
  side public.order_side not null,
  quantity integer not null check (quantity > 0),
  status public.order_status not null,

  -- Preço lido do cache, separado do preço em que executou. Guardar os dois
  -- permite auditar depois quanto o slippage custou ao usuário, e dá o
  -- gancho para ordem limitada na v2 sem migrar coluna.
  reference_price numeric(18, 6),
  executed_price numeric(18, 6),

  gross_amount numeric(18, 2),
  fee_amount numeric(18, 2),
  tax_amount numeric(18, 2),
  net_amount numeric(18, 2),
  realized_pnl numeric(18, 2),

  rejection_code text,
  created_at timestamptz not null default now(),

  -- Ordem executada tem preço e valores; ordem rejeitada tem motivo. Deixar
  -- os dois estados no mesmo formato produziria linha com status FILLED e
  -- net_amount nulo, que nenhum relatório saberia somar.
  constraint orders_filled_has_amounts check (
    status <> 'FILLED'
    or (
      executed_price is not null
      and gross_amount is not null
      and fee_amount is not null
      and net_amount is not null
    )
  ),
  constraint orders_rejected_has_reason check (status <> 'REJECTED' or rejection_code is not null)
);

create index orders_portfolio_idx on public.orders (portfolio_id, created_at desc);
create index orders_ticker_idx on public.orders (ticker, created_at desc);

-- Suporta a contagem do rate limit sem varrer o histórico inteiro.
create index orders_recent_idx on public.orders (portfolio_id, created_at)
where status = 'FILLED';

-- ─────────────────────────────────────────────────────────── positions ─────

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  ticker text not null references public.assets (ticker),
  quantity integer not null check (quantity > 0),
  avg_price numeric(18, 6) not null check (avg_price > 0),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, ticker)
);

create index positions_portfolio_idx on public.positions (portfolio_id);

comment on table public.positions is
  'Posição consolidada. `quantity > 0` no check e não `>= 0`: posição zerada é DELETADA, não mantida com zero. Linha com quantidade zero apareceria na carteira e no cálculo de alocação como um ativo que o usuário não tem.';

comment on column public.positions.avg_price is
  'Preço médio já líquido do custo de entrada, calculado em packages/core. Assim o P&L exibido nasce líquido e não existe lucro que evapora na venda.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Privilégios e RLS
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on public.orders from anon, authenticated;
revoke all on public.positions from anon, authenticated;

grant select on public.orders to authenticated;
grant select on public.positions to authenticated;

alter table public.orders enable row level security;
alter table public.positions enable row level security;

create policy "orders_select_own" on public.orders
for select to authenticated
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = orders.portfolio_id
      and p.user_id = (select auth.uid())
  )
);

create policy "positions_select_own" on public.positions
for select to authenticated
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = positions.portfolio_id
      and p.user_id = (select auth.uid())
  )
);

-- Fase 1 deixou ledger_entries sem referência a ordem, porque a tabela não
-- existia. Agora existe.
alter table public.ledger_entries
  add column order_id uuid references public.orders (id) on delete set null;

create index ledger_entries_order_idx on public.ledger_entries (order_id)
where order_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- execute_order_tx
--
-- Recebe os valores já calculados em packages/core e faz a escrita atômica.
-- SECURITY DEFINER porque as tabelas são read-only para o usuário.
--
-- A revalidação sob `for update` não é redundância: entre o preview na tela e
-- a chegada aqui, o saldo pode ter mudado por outra ordem do mesmo usuário em
-- outra aba. A trava serializa as duas e a segunda vê o saldo verdadeiro.
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
           p_quantity, p_ticker, to_char(p_executed_price, 'FM999999990.00')),
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

comment on function public.execute_order_tx is
  'Escrita atômica de uma ordem. Não calcula nada — recebe de packages/core. Revalida saldo e quantidade sob `for update`, porque entre o preview e a execução o estado pode ter mudado numa outra aba do mesmo usuário.';

-- Só a Edge Function, com a secret key, chama isto. Expor a authenticated
-- deixaria o cliente escolher os valores e comprar a qualquer preço.
revoke execute on function public.execute_order_tx(
  uuid, text, public.order_side, integer,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;

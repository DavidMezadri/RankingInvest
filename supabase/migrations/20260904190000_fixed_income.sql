-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 5 — renda fixa
--
-- Mesma divisão de responsabilidade das ordens: o CÁLCULO fica em
-- packages/core/src/fixed-income.ts (contagem de dias úteis, fator de
-- acruamento, IR do resgate), e a ESCRITA fica nas RPCs abaixo, que não
-- calculam nada e revalidam saldo e estado sob trava.
--
-- Uma decisão contábil que organiza tudo: o RENDIMENTO ACRUADO NÃO É
-- LANÇAMENTO. Ele aumenta `accrued_value` diariamente, mas não entra em
-- `ledger_entries` — porque não é caixa até o resgate. Lançar juros diários
-- quebraria a invariante que soma dos lançamentos == cash_balance, que é
-- justamente o que permite auditar um saldo estranho.
--
-- Por isso o valor `FI_INTEREST` do enum `ledger_kind` fica sem uso. Foi
-- criado na Fase 1 por antecipação; a antecipação estava errada.
-- ═══════════════════════════════════════════════════════════════════════════

create type public.fi_kind as enum ('CDB', 'LCI', 'LCA', 'TESOURO');
create type public.fi_liquidity as enum ('DAILY', 'AT_MATURITY');

create table public.fixed_income_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  issuer text not null,
  kind public.fi_kind not null,
  -- Taxa anual como fração: 0.125 = 12,5% a.a. O modelo simplificado usa taxa
  -- prefixada; indexador real (CDI, IPCA) entra na v2 acrescentando
  -- `index_type` e uma tabela de série, sem mexer nesta coluna.
  annual_rate numeric(10, 6) not null check (annual_rate > 0 and annual_rate < 1),
  maturity_date date not null,
  min_investment numeric(18, 2) not null default 100 check (min_investment > 0),
  liquidity public.fi_liquidity not null,
  -- LCI e LCA são isentas de IR para pessoa física. É o principal atrativo
  -- delas, e ignorar isso faria a comparação de produtos na tela mentir.
  is_tax_exempt boolean not null default false,
  is_active boolean not null default true
);

create index fixed_income_products_active_idx on public.fixed_income_products (maturity_date)
where is_active;

create table public.fixed_income_investments (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  product_id uuid not null references public.fixed_income_products (id),
  principal numeric(18, 2) not null check (principal > 0),
  -- Valor atualizado pelo `close-day`. Começa igual ao principal: aplicar e
  -- resgatar no mesmo dia rende zero.
  accrued_value numeric(18, 2) not null check (accrued_value > 0),
  applied_on date not null,
  last_accrual_on date not null,
  redeemed_at timestamptz,
  redeem_gross numeric(18, 2),
  redeem_tax numeric(18, 2),
  redeem_net numeric(18, 2),
  created_at timestamptz not null default now(),

  constraint fi_redeemed_has_amounts check (
    redeemed_at is null
    or (redeem_gross is not null and redeem_tax is not null and redeem_net is not null)
  )
);

-- Índice parcial: o acruamento diário e o patrimônio só olham as aplicações
-- em aberto, e o histórico de resgatadas cresce para sempre.
create index fixed_income_investments_open_idx on public.fixed_income_investments (portfolio_id)
where redeemed_at is null;

create index fixed_income_investments_portfolio_idx
on public.fixed_income_investments (portfolio_id, applied_on desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- Privilégios e RLS
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on public.fixed_income_products from anon, authenticated;
revoke all on public.fixed_income_investments from anon, authenticated;

grant select on public.fixed_income_products to authenticated;
grant select on public.fixed_income_investments to authenticated;

alter table public.fixed_income_products enable row level security;
alter table public.fixed_income_investments enable row level security;

create policy "fi_products_select_all" on public.fixed_income_products
for select to authenticated
using (true);

create policy "fi_investments_select_own" on public.fixed_income_investments
for select to authenticated
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = fixed_income_investments.portfolio_id
      and p.user_id = (select auth.uid())
  )
);

alter table public.ledger_entries
  add column investment_id uuid references public.fixed_income_investments (id) on delete set null;

-- ═══════════════════════════════════════════════════════════════════════════
-- apply_fixed_income_tx
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.apply_fixed_income_tx(
  p_user_id uuid,
  p_product_id uuid,
  p_principal numeric
) returns public.fixed_income_investments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_portfolio public.portfolios;
  v_product public.fixed_income_products;
  v_investment public.fixed_income_investments;
  v_today date;
begin
  v_today := (now() at time zone 'America/Sao_Paulo')::date;

  select p.* into v_portfolio
  from public.portfolios p
  join public.seasons s on s.id = p.season_id
  where p.user_id = p_user_id and s.is_active
  for update of p;

  if v_portfolio.id is null then
    raise exception 'NO_PORTFOLIO' using errcode = 'P0001';
  end if;

  select fp.* into v_product
  from public.fixed_income_products fp
  where fp.id = p_product_id and fp.is_active;

  if v_product.id is null then
    raise exception 'PRODUCT_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Aplicar num produto já vencido não é um caso de borda teórico: o catálogo
  -- é curado e um vencimento passa sem ninguém desativar a linha.
  if v_product.maturity_date <= v_today then
    raise exception 'PRODUCT_MATURED' using errcode = 'P0001';
  end if;

  if p_principal < v_product.min_investment then
    raise exception 'BELOW_MINIMUM' using errcode = 'P0001';
  end if;

  if v_portfolio.cash_balance < p_principal then
    raise exception 'INSUFFICIENT_CASH' using errcode = 'P0001';
  end if;

  insert into public.fixed_income_investments (
    portfolio_id, product_id, principal, accrued_value, applied_on, last_accrual_on
  )
  values (v_portfolio.id, p_product_id, p_principal, p_principal, v_today, v_today)
  returning * into v_investment;

  update public.portfolios
  set cash_balance = cash_balance - p_principal
  where id = v_portfolio.id;

  insert into public.ledger_entries (portfolio_id, kind, amount, description, investment_id)
  values (
    v_portfolio.id,
    'FI_APPLY',
    -p_principal,
    format('Aplicação em %s · %s', v_product.name, v_product.issuer),
    v_investment.id
  );

  return v_investment;
end;
$$;

revoke execute on function public.apply_fixed_income_tx(uuid, uuid, numeric)
from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- redeem_fixed_income_tx
--
-- Recebe bruto, IR e líquido já calculados em packages/core. Revalida que a
-- aplicação existe, é do usuário e ainda está aberta.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.redeem_fixed_income_tx(
  p_user_id uuid,
  p_investment_id uuid,
  p_gross numeric,
  p_tax numeric,
  p_net numeric
) returns public.fixed_income_investments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_portfolio public.portfolios;
  v_investment public.fixed_income_investments;
  v_product public.fixed_income_products;
begin
  select p.* into v_portfolio
  from public.portfolios p
  join public.seasons s on s.id = p.season_id
  where p.user_id = p_user_id and s.is_active
  for update of p;

  if v_portfolio.id is null then
    raise exception 'NO_PORTFOLIO' using errcode = 'P0001';
  end if;

  select fi.* into v_investment
  from public.fixed_income_investments fi
  where fi.id = p_investment_id
    and fi.portfolio_id = v_portfolio.id
  for update;

  if v_investment.id is null then
    raise exception 'INVESTMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Trava contra resgate duplo. Dois cliques simultâneos serializam na trava
  -- acima e o segundo cai aqui, em vez de creditar o valor duas vezes.
  if v_investment.redeemed_at is not null then
    raise exception 'ALREADY_REDEEMED' using errcode = 'P0001';
  end if;

  select fp.* into v_product
  from public.fixed_income_products fp
  where fp.id = v_investment.product_id;

  if v_product.liquidity = 'AT_MATURITY'
     and (now() at time zone 'America/Sao_Paulo')::date < v_product.maturity_date then
    raise exception 'NOT_LIQUID_YET' using errcode = 'P0001';
  end if;

  update public.fixed_income_investments
  set redeemed_at = now(),
      redeem_gross = p_gross,
      redeem_tax = p_tax,
      redeem_net = p_net
  where id = v_investment.id
  returning * into v_investment;

  update public.portfolios
  set cash_balance = cash_balance + p_net
  where id = v_portfolio.id;

  -- Bruto e IR em lançamentos separados, e não só o líquido: é o que permite
  -- responder "quanto paguei de IR em renda fixa" sem reabrir cada resgate.
  insert into public.ledger_entries (portfolio_id, kind, amount, description, investment_id)
  values (
    v_portfolio.id,
    'FI_REDEEM',
    p_gross,
    format('Resgate de %s · %s', v_product.name, v_product.issuer),
    v_investment.id
  );

  if p_tax > 0 then
    insert into public.ledger_entries (portfolio_id, kind, amount, description, investment_id)
    values (
      v_portfolio.id,
      'TAX',
      -p_tax,
      format('IR sobre rendimento · %s', v_product.name),
      v_investment.id
    );
  end if;

  return v_investment;
end;
$$;

revoke execute on function public.redeem_fixed_income_tx(uuid, uuid, numeric, numeric, numeric)
from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Catálogo
--
-- Taxas prefixadas em patamar plausível para o cenário brasileiro. O par
-- LCI 11,2% isenta contra CDB 12,8% tributado existe de propósito: é a lição
-- de que taxa nominal maior não significa retorno maior.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.fixed_income_products
  (name, issuer, kind, annual_rate, maturity_date, min_investment, liquidity, is_tax_exempt)
values
  ('CDB Liquidez Diária', 'Banco Simulado S.A.', 'CDB', 0.110000, '2027-09-06', 100, 'DAILY', false),
  ('CDB 12 meses', 'Banco Simulado S.A.', 'CDB', 0.128000, '2027-09-06', 500, 'AT_MATURITY', false),
  ('CDB 24 meses', 'Banco Simulado S.A.', 'CDB', 0.135000, '2028-09-04', 1000, 'AT_MATURITY', false),
  ('CDB 36 meses', 'Banco Simulado S.A.', 'CDB', 0.140000, '2029-09-04', 1000, 'AT_MATURITY', false),
  ('LCI 12 meses', 'Banco Simulado S.A.', 'LCI', 0.112000, '2027-09-06', 1000, 'AT_MATURITY', true),
  ('LCA 24 meses', 'Banco Simulado S.A.', 'LCA', 0.118000, '2028-09-04', 1000, 'AT_MATURITY', true),
  ('Tesouro Prefixado 2029', 'Tesouro Nacional', 'TESOURO', 0.124000, '2029-01-02', 30, 'DAILY', false),
  ('Tesouro Prefixado 2031', 'Tesouro Nacional', 'TESOURO', 0.129000, '2031-01-02', 30, 'DAILY', false)
on conflict do nothing;

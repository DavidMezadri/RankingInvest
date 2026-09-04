-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 7 — curadoria pelo admin
--
-- Ativos e produtos de renda fixa passam a ser editáveis pelo painel, sem
-- SQL Editor. Só o admin, e só as colunas de curadoria: um admin não deveria
-- poder reescrever `name` de um ativo para algo que a fonte contradiz no
-- próximo sync, nem mudar a taxa de um produto onde já existe aplicação.
--
-- É a mesma lógica dos grants de coluna em `profiles`: RLS filtra linha, e
-- grant de coluna limita o que se pode escrever nela.
-- ═══════════════════════════════════════════════════════════════════════════

grant update (is_tradable, is_synced) on public.assets to authenticated;
grant update (is_active) on public.fixed_income_products to authenticated;

create policy "assets_update_admin" on public.assets
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "fi_products_update_admin" on public.fixed_income_products
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Inserir produto novo é do admin também: o catálogo de renda fixa é curado,
-- não vem de fonte externa.
grant insert on public.fixed_income_products to authenticated;

create policy "fi_products_insert_admin" on public.fixed_income_products
for insert to authenticated
with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- Visão de operação para o painel
--
-- `sync_runs` já é legível por qualquer usuário logado, mas o painel precisa
-- de contagens agregadas que seriam várias queries. Uma função resolve numa
-- chamada, e sem expor nada além de números.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_overview() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'assetsTotal', (select count(*) from public.assets),
    'assetsSynced', (select count(*) from public.assets where is_synced),
    'assetsTradable', (select count(*) from public.assets where is_tradable),
    'quotes', (select count(*) from public.quotes),
    'candles', (select count(*) from public.daily_candles),
    'holidays', (select count(*) from public.market_holidays),
    'fiProducts', (select count(*) from public.fixed_income_products where is_active),
    'openInvestments', (select count(*) from public.fixed_income_investments where redeemed_at is null),
    'filledOrders', (select count(*) from public.orders where status = 'FILLED'),
    'rejectedOrders', (select count(*) from public.orders where status = 'REJECTED'),
    'snapshots', (select count(*) from public.portfolio_snapshots),
    'lastQuoteAt', (select max(fetched_at) from public.quotes)
  )
  where public.is_admin()
$$;

comment on function public.admin_overview is
  'Contagens de operação para o painel. O `where public.is_admin()` na cláusula final faz a função devolver NULO para quem não é admin, em vez de erro — o painel já barra pela rota, e vazar contagem não deveria depender só disso.';

grant execute on function public.admin_overview() to authenticated;

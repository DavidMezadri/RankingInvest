-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 1 — dados de bootstrap
--
-- Vive numa migration, não no seed.sql: `seed.sql` só roda em `db reset`
-- local, e o ambiente remoto também precisa da temporada e das taxas para
-- que o primeiro cadastro funcione. Ambos os inserts são idempotentes, então
-- reaplicar não duplica nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── taxas e tributos: modelo simplificado ────────────────────────────────
--
-- As chaves espelham exatamente o tipo `FeeConfig` de packages/core, que é
-- quem calcula tanto o preview da boleta quanto a cobrança de verdade.
--
--   brokerageBps    corretagem em basis points (5 = 0,05%)
--   brokerageMin    piso da corretagem em R$
--   slippageBps     deslize sempre contra o usuário (10 = 0,10%)
--   equityTaxRate   IR sobre lucro na venda de ação/FII
--   fiTaxRate       IR sobre rendimento no resgate de renda fixa
--
-- ATENÇÃO: esta linha foi SUPERSEDIDA por 20260904140000_fees_trading_cost,
-- que troca corretagem de 0,05% pelo custo real da B3 de 0,0325% e renomeia
-- o campo para tradingCost. O arquivo continua aqui, inalterado, porque
-- descreve o que de fato rodou no banco — editar migration já aplicada faz
-- `db reset` divergir de produção sem ninguém perceber.
--
-- O slippage não é enfeite: a cotação da brapi chega com ~15 min de atraso,
-- e sem ele o usuário compraria de graça a notícia que já saiu. É o preço da
-- decisão de executar a mercado em vez de esperar o fechamento.
insert into public.platform_settings (key, value, effective_from)
values (
  'fees',
  jsonb_build_object(
    'brokerageBps', 5,
    'brokerageMin', 0,
    'slippageBps', 10,
    'equityTaxRate', 0.15,
    'fiTaxRate', 0.175
  ),
  '2026-01-01T00:00:00Z'
)
on conflict (key, effective_from) do nothing;

-- ─── janela de negociação ─────────────────────────────────────────────────
--
-- Checada server-side na Edge Function. Aqui para o frontend poder desabilitar
-- a boleta e explicar o motivo em vez de deixar o usuário levar um erro.
insert into public.platform_settings (key, value, effective_from)
values (
  'trading',
  jsonb_build_object(
    'opensAt', '10:00',
    'closesAt', '17:55',
    'timezone', 'America/Sao_Paulo',
    'maxQuoteAgeMinutes', 30,
    'maxOrdersPerMinute', 30
  ),
  '2026-01-01T00:00:00Z'
)
on conflict (key, effective_from) do nothing;

-- ─── primeira temporada ───────────────────────────────────────────────────
--
-- `where not exists` em vez de ON CONFLICT: a restrição de unicidade é o
-- índice parcial `seasons_single_active_idx`, que ON CONFLICT não referencia
-- por nome de coluna. Sem ends_at a temporada fica aberta por tempo
-- indeterminado, o que é o certo até o ranking existir (Fase 6).
insert into public.seasons (name, starts_at, initial_cash, is_active)
select 'Temporada 1', now(), 20000.00, true
where not exists (select 1 from public.seasons);

-- ═══════════════════════════════════════════════════════════════════════════
-- Custo por operação: 0,0325% em vez de 0,05% de corretagem
--
-- Uma LINHA NOVA em platform_settings, não um UPDATE na anterior. É para
-- isso que a tabela é versionada por `effective_from`: a função
-- `platform_setting()` devolve sempre a linha mais recente com
-- `effective_from <= now()`, e qualquer ordem executada antes desta data
-- continua explicável pela taxa que valia no dia.
--
-- Duas mudanças:
--
-- 1. Valor. 0,0325% é o custo real da B3 (emolumentos + taxa de liquidação).
--    Corretagem ficou zerada porque é o padrão de mercado hoje — corretora
--    não cobra para operar ação.
--
-- 2. Nome. `brokerageBps` → `tradingCostBps`. O número deixou de representar
--    corretagem, e um campo chamado "brokerage" guardando taxa de bolsa
--    viraria armadilha quando o modelo realista entrar: lá corretagem passa
--    a ser uma linha própria, e este campo continua significando exatamente
--    o que significa hoje.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (key, value, effective_from)
values (
  'fees',
  jsonb_build_object(
    'tradingCostBps', 3.25,
    'tradingCostMin', 0,
    'slippageBps', 10,
    'equityTaxRate', 0.15,
    'fiTaxRate', 0.175
  ),
  '2026-09-04T14:00:00Z'
)
on conflict (key, effective_from) do nothing;

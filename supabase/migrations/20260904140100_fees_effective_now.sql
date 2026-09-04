-- ═══════════════════════════════════════════════════════════════════════════
-- Corrige a vigência das taxas de 0,0325%
--
-- A migration anterior inseriu a linha com `effective_from` em
-- 2026-09-04T14:00:00Z, mas no momento do push ainda eram 13:53 UTC. Como
-- `platform_setting()` só considera `effective_from <= now()`, a função
-- continuava devolvendo a corretagem antiga de 0,05% — a versão nova estava
-- agendada para o futuro.
--
-- A linha é REMOVIDA em vez de mantida: ela nunca esteve em vigor e nenhuma
-- ordem foi precificada por ela, então não é histórico a preservar, é erro a
-- desfazer. O que merece ficar no histórico é a linha de 2026-01-01, que
-- realmente valeu por algumas horas.
--
-- Nota sobre nomes de arquivo: o timestamp da migration é só ordem de
-- aplicação, não tem relação com o `effective_from` do dado. Precisa ser
-- maior que o da migration anterior, senão o CLI acusa migration local mais
-- antiga que a remota.
-- ═══════════════════════════════════════════════════════════════════════════

delete from public.platform_settings
where key = 'fees'
  and effective_from = '2026-09-04T14:00:00Z';

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
  '2026-09-04T00:00:00Z'
)
on conflict (key, effective_from) do nothing;

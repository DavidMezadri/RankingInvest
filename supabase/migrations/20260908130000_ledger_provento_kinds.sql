-- ═══════════════════════════════════════════════════════════════════════════
-- Valores de provento no enum de lançamento
--
-- Em migration SEPARADA de propósito: `alter type ... add value` não pode ter
-- o valor novo REFERENCIADO na mesma transação que o adiciona. Como o CLI
-- aplica um arquivo por transação, separar é o que permite a migration
-- seguinte usar 'DIVIDEND' e 'JCP' num insert.
--
-- `FI_INTEREST`, criado na Fase 1 por antecipação, segue sem uso: rendimento
-- de renda fixa não é caixa até o resgate, então não é lançamento. Provento
-- É caixa, e por isso ganha valor próprio.
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.ledger_kind add value if not exists 'DIVIDEND';
alter type public.ledger_kind add value if not exists 'JCP';

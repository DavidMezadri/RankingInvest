/**
 * Constantes de domínio compartilhadas entre frontend e Edge Functions.
 * Valores que o operador pode querer mudar em produção não moram aqui — vão
 * para a tabela `platform_settings`, versionada por `effective_from`.
 */

/** Todo cálculo de calendário e janela de negociação usa este fuso. */
export const APP_TIMEZONE = 'America/Sao_Paulo';

/** Base de dias úteis do mercado brasileiro para taxas anuais. */
export const BUSINESS_DAYS_PER_YEAR = 252;

/** Casas decimais de valores em reais (espelha `numeric(18,2)` no Postgres). */
export const MONEY_DECIMALS = 2;

/** Casas decimais de preços e fatores (espelha `numeric(18,6)` no Postgres). */
export const PRICE_DECIMALS = 6;

/** Janela em que o simulador aceita ordens, em horário de Brasília. */
export const TRADING_WINDOW = {
  opensAt: '10:00',
  closesAt: '17:55',
} as const;

/** Saldo inicial padrão de uma temporada nova. */
export const DEFAULT_INITIAL_CASH = 20_000;

/**
 * Idade máxima de uma cotação para que ela possa executar uma ordem.
 * A brapi entrega com ~15–30 min de atraso; acima disso a ordem é rejeitada
 * com `STALE_QUOTE` em vez de executar contra um preço inventado.
 */
export const MAX_QUOTE_AGE_MINUTES = 30;

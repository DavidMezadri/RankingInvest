import { BUSINESS_DAYS_PER_YEAR } from './constants.ts';
import { money, price } from './money.ts';

/**
 * Renda fixa no modelo simplificado: taxa anual fixa, acruada por dia útil em
 * base 252.
 *
 * Por que dia útil e não dia corrido: é a convenção do mercado brasileiro. Um
 * CDB de 12% a.a. não rende 12/365 por dia de calendário — rende o fator de
 * um dia útil, e fim de semana não conta. Usar dias corridos daria um valor
 * plausível e errado, e o erro cresce com o prazo.
 *
 * É também por isso que `market_holidays` importa aqui muito mais que no
 * sync: um feriado faltando na tabela é um dia útil a mais na conta, e o
 * rendimento de todos os investimentos desloca.
 */

/** Limite de segurança do laço de contagem: ~55 anos. */
const MAX_DAYS_SPAN = 20_000;

function toUtcNoon(date: string): Date {
  // Meio-dia UTC, e não meia-noite: qualquer deslocamento de fuso na
  // formatação de volta continua caindo no mesmo dia do calendário.
  const parsed = new Date(`${date}T12:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Data inválida: ${date}`);
  }

  return parsed;
}

/**
 * Dias úteis no intervalo (from, to] — exclui a data inicial, inclui a final.
 *
 * A convenção importa: aplicar hoje e resgatar hoje rende zero, e o primeiro
 * rendimento aparece no dia útil seguinte. Contar a data de aplicação daria
 * um dia de juros que não existiu.
 */
export function countBusinessDays(from: string, to: string, holidays: ReadonlySet<string>): number {
  // Valida ANTES do atalho de intervalo invertido. A comparação `to <= from`
  // é de string: 'ontem' é maior que qualquer data ISO, porque 'o' > '2'. Com
  // o atalho na frente, uma data malformada retornaria 0 dias úteis em
  // silêncio — e em produção isso é dinheiro que para de render sem erro.
  const cursor = toUtcNoon(from);
  const end = toUtcNoon(to);

  if (end <= cursor) return 0;

  let count = 0;
  let guard = 0;

  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);

    guard += 1;
    if (guard > MAX_DAYS_SPAN) {
      throw new RangeError(`Intervalo implausível entre ${from} e ${to}`);
    }

    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.has(cursor.toISOString().slice(0, 10))) continue;

    count += 1;
  }

  return count;
}

function rawFactor(annualRate: number, businessDays: number): number {
  if (!Number.isFinite(annualRate) || annualRate < 0) {
    throw new RangeError(`Taxa anual inválida: ${String(annualRate)}`);
  }
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new RangeError(`Dias úteis inválidos: ${String(businessDays)}`);
  }

  return (1 + annualRate) ** (businessDays / BUSINESS_DAYS_PER_YEAR);
}

/**
 * Fator acumulado de `businessDays` dias úteis a uma taxa anual, com 6 casas.
 * É a versão para EXIBIR — o cálculo de valor usa o fator sem truncar.
 */
export function accrualFactor(annualRate: number, businessDays: number): number {
  return price(rawFactor(annualRate, businessDays));
}

/**
 * Valor de um principal após `businessDays` dias úteis.
 *
 * Multiplica pelo fator SEM arredondar antes: truncar em 6 casas e só depois
 * multiplicar joga o erro para dentro do valor, e o desvio cresce com o
 * principal. Arredondar uma vez, no fim, em reais.
 */
export function accrueValue(principal: number, annualRate: number, businessDays: number): number {
  return money(principal * rawFactor(annualRate, businessDays));
}

export type RedemptionQuote = {
  /** Valor bruto do resgate. */
  grossAmount: number;
  /** Rendimento acumulado. */
  yieldAmount: number;
  /** IR retido. Zero em LCI/LCA e em rendimento nulo. */
  taxAmount: number;
  /** Valor creditado no caixa. */
  netAmount: number;
};

export function quoteRedemption(input: {
  principal: number;
  accruedValue: number;
  isTaxExempt: boolean;
  fiTaxRate: number;
}): RedemptionQuote {
  const { principal, accruedValue, isTaxExempt, fiTaxRate } = input;

  const yieldAmount = money(accruedValue - principal);

  // O IR incide só sobre o RENDIMENTO, nunca sobre o principal. LCI e LCA são
  // isentas para pessoa física — é o principal atrativo delas, e ignorar isso
  // faria a comparação entre produtos na tela mentir.
  const taxAmount = isTaxExempt ? 0 : money(Math.max(0, yieldAmount) * fiTaxRate);

  return {
    grossAmount: money(accruedValue),
    yieldAmount,
    taxAmount,
    netAmount: money(accruedValue - taxAmount),
  };
}

export type FixedIncomeLiquidity = 'DAILY' | 'AT_MATURITY';

/**
 * Se o resgate é permitido hoje.
 *
 * Produto com liquidez no vencimento não pode ser resgatado antes — é o que
 * torna a escolha entre liquidez e taxa uma decisão de verdade no simulador,
 * em vez de um rótulo sem consequência.
 */
export function canRedeem(input: {
  liquidity: FixedIncomeLiquidity;
  maturityDate: string;
  today: string;
}): boolean {
  return input.liquidity === 'DAILY' || input.today >= input.maturityDate;
}

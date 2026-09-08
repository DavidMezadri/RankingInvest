import { money, price } from './money.ts';

/**
 * Proventos: dividendo, JCP e eventos societários.
 *
 * A B3 entrega números com vírgula decimal ("0,10000000000") e datas em
 * dd/mm/aaaa. Os dois quebram em SILÊNCIO se passados direto para `Number()`
 * e `new Date()`: o primeiro devolve NaN, e o segundo interpreta 15/09/2026
 * como 9 de março de 2027 em ambiente com locale americano. Daí os parsers
 * abaixo lançarem em vez de devolver valor plausível.
 */

/** Converte "0,10000000000" em 0.1. Aceita separador de milhar. */
export function parseBrazilianDecimal(text: string): number {
  const trimmed = text.trim();

  // Barra a string vazia ANTES de chegar ao Number, porque `Number('')`
  // devolve 0 — e não NaN. Um campo vazio vindo da B3 viraria provento de
  // zero real em vez de erro, que é o tipo de valor plausível e errado que
  // este módulo existe para recusar.
  if (trimmed === '') {
    throw new RangeError('Número brasileiro vazio');
  }

  const value = Number(trimmed.replace(/\./gu, '').replace(',', '.'));

  if (!Number.isFinite(value)) {
    throw new RangeError(`Número brasileiro inválido: ${text}`);
  }

  return value;
}

/** Converte "15/09/2026" em "2026-09-15". */
export function parseBrazilianDate(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(text.trim());

  if (!match) {
    throw new RangeError(`Data brasileira inválida: ${text}`);
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

export type ProventoKind = 'DIVIDEND' | 'JCP';

/**
 * Classifica o rótulo da B3.
 *
 * A distinção não é cosmética: dividendo é isento para pessoa física e JCP
 * tem 15% retidos na fonte. Duas empresas anunciando o mesmo "dividend yield"
 * entregam valores diferentes no bolso se uma paga via JCP — e a Petrobras,
 * que paga boa parte assim, é justamente o caso onde isso pesa.
 *
 * Rótulo desconhecido cai em DIVIDEND, que é o tratamento mais favorável ao
 * usuário. Errar para o lado de não cobrar imposto sobre algo que talvez não
 * fosse tributável é melhor que o contrário.
 */
export function classifyProvento(label: string): ProventoKind {
  const normalized = label.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/gu, '');

  // "JRS CAP PROPRIO", "JUROS SOBRE CAPITAL PROPRIO", "JCP".
  if (normalized.includes('JRS') || normalized.includes('JUROS') || normalized.includes('JCP')) {
    return 'JCP';
  }

  return 'DIVIDEND';
}

export type ProventoQuote = {
  kind: ProventoKind;
  quantity: number;
  ratePerShare: number;
  grossAmount: number;
  /** IR retido na fonte. Zero em dividendo. */
  taxAmount: number;
  netAmount: number;
};

export function quoteProvento(input: {
  kind: ProventoKind;
  quantity: number;
  ratePerShare: number;
  jcpTaxRate: number;
}): ProventoQuote {
  const { kind, quantity, ratePerShare, jcpTaxRate } = input;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError(`Quantidade inválida: ${String(quantity)}`);
  }
  if (!Number.isFinite(ratePerShare) || ratePerShare <= 0) {
    throw new RangeError(`Valor por ação inválido: ${String(ratePerShare)}`);
  }

  // Arredonda o TOTAL, não o valor unitário. A B3 informa 11 casas decimais
  // justamente porque o provento por ação é fração de centavo: arredondar
  // antes de multiplicar erraria centavos numa posição grande.
  const grossAmount = money(ratePerShare * quantity);
  const taxAmount = kind === 'JCP' ? money(grossAmount * jcpTaxRate) : 0;

  return {
    kind,
    quantity,
    ratePerShare: price(ratePerShare),
    grossAmount,
    taxAmount,
    netAmount: money(grossAmount - taxAmount),
  };
}

/**
 * Casa a classe do ticker com o código ISIN do evento.
 *
 * O endpoint da B3 devolve os proventos de TODAS as classes da empresa numa
 * resposta só. PETR3 (ON) e PETR4 (PN) recebem valores diferentes, e o que
 * distingue é o ISIN: BRPETRACNOR9 termina em `NOR` (ordinária) e
 * BRPETRACPPR1 em `PR` (preferencial). Somar tudo pagaria ao acionista de
 * PETR4 o provento da PETR3 também.
 */
export function isinMatchesTicker(isinCode: string, ticker: string): boolean {
  const suffix = /(\d{1,2})$/u.exec(ticker)?.[1];
  if (!suffix) return false;

  const isin = isinCode.toUpperCase();

  // Ordinária: 3. Preferencial: 4, 5, 6. Unit e cota de FII: 11.
  if (suffix === '3') return isin.includes('NOR') || isin.includes('ACNOR');
  if (suffix === '4' || suffix === '5' || suffix === '6') return isin.includes('PR');

  // Unit e FII têm classe única, então qualquer ISIN do emissor serve. Um FII
  // com múltiplos ISIN (emissões diferentes da mesma cota) cai aqui de
  // propósito: todas as emissões recebem o mesmo provento por cota.
  return true;
}

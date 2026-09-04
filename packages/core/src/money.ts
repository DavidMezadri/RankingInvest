import { MONEY_DECIMALS, PRICE_DECIMALS } from './constants.ts';

/**
 * Aritmética monetária determinística.
 *
 * `number` em JS é float binário: 1.005 não existe exatamente, e
 * `(1.005).toFixed(2)` devolve "1.00" porque o valor real armazenado é
 * 1.00499999999999989... Num simulador de investimentos esse viés se acumula
 * em cada taxa e cada preço médio, então todo valor que entra ou sai do banco
 * passa por `money()` ou `price()`.
 *
 * Regra adotada: ROUND_HALF_UP simétrico (0,005 → 0,01 e -0,005 → -0,01),
 * que é o arredondamento usado em notas de corretagem.
 */

function roundHalfUp(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Valor monetário inválido: ${String(value)}`);
  }

  const factor = 10 ** decimals;

  // `value * factor` arrasta o erro de representação binária:
  // 1.005 * 100 === 100.49999999999999. Reduzir a 15 dígitos significativos
  // descarta esse ruído sem mexer no valor decimal pretendido — 15 dígitos
  // cobrem com folga a faixa de `numeric(18,2)` usada no projeto.
  const scaled = Number((value * factor).toPrecision(15));

  // Math.round arredonda meio para +infinito (Math.round(-2.5) === -2).
  // Espelhar o sinal torna a regra simétrica em torno do zero.
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);

  // `+ 0` normaliza -0 para 0, evitando "-R$ 0,00" na interface.
  return rounded / factor + 0;
}

/** Arredonda para 2 casas — use em qualquer valor em reais. */
export function money(value: number): number {
  return roundHalfUp(value, MONEY_DECIMALS);
}

/** Arredonda para 6 casas — use em preços, fatores e taxas. */
export function price(value: number): number {
  return roundHalfUp(value, PRICE_DECIMALS);
}

/**
 * Soma valores em reais arredondando só no fim.
 * Arredondar a cada parcela introduz erro de até meio centavo por item.
 */
export function sumMoney(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Valor monetário inválido na soma: ${String(value)}`);
    }
    total += value;
  }
  return money(total);
}

/** Multiplica um valor em reais por um fator, arredondando o resultado. */
export function multiplyMoney(value: number, factor: number): number {
  return money(value * factor);
}

/** Aplica uma taxa em basis points (1 bps = 0,01%) sobre um valor. */
export function applyBasisPoints(value: number, basisPoints: number): number {
  return money((value * basisPoints) / 10_000);
}

/** Compara dois valores em reais após arredondamento. */
export function isSameMoney(a: number, b: number): boolean {
  return money(a) === money(b);
}

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});

/** Formata em reais: 1234.5 → "R$ 1.234,50". */
export function formatBRL(value: number): string {
  return brlFormatter.format(money(value));
}

/** Formata variação: 0.0234 → "+2,34%". Recebe fração, não percentual. */
export function formatPercent(fraction: number): string {
  return percentFormatter.format(fraction);
}

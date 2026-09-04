import { applyBasisPoints, money, price } from './money.ts';

/**
 * Motor de custos de uma ordem.
 *
 * Este módulo é a única fonte do cálculo. O preview na boleta e a cobrança na
 * Edge Function chamam a MESMA função — se fossem códigos diferentes, um dia
 * divergiriam e o usuário seria debitado de um valor que não viu na tela.
 *
 * Nada aqui lê banco, relógio ou rede. É função pura: mesma entrada, mesma
 * saída, testável até o centavo.
 */

export type FeeConfig = {
  /** Custo por operação em basis points. 3.25 = 0,0325% (emolumentos B3). */
  tradingCostBps: number;
  /** Piso do custo por operação, em reais. */
  tradingCostMin: number;
  /** Deslize aplicado sempre contra o usuário. 10 = 0,10%. */
  slippageBps: number;
  /** IR sobre lucro na venda de ação e FII. */
  equityTaxRate: number;
  /** IR sobre rendimento no resgate de renda fixa. */
  fiTaxRate: number;
};

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  tradingCostBps: 3.25,
  tradingCostMin: 0,
  slippageBps: 10,
  equityTaxRate: 0.15,
  fiTaxRate: 0.175,
};

export type OrderSide = 'BUY' | 'SELL';

export type Position = {
  quantity: number;
  /** Preço médio já líquido do custo de entrada. */
  avgPrice: number;
};

export type OrderQuote = {
  side: OrderSide;
  quantity: number;
  /** Preço lido do cache, antes do slippage. */
  referencePrice: number;
  /** Preço em que a ordem executa. */
  executedPrice: number;
  grossAmount: number;
  feeAmount: number;
  /** IR retido na venda. Zero em compra e em venda com prejuízo. */
  taxAmount: number;
  /** Efeito no caixa: negativo em compra, positivo em venda. */
  netAmount: number;
  /** Só em venda. */
  realizedPnl: number | null;
  /** Só em compra. */
  newAvgPrice: number | null;
  /** Quantidade em carteira depois da execução. */
  newQuantity: number;
};

/**
 * Preço de execução.
 *
 * O slippage existe porque a cotação em cache nasce com ~30 min de atraso: sem
 * ele, o usuário compraria de graça a notícia que já saiu. Sempre contra quem
 * opera — mais caro na compra, mais barato na venda.
 */
export function executionPrice(
  referencePrice: number,
  side: OrderSide,
  slippageBps: number,
): number {
  const factor = side === 'BUY' ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000;
  return price(referencePrice * factor);
}

/** Custo da operação, respeitando o piso. */
export function operationCost(grossAmount: number, config: FeeConfig): number {
  return money(
    Math.max(applyBasisPoints(grossAmount, config.tradingCostBps), config.tradingCostMin),
  );
}

export function quoteOrder(input: {
  side: OrderSide;
  quantity: number;
  referencePrice: number;
  /** Posição atual no ativo. `null` quando não há. */
  position: Position | null;
  config: FeeConfig;
}): OrderQuote {
  const { side, quantity, referencePrice, position, config } = input;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError(`Quantidade inválida: ${String(quantity)}`);
  }
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    throw new RangeError(`Preço de referência inválido: ${String(referencePrice)}`);
  }

  const executedPrice = executionPrice(referencePrice, side, config.slippageBps);
  const grossAmount = money(executedPrice * quantity);
  const feeAmount = operationCost(grossAmount, config);

  if (side === 'BUY') {
    const heldQuantity = position?.quantity ?? 0;
    const heldCost = money((position?.avgPrice ?? 0) * heldQuantity);
    const newQuantity = heldQuantity + quantity;

    // O preço médio absorve o custo de entrada. Assim o lucro que aparece na
    // tela já nasce líquido, e não existe ganho que evapora na hora de vender.
    const newAvgPrice = price((heldCost + grossAmount + feeAmount) / newQuantity);

    return {
      side,
      quantity,
      referencePrice,
      executedPrice,
      grossAmount,
      feeAmount,
      taxAmount: 0,
      netAmount: money(-(grossAmount + feeAmount)),
      realizedPnl: null,
      newAvgPrice,
      newQuantity,
    };
  }

  const heldQuantity = position?.quantity ?? 0;
  const avgPrice = position?.avgPrice ?? 0;

  // O custo de saída sai ANTES de apurar o lucro, pelo mesmo motivo que o de
  // entrada entra no preço médio: o resultado exibido tem de ser o que
  // sobrou de fato, não um número bruto que o IR depois desmente.
  const netProceeds = money(grossAmount - feeAmount);
  const costBasis = money(avgPrice * quantity);
  const realizedPnl = money(netProceeds - costBasis);

  // Prejuízo não gera crédito no modelo simplificado. Compensação de
  // prejuízo mês a mês é a versão realista, e entra trocando uma linha de
  // platform_settings mais um ramo aqui.
  const taxAmount = money(Math.max(0, realizedPnl) * config.equityTaxRate);

  return {
    side,
    quantity,
    referencePrice,
    executedPrice,
    grossAmount,
    feeAmount,
    taxAmount,
    netAmount: money(netProceeds - taxAmount),
    realizedPnl,
    newAvgPrice: null,
    newQuantity: heldQuantity - quantity,
  };
}

/**
 * Lê a configuração vinda de `platform_settings.value`.
 *
 * `packages/core` não tem dependência de runtime, então a validação é escrita
 * à mão em vez de delegada ao Zod. Campo ausente cai no padrão em vez de
 * lançar: taxa faltando não deve derrubar a boleta, e o padrão é conhecido.
 */
export function parseFeeConfig(value: unknown): FeeConfig {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_FEE_CONFIG;
  }

  const raw = value as Record<string, unknown>;
  const read = (key: keyof FeeConfig): number => {
    const candidate = raw[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : DEFAULT_FEE_CONFIG[key];
  };

  return {
    tradingCostBps: read('tradingCostBps'),
    tradingCostMin: read('tradingCostMin'),
    slippageBps: read('slippageBps'),
    equityTaxRate: read('equityTaxRate'),
    fiTaxRate: read('fiTaxRate'),
  };
}

// ─────────────────────────────────────────────────── rejeição de ordem ─────

export const REJECTION_CODES = [
  'MARKET_CLOSED',
  'STALE_QUOTE',
  'NO_QUOTE',
  'ASSET_NOT_TRADABLE',
  'INVALID_QUANTITY',
  'INVALID_LOT',
  'INSUFFICIENT_CASH',
  'INSUFFICIENT_POSITION',
  'NO_PORTFOLIO',
  'SEASON_ENDED',
  'RATE_LIMITED',
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];

const REJECTION_MESSAGE: Record<RejectionCode, string> = {
  MARKET_CLOSED: 'A bolsa está fechada. O simulador aceita ordens em dia útil, das 10:00 às 17:55.',
  STALE_QUOTE:
    'A cotação em cache está velha demais para executar. A sincronização deve voltar em alguns minutos.',
  NO_QUOTE: 'Este ativo ainda não tem cotação em cache.',
  ASSET_NOT_TRADABLE: 'Este ativo não está disponível para negociação.',
  INVALID_QUANTITY: 'Informe uma quantidade inteira maior que zero.',
  INVALID_LOT: 'A quantidade precisa ser múltipla do lote mínimo do ativo.',
  INSUFFICIENT_CASH: 'Saldo em caixa insuficiente para esta compra.',
  INSUFFICIENT_POSITION: 'Você não tem essa quantidade do ativo em carteira.',
  NO_PORTFOLIO: 'Você não tem carteira na temporada aberta.',
  SEASON_ENDED: 'A temporada foi encerrada. Não é possível operar.',
  RATE_LIMITED: 'Muitas ordens em sequência. Aguarde alguns segundos.',
};

/** Mensagem em português para o usuário. Usada pela boleta e pelo extrato. */
export function describeRejection(code: string): string {
  return REJECTION_MESSAGE[code as RejectionCode] ?? 'Não foi possível executar a ordem.';
}

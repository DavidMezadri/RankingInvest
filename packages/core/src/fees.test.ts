import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FEE_CONFIG,
  describeRejection,
  executionPrice,
  operationCost,
  parseFeeConfig,
  quoteOrder,
  type FeeConfig,
} from './fees.ts';
import { sumMoney } from './money.ts';

const config = DEFAULT_FEE_CONFIG;

describe('executionPrice', () => {
  it('encarece a compra e barateia a venda', () => {
    expect(executionPrice(47.32, 'BUY', 10)).toBe(47.36732);
    expect(executionPrice(47.32, 'SELL', 10)).toBe(47.27268);
  });

  it('não move o preço quando o slippage é zero', () => {
    expect(executionPrice(47.32, 'BUY', 0)).toBe(47.32);
    expect(executionPrice(47.32, 'SELL', 0)).toBe(47.32);
  });
});

describe('operationCost', () => {
  it('aplica os 0,0325% da B3', () => {
    expect(operationCost(4736.73, config)).toBe(1.54);
    expect(operationCost(10_000, config)).toBe(3.25);
  });

  it('respeita o piso quando existe', () => {
    const withFloor: FeeConfig = { ...config, tradingCostMin: 5 };
    expect(operationCost(1000, withFloor)).toBe(5);
    // Acima do piso o percentual volta a valer.
    expect(operationCost(100_000, withFloor)).toBe(32.5);
  });
});

describe('quoteOrder — compra', () => {
  const buy = quoteOrder({
    side: 'BUY',
    quantity: 100,
    referencePrice: 47.32,
    position: null,
    config,
  });

  it('executa acima do preço de referência', () => {
    expect(buy.executedPrice).toBe(47.36732);
    expect(buy.grossAmount).toBe(4736.73);
  });

  it('cobra o custo de operação e debita o caixa', () => {
    expect(buy.feeAmount).toBe(1.54);
    expect(buy.taxAmount).toBe(0);
    expect(buy.netAmount).toBe(-4738.27);
  });

  it('embute o custo de entrada no preço médio', () => {
    // (4736.73 + 1.54) / 100 — não 47.36732, que ignoraria a taxa e
    // apresentaria um lucro que desapareceria na venda.
    expect(buy.newAvgPrice).toBe(47.3827);
    expect(buy.newQuantity).toBe(100);
    expect(buy.realizedPnl).toBeNull();
  });

  it('faz média ponderada com a posição existente', () => {
    const second = quoteOrder({
      side: 'BUY',
      quantity: 50,
      referencePrice: 50,
      position: { quantity: 100, avgPrice: 47.3827 },
      config,
    });

    expect(second.executedPrice).toBe(50.05);
    expect(second.grossAmount).toBe(2502.5);
    expect(second.feeAmount).toBe(0.81);
    // (4738.27 + 2502.50 + 0.81) / 150
    expect(second.newAvgPrice).toBe(48.2772);
    expect(second.newQuantity).toBe(150);
  });
});

describe('quoteOrder — venda', () => {
  const position = { quantity: 100, avgPrice: 47.3827 };

  it('executa abaixo do preço de referência', () => {
    const sell = quoteOrder({
      side: 'SELL',
      quantity: 100,
      referencePrice: 50,
      position,
      config,
    });

    expect(sell.executedPrice).toBe(49.95);
    expect(sell.grossAmount).toBe(4995);
  });

  it('desconta o custo de saída antes de apurar o lucro', () => {
    const sell = quoteOrder({
      side: 'SELL',
      quantity: 100,
      referencePrice: 50,
      position,
      config,
    });

    // netProceeds 4993.38 − custo 4738.27. Apurar sobre o bruto daria 256.73
    // e o IR depois desmentiria o número mostrado na tela.
    expect(sell.feeAmount).toBe(1.62);
    expect(sell.realizedPnl).toBe(255.11);
    expect(sell.taxAmount).toBe(38.27);
    expect(sell.netAmount).toBe(4955.11);
    expect(sell.newQuantity).toBe(0);
    expect(sell.newAvgPrice).toBeNull();
  });

  it('não cobra IR sobre prejuízo', () => {
    const sell = quoteOrder({
      side: 'SELL',
      quantity: 100,
      referencePrice: 40,
      position,
      config,
    });

    expect(sell.realizedPnl).toBe(-743.57);
    expect(sell.taxAmount).toBe(0);
    expect(sell.netAmount).toBe(3994.7);
  });

  it('mantém o preço médio na venda parcial', () => {
    const sell = quoteOrder({
      side: 'SELL',
      quantity: 40,
      referencePrice: 50,
      position,
      config,
    });

    expect(sell.grossAmount).toBe(1998);
    expect(sell.feeAmount).toBe(0.65);
    expect(sell.realizedPnl).toBe(102.04);
    expect(sell.taxAmount).toBe(15.31);
    expect(sell.netAmount).toBe(1982.04);
    expect(sell.newQuantity).toBe(60);
  });
});

describe('invariantes', () => {
  it('o efeito líquido de um giro fechado é exatamente o lucro apurado', () => {
    // Comprar e vender ao mesmo preço de referência tem de custar apenas
    // slippage e as duas taxas — e a soma dos efeitos no caixa precisa bater
    // com o realizedPnl reportado, senão o extrato não fecha com o saldo.
    const buy = quoteOrder({
      side: 'BUY',
      quantity: 100,
      referencePrice: 47.32,
      position: null,
      config,
    });

    const sell = quoteOrder({
      side: 'SELL',
      quantity: 100,
      referencePrice: 47.32,
      position: { quantity: buy.newQuantity, avgPrice: buy.newAvgPrice ?? 0 },
      config,
    });

    expect(sell.realizedPnl).toBe(-12.54);
    // A soma passa por sumMoney: os dois valores já estão arredondados, mas
    // `+` cru devolve -12.540000000000873. É a mesma armadilha binária que o
    // módulo money existe para fechar — e vale dentro do teste também.
    expect(sumMoney([buy.netAmount, sell.netAmount])).toBe(sell.realizedPnl);
  });

  it('sem slippage e sem taxa, o giro fechado é neutro', () => {
    const free: FeeConfig = { ...config, tradingCostBps: 0, slippageBps: 0 };

    const buy = quoteOrder({
      side: 'BUY',
      quantity: 7,
      referencePrice: 13.37,
      position: null,
      config: free,
    });
    const sell = quoteOrder({
      side: 'SELL',
      quantity: 7,
      referencePrice: 13.37,
      position: { quantity: 7, avgPrice: buy.newAvgPrice ?? 0 },
      config: free,
    });

    expect(sell.realizedPnl).toBe(0);
    expect(sumMoney([buy.netAmount, sell.netAmount])).toBe(0);
  });
});

describe('quoteOrder — entradas inválidas', () => {
  const base = { side: 'BUY' as const, referencePrice: 10, position: null, config };

  it('rejeita quantidade fracionária, zero ou negativa', () => {
    expect(() => quoteOrder({ ...base, quantity: 1.5 })).toThrow(RangeError);
    expect(() => quoteOrder({ ...base, quantity: 0 })).toThrow(RangeError);
    expect(() => quoteOrder({ ...base, quantity: -10 })).toThrow(RangeError);
  });

  it('rejeita preço não positivo ou não finito', () => {
    expect(() => quoteOrder({ ...base, quantity: 1, referencePrice: 0 })).toThrow(RangeError);
    expect(() => quoteOrder({ ...base, quantity: 1, referencePrice: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('parseFeeConfig', () => {
  it('devolve o padrão para valor ausente ou inválido', () => {
    expect(parseFeeConfig(null)).toEqual(DEFAULT_FEE_CONFIG);
    expect(parseFeeConfig('taxas')).toEqual(DEFAULT_FEE_CONFIG);
    expect(parseFeeConfig(42)).toEqual(DEFAULT_FEE_CONFIG);
  });

  it('lê o que existe e completa o resto', () => {
    expect(parseFeeConfig({ tradingCostBps: 5, slippageBps: 20 })).toEqual({
      ...DEFAULT_FEE_CONFIG,
      tradingCostBps: 5,
      slippageBps: 20,
    });
  });

  it('ignora campo com tipo ou sinal errado em vez de derrubar a boleta', () => {
    const parsed = parseFeeConfig({ tradingCostBps: 'muito', slippageBps: -5, equityTaxRate: 0.2 });
    expect(parsed.tradingCostBps).toBe(DEFAULT_FEE_CONFIG.tradingCostBps);
    expect(parsed.slippageBps).toBe(DEFAULT_FEE_CONFIG.slippageBps);
    expect(parsed.equityTaxRate).toBe(0.2);
  });
});

describe('describeRejection', () => {
  it('traduz códigos conhecidos', () => {
    expect(describeRejection('INSUFFICIENT_CASH')).toContain('Saldo em caixa insuficiente');
    expect(describeRejection('STALE_QUOTE')).toContain('velha');
  });

  it('tem texto de reserva para código desconhecido', () => {
    expect(describeRejection('ALGO_NOVO')).toBe('Não foi possível executar a ordem.');
  });
});

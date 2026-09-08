import { describe, expect, it } from 'vitest';

import {
  classifyProvento,
  isinMatchesTicker,
  parseBrazilianDate,
  parseBrazilianDecimal,
  quoteProvento,
} from './proventos.ts';

describe('parseBrazilianDecimal', () => {
  it('lê o formato que a B3 devolve', () => {
    expect(parseBrazilianDecimal('0,10000000000')).toBe(0.1);
    expect(parseBrazilianDecimal('0,67407131')).toBe(0.67407131);
    expect(parseBrazilianDecimal('900,00000000000')).toBe(900);
  });

  it('lida com separador de milhar', () => {
    expect(parseBrazilianDecimal('1.234,56')).toBe(1234.56);
  });

  it('lança em vez de devolver NaN', () => {
    // `Number('0,10')` devolve NaN em silêncio, e NaN propagado por um
    // cálculo de provento viraria saldo NaN no banco.
    expect(Number('0,10')).toBeNaN();
    expect(() => parseBrazilianDecimal('zero vírgula um')).toThrow(RangeError);
    expect(() => parseBrazilianDecimal('')).toThrow(RangeError);
  });
});

describe('parseBrazilianDate', () => {
  it('converte dd/mm/aaaa em ISO', () => {
    expect(parseBrazilianDate('15/09/2026')).toBe('2026-09-15');
    expect(parseBrazilianDate('06/08/2026')).toBe('2026-08-06');
  });

  it('rejeita formato que o Date interpretaria errado', () => {
    // `new Date('15/09/2026')` em locale americano tenta mês 15 e falha, mas
    // `new Date('06/08/2026')` devolve 8 de JUNHO em silêncio — o bug pior,
    // porque não dá erro.
    expect(() => parseBrazilianDate('2026-09-15')).toThrow(RangeError);
    expect(() => parseBrazilianDate('15/9/2026')).toThrow(RangeError);
  });
});

describe('classifyProvento', () => {
  it('reconhece os rótulos reais da B3', () => {
    expect(classifyProvento('DIVIDENDO')).toBe('DIVIDEND');
    expect(classifyProvento('JRS CAP PROPRIO')).toBe('JCP');
    expect(classifyProvento('JUROS SOBRE CAPITAL PROPRIO')).toBe('JCP');
    expect(classifyProvento('RENDIMENTO')).toBe('DIVIDEND');
  });

  it('ignora acento e caixa', () => {
    expect(classifyProvento('juros sobre capital próprio')).toBe('JCP');
  });

  it('trata rótulo desconhecido como isento', () => {
    // Errar para o lado de não cobrar imposto sobre algo que talvez não
    // fosse tributável é melhor que cobrar sobre algo isento.
    expect(classifyProvento('EVENTO NOVO')).toBe('DIVIDEND');
  });
});

describe('quoteProvento', () => {
  it('credita dividendo integral', () => {
    const quote = quoteProvento({
      kind: 'DIVIDEND',
      quantity: 1000,
      ratePerShare: 0.47156696,
      jcpTaxRate: 0.15,
    });

    expect(quote.grossAmount).toBe(471.57);
    expect(quote.taxAmount).toBe(0);
    expect(quote.netAmount).toBe(471.57);
  });

  it('retém 15% no JCP', () => {
    const quote = quoteProvento({
      kind: 'JCP',
      quantity: 1000,
      ratePerShare: 0.67407131,
      jcpTaxRate: 0.15,
    });

    expect(quote.grossAmount).toBe(674.07);
    expect(quote.taxAmount).toBe(101.11);
    expect(quote.netAmount).toBe(572.96);
  });

  it('arredonda o total, não o valor unitário', () => {
    // 0,004 por ação em 1000 ações é R$ 4,00. Arredondar o unitário para 2
    // casas daria R$ 0,00 — e a B3 informa 11 casas justamente porque o
    // provento por ação costuma ser fração de centavo.
    const quote = quoteProvento({
      kind: 'DIVIDEND',
      quantity: 1000,
      ratePerShare: 0.004,
      jcpTaxRate: 0.15,
    });

    expect(quote.grossAmount).toBe(4);
  });

  it('um FII de R$ 0,10 por cota rende 1% ao mês sobre cota de R$ 10', () => {
    const quote = quoteProvento({
      kind: 'DIVIDEND',
      quantity: 500,
      ratePerShare: 0.1,
      jcpTaxRate: 0.15,
    });

    expect(quote.netAmount).toBe(50);
  });

  it('rejeita quantidade e valor inválidos', () => {
    const base = { kind: 'DIVIDEND' as const, ratePerShare: 0.1, jcpTaxRate: 0.15 };
    expect(() => quoteProvento({ ...base, quantity: 0 })).toThrow(RangeError);
    expect(() => quoteProvento({ ...base, quantity: 1.5 })).toThrow(RangeError);
    expect(() => quoteProvento({ ...base, quantity: 1, ratePerShare: 0 })).toThrow(RangeError);
  });
});

describe('isinMatchesTicker', () => {
  it('separa ordinária de preferencial', () => {
    // Os dois ISIN reais da Petrobras. Somar os dois pagaria ao acionista de
    // PETR4 o provento da PETR3 também.
    expect(isinMatchesTicker('BRPETRACNOR9', 'PETR3')).toBe(true);
    expect(isinMatchesTicker('BRPETRACNOR9', 'PETR4')).toBe(false);
    expect(isinMatchesTicker('BRPETRACPPR1', 'PETR4')).toBe(true);
    expect(isinMatchesTicker('BRPETRACPPR1', 'PETR3')).toBe(false);
  });

  it('trata classe PNA e PNB como preferencial', () => {
    expect(isinMatchesTicker('BRUSIMACPPR6', 'USIM5')).toBe(true);
    expect(isinMatchesTicker('BRBRKMACPPR5', 'BRKM5')).toBe(true);
  });

  it('aceita qualquer ISIN do emissor para unit e FII', () => {
    // Cota de FII tem classe única; emissões diferentes recebem o mesmo
    // provento por cota.
    expect(isinMatchesTicker('BRMXRFCTF008', 'MXRF11')).toBe(true);
    expect(isinMatchesTicker('BRMXRFR27M13', 'MXRF11')).toBe(true);
    expect(isinMatchesTicker('BRKLBNCDAM18', 'KLBN11')).toBe(true);
  });

  it('rejeita ticker sem classe', () => {
    expect(isinMatchesTicker('BRPETRACNOR9', 'PETR')).toBe(false);
  });
});

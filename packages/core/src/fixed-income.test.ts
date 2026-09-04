import { describe, expect, it } from 'vitest';

import {
  accrualFactor,
  accrueValue,
  canRedeem,
  countBusinessDays,
  quoteRedemption,
} from './fixed-income.ts';

// Feriados reais de 2026 usados nos testes de contagem.
const holidays = new Set(['2026-09-07', '2026-10-12', '2026-11-02', '2026-12-25']);

describe('countBusinessDays', () => {
  it('exclui a data inicial e inclui a final', () => {
    // Segunda 07/09 é feriado em 2026; a semana de 08 a 11 tem 4 dias úteis.
    expect(countBusinessDays('2026-09-07', '2026-09-11', holidays)).toBe(4);
  });

  it('aplicar e resgatar no mesmo dia rende zero dia', () => {
    expect(countBusinessDays('2026-09-04', '2026-09-04', holidays)).toBe(0);
  });

  it('não conta fim de semana', () => {
    // Sexta 04/09 → segunda 07/09: o sábado e o domingo não contam, e a
    // segunda é feriado, então sobra zero.
    expect(countBusinessDays('2026-09-04', '2026-09-07', holidays)).toBe(0);
    // Sexta 04/09 → terça 08/09: só a terça conta.
    expect(countBusinessDays('2026-09-04', '2026-09-08', holidays)).toBe(1);
  });

  it('desconta feriado no meio do intervalo', () => {
    // 09/10 (sexta) a 16/10 (sexta): 5 dias úteis, menos o feriado de 12/10.
    expect(countBusinessDays('2026-10-09', '2026-10-16', holidays)).toBe(4);
  });

  it('trata intervalo invertido como zero em vez de negativo', () => {
    expect(countBusinessDays('2026-09-11', '2026-09-04', holidays)).toBe(0);
  });

  it('a base 252 é convenção, não a contagem real do ano', () => {
    // Descoberta ao escrever este teste: 2026 tem 247 dias úteis, não 252.
    // Sem feriado nenhum o ano dá 261; os 15 feriados cadastrados descontam
    // apenas 14, porque 15/11/2026 cai num domingo.
    //
    // Isso NÃO é bug. A base 252 é a convenção do mercado brasileiro para
    // converter taxa anual em fator diário, e a contagem efetiva varia ano a
    // ano. A consequência prática: um CDB de 12,5% a.a. mantido por 2026
    // inteiro rende (1,125)^(247/252), um pouco menos que 12,5% — que é
    // exactamente como funciona na vida real.
    const raw = countBusinessDays('2025-12-31', '2026-12-31', new Set());
    expect(raw).toBe(261);
    const withHolidays = countBusinessDays(
      '2025-12-31',
      '2026-12-31',
      new Set([
        '2026-01-01',
        '2026-02-16',
        '2026-02-17',
        '2026-04-03',
        '2026-04-21',
        '2026-05-01',
        '2026-06-04',
        '2026-07-09',
        '2026-09-07',
        '2026-10-12',
        '2026-11-02',
        '2026-11-15',
        '2026-11-20',
        '2026-12-25',
        '2026-12-31',
      ]),
    );
    expect(withHolidays).toBe(247);
  });

  it('rejeita data malformada', () => {
    expect(() => countBusinessDays('ontem', '2026-09-11', holidays)).toThrow(RangeError);
  });
});

describe('accrualFactor', () => {
  it('zero dia útil não rende nada', () => {
    expect(accrualFactor(0.125, 0)).toBe(1);
  });

  it('252 dias úteis equivalem à taxa anual cheia', () => {
    expect(accrualFactor(0.125, 252)).toBe(1.125);
  });

  it('meio ano útil é a raiz do fator anual', () => {
    // (1,125)^0,5 = 1,060660…
    expect(accrualFactor(0.125, 126)).toBe(1.06066);
  });

  it('rejeita taxa negativa e dia fracionário', () => {
    expect(() => accrualFactor(-0.1, 10)).toThrow(RangeError);
    expect(() => accrualFactor(0.1, 1.5)).toThrow(RangeError);
  });
});

describe('accrueValue', () => {
  it('acrua o principal pelo fator', () => {
    expect(accrueValue(10_000, 0.125, 252)).toBe(11_250);
    expect(accrueValue(10_000, 0.125, 0)).toBe(10_000);
  });

  it('rende por dia útil, e não por dia corrido', () => {
    // 21 dias úteis a 12,5% a.a.: (1,125)^(21/252) = 1,0098636…
    // Por dia CORRIDO, os mesmos ~30 dias de calendário dariam 1,0102 —
    // plausível, e errado em R$ 5,60 num principal de R$ 10.000.
    expect(accrueValue(10_000, 0.125, 21)).toBe(10_098.64);
  });
});

describe('quoteRedemption', () => {
  it('tributa só o rendimento, nunca o principal', () => {
    const quote = quoteRedemption({
      principal: 10_000,
      accruedValue: 11_250,
      isTaxExempt: false,
      fiTaxRate: 0.175,
    });

    expect(quote.yieldAmount).toBe(1250);
    // 17,5% de 1.250, não de 11.250.
    expect(quote.taxAmount).toBe(218.75);
    expect(quote.netAmount).toBe(11_031.25);
  });

  it('isenta LCI e LCA', () => {
    const quote = quoteRedemption({
      principal: 10_000,
      accruedValue: 11_180,
      isTaxExempt: true,
      fiTaxRate: 0.175,
    });

    expect(quote.taxAmount).toBe(0);
    expect(quote.netAmount).toBe(11_180);
  });

  it('não cobra IR quando não houve rendimento', () => {
    const quote = quoteRedemption({
      principal: 10_000,
      accruedValue: 10_000,
      isTaxExempt: false,
      fiTaxRate: 0.175,
    });

    expect(quote.yieldAmount).toBe(0);
    expect(quote.taxAmount).toBe(0);
    expect(quote.netAmount).toBe(10_000);
  });

  it('um produto isento a 11,8% supera um tributado a 12,5%', () => {
    // A comparação que a tela precisa acertar: taxa nominal maior não
    // significa retorno maior quando um dos dois paga IR.
    const tributado = quoteRedemption({
      principal: 10_000,
      accruedValue: accrueValue(10_000, 0.125, 252),
      isTaxExempt: false,
      fiTaxRate: 0.175,
    });
    const isento = quoteRedemption({
      principal: 10_000,
      accruedValue: accrueValue(10_000, 0.118, 252),
      isTaxExempt: true,
      fiTaxRate: 0.175,
    });

    expect(tributado.netAmount).toBe(11_031.25);
    expect(isento.netAmount).toBe(11_180);
    expect(isento.netAmount).toBeGreaterThan(tributado.netAmount);
  });
});

describe('canRedeem', () => {
  it('liquidez diária resgata a qualquer momento', () => {
    expect(canRedeem({ liquidity: 'DAILY', maturityDate: '2030-01-01', today: '2026-09-04' })).toBe(
      true,
    );
  });

  it('liquidez no vencimento bloqueia antes da data', () => {
    expect(
      canRedeem({ liquidity: 'AT_MATURITY', maturityDate: '2030-01-01', today: '2026-09-04' }),
    ).toBe(false);
  });

  it('liquidez no vencimento libera na data e depois', () => {
    expect(
      canRedeem({ liquidity: 'AT_MATURITY', maturityDate: '2026-09-04', today: '2026-09-04' }),
    ).toBe(true);
    expect(
      canRedeem({ liquidity: 'AT_MATURITY', maturityDate: '2026-09-04', today: '2026-09-05' }),
    ).toBe(true);
  });
});

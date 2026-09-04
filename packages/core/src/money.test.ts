import { describe, expect, it } from 'vitest';

import {
  applyBasisPoints,
  formatBRL,
  formatPercent,
  isSameMoney,
  money,
  multiplyMoney,
  price,
  sumMoney,
} from './money.ts';

/** Intl usa espaço estreito não separável entre símbolo e número. */
const normalizeSpaces = (value: string) => value.replace(/\s/gu, ' ');

describe('money', () => {
  it('arredonda meio centavo para cima, onde toFixed erra', () => {
    // (1.005).toFixed(2) === "1.00" — este é o bug que a função existe para evitar.
    expect(money(1.005)).toBe(1.01);
    expect(money(2.675)).toBe(2.68);
    expect(money(8.335)).toBe(8.34);
  });

  it('arredonda simetricamente em torno do zero', () => {
    expect(money(-1.005)).toBe(-1.01);
    expect(money(-2.675)).toBe(-2.68);
  });

  it('normaliza -0 para 0', () => {
    expect(money(-0.001)).toBe(0);
    expect(Object.is(money(-0.001), -0)).toBe(false);
  });

  it('absorve o erro clássico de soma binária', () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(0.07 * 3)).toBe(0.21);
  });

  it('não arredonda o que já está exato', () => {
    expect(money(1.004)).toBe(1);
    expect(money(20_000)).toBe(20_000);
    expect(money(1234.56)).toBe(1234.56);
  });

  it('mantém precisão na faixa de numeric(18,2)', () => {
    expect(money(10_000_000_000.005)).toBe(10_000_000_000.01);
  });

  it('rejeita valores não finitos em vez de propagar NaN', () => {
    expect(() => money(Number.NaN)).toThrow(RangeError);
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('price', () => {
  it('mantém 6 casas decimais', () => {
    expect(price(10.123456789)).toBe(10.123457);
    expect(price(1 / 3)).toBe(0.333333);
  });
});

describe('sumMoney', () => {
  it('arredonda só no fim, sem acumular erro por parcela', () => {
    // Arredondando parcela por parcela daria 3 × 0,34 = 1,02.
    expect(sumMoney([1 / 3, 1 / 3, 1 / 3])).toBe(1);
  });

  it('soma lista vazia como zero', () => {
    expect(sumMoney([])).toBe(0);
  });

  it('soma débitos e créditos de um extrato', () => {
    expect(sumMoney([20_000, -1500.37, -0.75, 1502.1])).toBe(20_000.98);
  });
});

describe('multiplyMoney', () => {
  it('multiplica quantidade por preço', () => {
    expect(multiplyMoney(28.735, 100)).toBe(2873.5);
    expect(multiplyMoney(10.005, 3)).toBe(30.02);
  });
});

describe('applyBasisPoints', () => {
  it('converte basis points em valor', () => {
    // 5 bps = 0,05% sobre R$ 10.000
    expect(applyBasisPoints(10_000, 5)).toBe(5);
    expect(applyBasisPoints(2873.5, 5)).toBe(1.44);
  });

  it('devolve zero quando a taxa é zero', () => {
    expect(applyBasisPoints(10_000, 0)).toBe(0);
  });
});

describe('isSameMoney', () => {
  it('compara após arredondar', () => {
    expect(isSameMoney(0.1 + 0.2, 0.3)).toBe(true);
    expect(isSameMoney(1.004, 1.001)).toBe(true);
    expect(isSameMoney(1.004, 1.006)).toBe(false);
  });
});

describe('formatação', () => {
  it('formata reais no padrão brasileiro', () => {
    expect(normalizeSpaces(formatBRL(1234.5))).toBe('R$ 1.234,50');
    expect(normalizeSpaces(formatBRL(-98.7))).toBe('-R$ 98,70');
    expect(normalizeSpaces(formatBRL(20_000))).toBe('R$ 20.000,00');
  });

  it('formata variação com sinal explícito', () => {
    expect(formatPercent(0.0234)).toBe('+2,34%');
    expect(formatPercent(-0.0234)).toBe('-2,34%');
    expect(formatPercent(0)).toBe('0,00%');
  });
});

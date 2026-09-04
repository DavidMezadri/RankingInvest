import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatTime } from './datetime.ts';

describe('formatação de data no fuso do mercado', () => {
  it('formata no padrão brasileiro', () => {
    // 14:32 em Brasília = 17:32 UTC
    expect(formatDateTime('2026-09-04T17:32:00Z')).toBe('04/09/2026 14:32');
    expect(formatDate('2026-09-04T17:32:00Z')).toBe('04/09/2026');
    expect(formatTime('2026-09-04T17:32:00Z')).toBe('14:32');
  });

  it('não adianta o dia numa operação da noite', () => {
    // 21:00 de 04/09 em Brasília é 00:00 de 05/09 em UTC. Formatar em UTC
    // mostraria o dia seguinte no extrato — o bug que este módulo evita.
    expect(formatDateTime('2026-09-05T00:00:00Z')).toBe('04/09/2026 21:00');
    expect(formatDate('2026-09-05T00:00:00Z')).toBe('04/09/2026');
  });

  it('não atrasa o dia numa operação da manhã', () => {
    // 10:00 em Brasília = 13:00 UTC, mesmo dia nos dois.
    expect(formatDate('2026-09-04T13:00:00Z')).toBe('04/09/2026');
  });

  it('aceita Date além de string', () => {
    expect(formatDate(new Date('2026-09-04T17:32:00Z'))).toBe('04/09/2026');
  });

  it('rejeita data inválida em vez de renderizar "Invalid Date"', () => {
    expect(() => formatDate('não é data')).toThrow(RangeError);
    expect(() => formatDateTime('')).toThrow(RangeError);
  });
});

/**
 * Janela de negociação da B3, em horário de Brasília.
 *
 * Isto é controle de custo antes de ser regra de negócio: rodar o sync 24/7
 * multiplicaria as requisições por três sem trazer um preço novo, porque
 * fora da sessão o mercado não muda. Feriado entra na mesma conta.
 */

export const MARKET_TIMEZONE = 'America/Sao_Paulo';

export type MarketClock = {
  /** YYYY-MM-DD no fuso do mercado. */
  date: string;
  /** Minutos desde a meia-noite, no fuso do mercado. */
  minutes: number;
  /** 0 = domingo. */
  weekday: number;
};

export function readMarketClock(now: Date = new Date()): MarketClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // 'en-CA' com hour12:false devolve 24 para a meia-noite; normalizar evita
  // que 00:15 seja lido como 1455 minutos.
  const hour = Number(get('hour')) % 24;

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number(get('minute')),
    weekday: Math.max(0, weekdays.indexOf(get('weekday'))),
  };
}

export type MarketWindow = {
  /** "HH:MM" */
  opensAt: string;
  /** "HH:MM" */
  closesAt: string;
};

function toMinutes(hhmm: string): number {
  const [hours = '0', minutes = '0'] = hhmm.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export type MarketStatus =
  | { open: true; clock: MarketClock }
  | { open: false; clock: MarketClock; reason: 'WEEKEND' | 'HOLIDAY' | 'OUTSIDE_HOURS' };

export function getMarketStatus(
  window: MarketWindow,
  holidays: ReadonlySet<string>,
  now: Date = new Date(),
): MarketStatus {
  const clock = readMarketClock(now);

  if (clock.weekday === 0 || clock.weekday === 6) {
    return { open: false, clock, reason: 'WEEKEND' };
  }

  if (holidays.has(clock.date)) {
    return { open: false, clock, reason: 'HOLIDAY' };
  }

  // Uma folga de 10 min antes da abertura e depois do fechamento captura o
  // preço de leilão sem esticar a janela de verdade.
  const opens = toMinutes(window.opensAt) - 10;
  const closes = toMinutes(window.closesAt) + 10;

  if (clock.minutes < opens || clock.minutes > closes) {
    return { open: false, clock, reason: 'OUTSIDE_HOURS' };
  }

  return { open: true, clock };
}

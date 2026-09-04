import { APP_TIMEZONE } from './constants.ts';

/**
 * Formatação de data e hora no fuso do mercado.
 *
 * Todo timestamp é armazenado em UTC. Formatar sem fixar o fuso usaria o do
 * navegador — e para um usuário fora do Brasil, ou com relógio configurado em
 * UTC, uma ordem das 21:00 de segunda apareceria como terça. Em extrato de
 * carteira isso não é detalhe estético: muda o dia da operação.
 */

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: APP_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});

function toDate(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Data inválida: ${String(value)}`);
  }

  return date;
}

/**
 * 04/09/2026 14:32
 *
 * Composto a partir dos dois formatadores em vez de um único com `hour` e
 * `minute`: o pt-BR do Intl insere vírgula entre data e hora
 * ("04/09/2026, 14:32"), o que atrapalha o alinhamento em coluna de tabela.
 */
export function formatDateTime(value: string | Date): string {
  const date = toDate(value);
  return `${dateFormatter.format(date)} ${timeFormatter.format(date)}`;
}

/** 04/09/2026 */
export function formatDate(value: string | Date): string {
  return dateFormatter.format(toDate(value));
}

/** 14:32 */
export function formatTime(value: string | Date): string {
  return timeFormatter.format(toDate(value));
}

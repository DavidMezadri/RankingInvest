/**
 * Provedores de cotação, atrás de uma interface única.
 *
 * Yahoo é primário: sem token, sem cota mensal, e o endpoint de chart devolve
 * preço atual E série histórica na mesma resposta — o backfill de candles não
 * custa requisição extra.
 *
 * brapi é reserva. Não é substituta à altura (15.000 req/mês contra ~50.700
 * que 151 tickers a cada 30 min consomem), e isso é deliberado: em
 * contingência o simulador degrada em frequência, não em disponibilidade.
 *
 * A regra que ambos respeitam: `quotedAt` é o momento em que a FONTE apurou o
 * preço, nunca o momento do fetch. É esse valor que decide entre executar uma
 * ordem e rejeitar com STALE_QUOTE, então mentir aqui seria mentir no preço.
 */

export type DailyCandle = {
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export type QuoteSnapshot = {
  ticker: string;
  price: number;
  prevClose: number | null;
  changePct: number | null;
  volume: number | null;
  quotedAt: string; // ISO 8601
  source: string;
  candles: DailyCandle[];
};

export type QuoteProvider = {
  readonly name: string;
  fetchQuote(ticker: string): Promise<QuoteSnapshot>;
};

/** Arredonda para 6 casas, igual a `price()` de packages/core. */
function toPrice(value: number): number {
  return Number((Number((value * 1e6).toPrecision(15)) / 1e6).toFixed(6));
}

function requirePositive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} ausente ou inválido`);
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Converte epoch em segundos para a data no fuso do mercado (YYYY-MM-DD). */
function toMarketDate(epochSeconds: number): string {
  // 'en-CA' entrega ISO (YYYY-MM-DD) já convertido para o fuso pedido, o que
  // evita reimplementar a conversão de horário de verão à mão.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSeconds * 1000));
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return await response.json();
}

// ─────────────────────────────────────────────────────────────── Yahoo ─────

type YahooChart = {
  chart?: {
    result?: {
      meta?: Record<string, unknown>;
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
    error?: { description?: string } | null;
  };
};

export const yahooProvider: QuoteProvider = {
  name: 'yahoo',

  async fetchQuote(ticker) {
    // range=3mo dá candles suficientes para o gráfico sem custo adicional:
    // a mesma resposta traz o preço atual em `meta`.
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.SA` +
      `?interval=1d&range=3mo`;

    // Sem User-Agent de navegador o Yahoo responde 403.
    const payload = (await fetchJson(url, { 'User-Agent': BROWSER_UA })) as YahooChart;

    const result = payload.chart?.result?.[0];
    if (!result?.meta) {
      throw new Error(payload.chart?.error?.description ?? 'resposta sem resultado');
    }

    const meta = result.meta;
    const price = requirePositive(meta.regularMarketPrice, 'regularMarketPrice');
    const quotedAtEpoch = optionalNumber(meta.regularMarketTime);

    const candles: DailyCandle[] = [];
    const series = result.indicators?.quote?.[0];
    const stamps = result.timestamp ?? [];

    for (let i = 0; i < stamps.length; i += 1) {
      const stamp = stamps[i];
      const close = series?.close?.[i];
      // Dia sem negócio vem com null em toda a série. Gravar isso quebraria o
      // check `close > 0` e sujaria o gráfico com buracos falsos.
      if (typeof stamp !== 'number' || typeof close !== 'number' || close <= 0) continue;

      candles.push({
        date: toMarketDate(stamp),
        open: optionalNumber(series?.open?.[i]),
        high: optionalNumber(series?.high?.[i]),
        low: optionalNumber(series?.low?.[i]),
        close: toPrice(close),
        volume: optionalNumber(series?.volume?.[i]),
      });
    }

    return {
      ticker,
      price: toPrice(price),
      prevClose: optionalNumber(meta.chartPreviousClose ?? meta.previousClose),
      changePct: optionalNumber(meta.regularMarketChangePercent),
      volume: optionalNumber(meta.regularMarketVolume),
      quotedAt: new Date((quotedAtEpoch ?? Date.now() / 1000) * 1000).toISOString(),
      source: 'yahoo',
      candles,
    };
  },
};

// ─────────────────────────────────────────────────────────────── brapi ─────

type BrapiQuote = {
  results?: {
    regularMarketPrice?: unknown;
    regularMarketPreviousClose?: unknown;
    regularMarketChangePercent?: unknown;
    regularMarketVolume?: unknown;
    regularMarketTime?: unknown;
    historicalDataPrice?: {
      date?: unknown;
      open?: unknown;
      high?: unknown;
      low?: unknown;
      close?: unknown;
      volume?: unknown;
    }[];
  }[];
  error?: boolean;
  message?: string;
};

export function createBrapiProvider(token: string): QuoteProvider {
  return {
    name: 'brapi',

    async fetchQuote(ticker) {
      const url =
        `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}` +
        `?range=3mo&interval=1d&token=${encodeURIComponent(token)}`;

      const payload = (await fetchJson(url)) as BrapiQuote;
      const result = payload.results?.[0];

      if (!result) {
        throw new Error(payload.message ?? 'resposta sem resultado');
      }

      const price = requirePositive(result.regularMarketPrice, 'regularMarketPrice');

      const candles: DailyCandle[] = [];
      for (const row of result.historicalDataPrice ?? []) {
        const close = optionalNumber(row.close);
        const stamp = optionalNumber(row.date);
        if (close === null || close <= 0 || stamp === null) continue;

        candles.push({
          date: toMarketDate(stamp),
          open: optionalNumber(row.open),
          high: optionalNumber(row.high),
          low: optionalNumber(row.low),
          close: toPrice(close),
          volume: optionalNumber(row.volume),
        });
      }

      const quotedAt =
        typeof result.regularMarketTime === 'string'
          ? new Date(result.regularMarketTime).toISOString()
          : new Date().toISOString();

      return {
        ticker,
        price: toPrice(price),
        prevClose: optionalNumber(result.regularMarketPreviousClose),
        changePct: optionalNumber(result.regularMarketChangePercent),
        volume: optionalNumber(result.regularMarketVolume),
        quotedAt,
        source: 'brapi',
        candles,
      };
    },
  };
}

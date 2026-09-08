import { money, sumMoney, type Enums, type Tables } from '@m8invest/core';

import { getSupabaseClient } from '@/lib/supabase';

export type MarketRow = {
  ticker: string;
  name: string;
  type: Enums<'asset_type'>;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  /**
   * Volume em reais: preço × quantidade.
   *
   * É o que mede liquidez. Ordenar por contagem de ações colocaria papel de
   * centavos no topo — 12 M de ações a R$ 5 giram menos dinheiro que 2 M a
   * R$ 50.
   */
  financialVolume: number | null;
  quotedAt: string | null;
};

export type MarketSnapshot = {
  rows: MarketRow[];
  lastSync: Tables<'sync_runs'> | null;
};

/**
 * Ativos com a última cotação conhecida.
 *
 * Duas queries e um join em memória, em vez de embedding do PostgREST: são 151
 * linhas de cada lado, o custo é irrelevante, e evita depender de o PostgREST
 * inferir que `quotes.ticker` é relação um-para-um — o que muda a forma da
 * resposta entre objeto e array e quebra o tipo sem aviso.
 */
export async function fetchMarket(): Promise<MarketSnapshot> {
  const supabase = getSupabaseClient();

  const [assets, quotes, lastSync] = await Promise.all([
    supabase.from('assets').select('ticker, name, type').eq('is_tradable', true).order('ticker'),
    supabase.from('quotes').select('ticker, price, change_pct, volume, quoted_at'),
    supabase
      .from('sync_runs')
      .select('*')
      .eq('job', 'sync-quotes')
      .in('status', ['OK', 'PARTIAL'])
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (assets.error) throw new Error(assets.error.message);
  if (quotes.error) throw new Error(quotes.error.message);

  const byTicker = new Map((quotes.data ?? []).map((quote) => [quote.ticker, quote]));

  const rows: MarketRow[] = (assets.data ?? []).map((asset) => {
    const quote = byTicker.get(asset.ticker);
    return {
      ticker: asset.ticker,
      name: asset.name,
      type: asset.type,
      price: quote?.price ?? null,
      changePct: quote?.change_pct ?? null,
      volume: quote?.volume ?? null,
      financialVolume:
        quote?.volume != null && quote.price != null ? money(quote.volume * quote.price) : null,
      quotedAt: quote?.quoted_at ?? null,
    };
  });

  return { rows, lastSync: lastSync.data ?? null };
}

export type AssetDetail = {
  asset: Tables<'assets'>;
  quote: Tables<'quotes'> | null;
  candles: Tables<'daily_candles'>[];
  events: Tables<'corporate_events'>[];
  /**
   * Dividend yield dos últimos 12 meses: soma dos proventos por ação dividida
   * pelo preço atual.
   *
   * Calculado a partir dos dados oficiais da B3, e não copiado do indicador
   * de um terceiro — assim o número na tela é reproduzível a partir da tabela
   * de eventos que está logo abaixo dele.
   *
   * `null` sem cotação ou sem provento no período: DY de zero afirmaria que o
   * ativo não paga, quando pode ser que apenas não tenhamos o dado.
   */
  dividendYield12m: number | null;
  /** Soma dos proventos por ação nos últimos 12 meses. */
  dividends12m: number;
};

export async function fetchAsset(ticker: string): Promise<AssetDetail | null> {
  const supabase = getSupabaseClient();

  const { data: asset, error: assetError } = await supabase
    .from('assets')
    .select('*')
    .eq('ticker', ticker)
    .maybeSingle();

  if (assetError) throw new Error(assetError.message);
  if (!asset) return null;

  const [quote, candles, events] = await Promise.all([
    supabase.from('quotes').select('*').eq('ticker', ticker).maybeSingle(),
    supabase
      .from('daily_candles')
      .select('*')
      .eq('ticker', ticker)
      .order('date', { ascending: true }),
    supabase
      .from('corporate_events')
      .select('*')
      .eq('ticker', ticker)
      .order('ex_date', { ascending: false })
      .limit(40),
  ]);

  if (candles.error) throw new Error(candles.error.message);
  if (events.error) throw new Error(events.error.message);

  const rows = events.data ?? [];
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

  const dividends12m = sumMoney(
    rows
      .filter(
        (row) =>
          (row.kind === 'DIVIDEND' || row.kind === 'JCP') &&
          row.rate_per_share !== null &&
          row.ex_date >= oneYearAgo,
      )
      .map((row) => row.rate_per_share ?? 0),
  );

  const price = quote.data?.price ?? null;

  return {
    asset,
    quote: quote.data ?? null,
    candles: candles.data ?? [],
    events: rows,
    dividends12m,
    dividendYield12m: price !== null && price > 0 && dividends12m > 0 ? dividends12m / price : null,
  };
}

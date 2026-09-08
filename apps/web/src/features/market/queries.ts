import { money, type Enums, type Tables } from '@m8invest/core';

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

  const [quote, candles] = await Promise.all([
    supabase.from('quotes').select('*').eq('ticker', ticker).maybeSingle(),
    supabase
      .from('daily_candles')
      .select('*')
      .eq('ticker', ticker)
      .order('date', { ascending: true }),
  ]);

  if (candles.error) throw new Error(candles.error.message);

  return { asset, quote: quote.data ?? null, candles: candles.data ?? [] };
}

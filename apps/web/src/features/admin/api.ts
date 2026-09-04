import type { Tables } from '@m8invest/core';

import { getSupabaseClient } from '@/lib/supabase';

export type AdminOverview = {
  users: number;
  assetsTotal: number;
  assetsSynced: number;
  assetsTradable: number;
  quotes: number;
  candles: number;
  holidays: number;
  fiProducts: number;
  openInvestments: number;
  filledOrders: number;
  rejectedOrders: number;
  snapshots: number;
  lastQuoteAt: string | null;
};

export type AdminData = {
  overview: AdminOverview | null;
  seasons: Tables<'seasons'>[];
  runs: Tables<'sync_runs'>[];
  products: Tables<'fixed_income_products'>[];
};

export async function fetchAdmin(): Promise<AdminData> {
  const supabase = getSupabaseClient();

  const [overview, seasons, runs, products] = await Promise.all([
    supabase.rpc('admin_overview'),
    supabase.from('seasons').select('*').order('starts_at', { ascending: false }),
    supabase.from('sync_runs').select('*').order('id', { ascending: false }).limit(20),
    supabase.from('fixed_income_products').select('*').order('annual_rate', { ascending: false }),
  ]);

  if (seasons.error) throw new Error(seasons.error.message);

  return {
    // A RPC devolve NULO para quem não é admin, em vez de erro — a tela trata
    // como "sem permissão" sem precisar interpretar código de erro.
    overview: (overview.data as AdminOverview | null) ?? null,
    seasons: seasons.data ?? [],
    runs: runs.data ?? [],
    products: products.data ?? [],
  };
}

export async function openSeason(name: string, initialCash: number): Promise<void> {
  const { error } = await getSupabaseClient().rpc('open_season', {
    p_name: name,
    p_initial_cash: initialCash,
  });
  if (error) throw new Error(error.message);
}

export async function closeSeason(seasonId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('close_season', { p_season_id: seasonId });
  if (error) throw new Error(error.message);
}

export async function toggleProduct(productId: string, isActive: boolean): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('fixed_income_products')
    .update({ is_active: isActive })
    .eq('id', productId);
  if (error) throw new Error(error.message);
}

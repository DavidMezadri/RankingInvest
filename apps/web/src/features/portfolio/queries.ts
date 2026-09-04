import type { Tables } from '@m8invest/core';

import { getSupabaseClient } from '@/lib/supabase';

export type Dashboard = {
  season: Tables<'seasons'> | null;
  portfolio: Tables<'portfolios'> | null;
  ledger: Tables<'ledger_entries'>[];
};

/**
 * Carrega o estado da carteira do usuário na temporada aberta.
 *
 * Em três queries e não numa só com embedding: a distinção entre "não existe
 * temporada aberta" e "existe temporada mas o usuário não tem carteira nela"
 * precisa aparecer na interface, e um join interno colapsaria os dois casos
 * em `null`. São dois problemas diferentes com soluções diferentes.
 *
 * Nenhuma query filtra por usuário — a RLS já limita ao dono. Filtrar aqui
 * seria redundante e daria a falsa impressão de que a segurança está no
 * cliente.
 */
export async function fetchDashboard(): Promise<Dashboard> {
  const supabase = getSupabaseClient();

  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();

  if (seasonError) throw new Error(seasonError.message);
  if (!season) return { season: null, portfolio: null, ledger: [] };

  const { data: portfolio, error: portfolioError } = await supabase
    .from('portfolios')
    .select('*')
    .eq('season_id', season.id)
    .maybeSingle();

  if (portfolioError) throw new Error(portfolioError.message);
  if (!portfolio) return { season, portfolio: null, ledger: [] };

  const { data: ledger, error: ledgerError } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('portfolio_id', portfolio.id)
    .order('occurred_at', { ascending: false })
    .limit(50);

  if (ledgerError) throw new Error(ledgerError.message);

  return { season, portfolio, ledger: ledger ?? [] };
}

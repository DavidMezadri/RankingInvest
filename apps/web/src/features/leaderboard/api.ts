import type { Tables } from '@m8invest/core';

import { getSupabaseClient } from '@/lib/supabase';

export type LeaderboardRow = {
  rank: number;
  displayName: string;
  avatarUrl: string | null;
  seasonName: string;
  asOf: string;
  totalValue: number;
  initialCash: number;
  returnPct: number;
  isMe: boolean;
};

export type Leaderboard = {
  rows: LeaderboardRow[];
  /** Perfil do usuário, para editar o nome exibido no ranking. */
  profile: Tables<'profiles'> | null;
  /** Temporadas encerradas, para consultar o resultado passado. */
  pastSeasons: Tables<'seasons'>[];
};

export async function fetchLeaderboard(): Promise<Leaderboard> {
  const supabase = getSupabaseClient();

  const [board, profile, seasons] = await Promise.all([
    supabase.from('leaderboard').select('*').order('rank'),
    supabase.from('profiles').select('*').maybeSingle(),
    supabase
      .from('seasons')
      .select('*')
      .eq('is_active', false)
      .order('ends_at', { ascending: false }),
  ]);

  if (board.error) throw new Error(board.error.message);

  const rows: LeaderboardRow[] = (board.data ?? []).flatMap((row) => {
    // A view é gerada pelo Postgres e todas as colunas chegam anuláveis nos
    // tipos. Descartar linha incompleta é melhor que renderizar "—" num
    // ranking: uma posição sem valor não tem lugar na classificação.
    if (
      row.rank === null ||
      row.display_name === null ||
      row.total_value === null ||
      row.return_pct === null
    ) {
      return [];
    }

    return [
      {
        rank: Number(row.rank),
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        seasonName: row.season_name ?? '',
        asOf: row.as_of ?? '',
        totalValue: row.total_value,
        initialCash: row.initial_cash ?? 0,
        returnPct: row.return_pct,
        isMe: row.is_me ?? false,
      },
    ];
  });

  return { rows, profile: profile.data ?? null, pastSeasons: seasons.data ?? [] };
}

/**
 * Troca o nome exibido no ranking.
 *
 * A RLS permite UPDATE só na própria linha, e o grant de coluna limita a
 * `display_name` e `avatar_url` — então nem o cliente nem um bug aqui
 * conseguem mexer em `is_admin` ou `created_at`.
 */
export async function updateDisplayName(displayName: string): Promise<void> {
  const supabase = getSupabaseClient();
  const trimmed = displayName.trim();

  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new Error('O nome precisa ter entre 1 e 40 caracteres.');
  }

  const { data: profile } = await supabase.from('profiles').select('id').maybeSingle();
  if (!profile) throw new Error('Perfil não encontrado.');

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: trimmed })
    .eq('id', profile.id);

  if (error) throw new Error(error.message);
}

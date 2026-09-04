import { formatBRL, formatDate, formatPercent } from '@m8invest/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Trophy } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchLeaderboard, updateDisplayName } from '@/features/leaderboard/api';
import { cn } from '@/lib/utils';

/** Heurística simples: nome que veio da parte local de um e-mail. */
function looksLikeEmailHandle(name: string): boolean {
  return /[._-]/.test(name) && !name.includes(' ');
}

export function RankingPage() {
  const [editing, setEditing] = useState(false);
  const [nameText, setNameText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const board = useQuery({ queryKey: ['leaderboard'], queryFn: fetchLeaderboard });

  const rename = useMutation({
    mutationFn: () => updateDisplayName(nameText),
    onSuccess: async () => {
      setEditing(false);
      setError(null);
      await queryClient.invalidateQueries();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const data = board.data;
  const myName = data?.profile?.display_name ?? '';
  const asOf = data?.rows[0]?.asOf ?? '';
  const seasonName = data?.rows[0]?.seasonName ?? '';

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ranking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {seasonName ? `${seasonName} · ` : ''}
          {asOf
            ? `apurado no fechamento de ${formatDate(asOf)}`
            : 'Aguardando o primeiro fechamento'}
        </p>
      </div>

      {/* O ranking é do fechamento, não do valor ao vivo. Dizer isso evita a
          pergunta "por que minha posição não mudou depois da compra". */}
      <p className="mb-6 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        A classificação é apurada no fechamento de cada dia útil, não em tempo real — operações de
        hoje aparecem no ranking amanhã. É assim que competição de investimento funciona: o
        resultado se apura no fechamento.
      </p>

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Seu nome no ranking</h2>

        {editing ? (
          <div className="flex max-w-sm flex-col gap-2 sm:flex-row">
            <Input
              value={nameText}
              onChange={(event) => setNameText(event.target.value)}
              maxLength={40}
              placeholder="Como você quer aparecer"
              aria-label="Nome no ranking"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={rename.isPending || nameText.trim() === ''}
                onClick={() => {
                  rename.mutate();
                }}
              >
                {rename.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Salvar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="font-medium">{myName || '—'}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNameText(myName);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden />
              Alterar
            </Button>
          </div>
        )}

        {error ? <p className="mt-2 text-sm text-loss">{error}</p> : null}

        {/* Aviso com motivo concreto: o nome padrão vem da parte local do
            e-mail, e quem não trocar acaba expondo isso a todo mundo que
            entrar no ranking. */}
        {!editing && looksLikeEmailHandle(myName) ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Este nome foi criado a partir do seu e-mail no primeiro acesso. Todos que abrirem o
            ranking vão vê-lo — vale trocar por um apelido.
          </p>
        ) : null}
      </section>

      {board.isPending ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
        </div>
      ) : board.isError ? (
        <div className="rounded-lg border border-loss/40 bg-loss-muted p-4 text-sm">
          <p className="font-medium">Não foi possível carregar o ranking</p>
          <p className="mt-1 text-muted-foreground">{board.error.message}</p>
        </div>
      ) : !data || data.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhuma classificação ainda. O ranking aparece depois do primeiro fechamento diário.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">Investidor</th>
                <th className="px-4 py-2 text-right font-medium">Patrimônio</th>
                <th className="px-4 py-2 text-right font-medium">Rentabilidade</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={`${String(row.rank)}-${row.displayName}`}
                  className={cn(
                    'border-t border-border',
                    // A própria linha fica destacada, e não só em negrito: numa
                    // lista longa é o que permite se achar sem procurar.
                    row.isMe && 'bg-accent/60',
                  )}
                >
                  <td className="tabular px-4 py-2 text-muted-foreground">
                    {row.rank <= 3 ? (
                      <span className="inline-flex items-center gap-1">
                        <Trophy
                          className={cn(
                            'size-3.5',
                            row.rank === 1 && 'text-chart-4',
                            row.rank === 2 && 'text-muted-foreground',
                            row.rank === 3 && 'text-chart-1',
                          )}
                          aria-hidden
                        />
                        {row.rank}
                      </span>
                    ) : (
                      row.rank
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={cn(row.isMe && 'font-medium')}>{row.displayName}</span>
                    {row.isMe ? (
                      <span className="ml-2 text-xs text-muted-foreground">você</span>
                    ) : null}
                  </td>
                  <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                    {formatBRL(row.totalValue)}
                  </td>
                  <td
                    className={cn(
                      'tabular px-4 py-2 text-right font-medium whitespace-nowrap',
                      row.returnPct > 0
                        ? 'text-gain'
                        : row.returnPct < 0
                          ? 'text-loss'
                          : 'text-muted-foreground',
                    )}
                  >
                    {formatPercent(row.returnPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pastSeasons.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium">Temporadas encerradas</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {data.pastSeasons.map((season) => (
              <li key={season.id}>
                {season.name} · iniciada com {formatBRL(season.initial_cash)}
                {season.ends_at ? ` · encerrada em ${formatDate(season.ends_at)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </AppShell>
  );
}

import { DEFAULT_INITIAL_CASH, formatBRL, formatDateTime, formatPercent } from '@m8invest/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  closeSeason,
  fetchAdmin,
  openSeason,
  toggleProduct,
  type AdminOverview,
} from '@/features/admin/api';
import { cn } from '@/lib/utils';

const STATS: { key: keyof AdminOverview; label: string }[] = [
  { key: 'users', label: 'Usuários' },
  { key: 'assetsTradable', label: 'Ativos negociáveis' },
  { key: 'quotes', label: 'Cotações em cache' },
  { key: 'candles', label: 'Candles' },
  { key: 'filledOrders', label: 'Ordens executadas' },
  { key: 'rejectedOrders', label: 'Ordens rejeitadas' },
  { key: 'openInvestments', label: 'Aplicações abertas' },
  { key: 'snapshots', label: 'Snapshots' },
];

const RUN_TONE: Record<string, string> = {
  OK: 'text-gain',
  PARTIAL: 'text-chart-4',
  SKIPPED: 'text-muted-foreground',
  FAILED: 'text-loss',
  RUNNING: 'text-muted-foreground',
};

export function AdminPage() {
  const [seasonName, setSeasonName] = useState('');
  const [initialCash, setInitialCash] = useState(String(DEFAULT_INITIAL_CASH));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const admin = useQuery({ queryKey: ['admin'], queryFn: fetchAdmin });

  const invalidate = async () => {
    setError(null);
    await queryClient.invalidateQueries();
  };

  const open = useMutation({
    mutationFn: () => openSeason(seasonName.trim(), Number(initialCash)),
    onSuccess: async () => {
      setSeasonName('');
      setConfirming(false);
      await invalidate();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const close = useMutation({
    mutationFn: (id: string) => closeSeason(id),
    onSuccess: invalidate,
    onError: (caught: Error) => setError(caught.message),
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      toggleProduct(input.id, input.isActive),
    onSuccess: invalidate,
    onError: (caught: Error) => setError(caught.message),
  });

  const data = admin.data;
  const activeSeason = data?.seasons.find((season) => season.is_active) ?? null;
  const cashValue = Number(initialCash);
  const canOpen = seasonName.trim().length > 0 && Number.isFinite(cashValue) && cashValue > 0;

  if (admin.isPending) {
    return (
      <AppShell>
        <div className="grid place-items-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
        </div>
      </AppShell>
    );
  }

  // A RPC devolve nulo para quem não é admin. A rota poderia barrar antes,
  // mas a autoridade é o banco: se a checagem vivesse só no cliente, bastaria
  // trocar um booleano no console para ver o painel.
  if (!data?.overview) {
    return (
      <AppShell>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-6">
          <ShieldAlert className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h1 className="font-semibold">Sem permissão</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Esta área é restrita a administradores.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Administração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Temporadas, catálogo de renda fixa e saúde dos jobs.
        </p>
      </div>

      {error ? (
        <p role="alert" className="mb-5 rounded-lg border border-loss/40 bg-loss-muted p-3 text-sm">
          {error}
        </p>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Números</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.key} className="rounded-lg border border-border bg-card p-3">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="tabular mt-0.5 text-lg font-semibold">
                {String(data.overview?.[stat.key] ?? 0)}
              </dd>
            </div>
          ))}
        </dl>
        {data.overview.lastQuoteAt ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Última cotação gravada em {formatDateTime(data.overview.lastQuoteAt)}.
          </p>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Temporadas</h2>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Nome</th>
                <th className="px-4 py-2 text-right font-medium">Saldo inicial</th>
                <th className="px-4 py-2 text-left font-medium">Início</th>
                <th className="px-4 py-2 text-left font-medium">Fim</th>
                <th className="px-4 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.seasons.map((season) => (
                <tr key={season.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    {season.name}
                    {season.is_active ? (
                      <span className="ml-2 text-xs text-gain">aberta</span>
                    ) : null}
                  </td>
                  <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                    {formatBRL(season.initial_cash)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(season.starts_at)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {season.ends_at ? formatDateTime(season.ends_at) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {season.is_active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={close.isPending}
                        onClick={() => {
                          close.mutate(season.id);
                        }}
                      >
                        Encerrar
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Abrir nova temporada</h3>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="season-name">Nome</Label>
              <Input
                id="season-name"
                value={seasonName}
                onChange={(event) => {
                  setSeasonName(event.target.value);
                  setConfirming(false);
                }}
                placeholder="Temporada 2"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5 sm:w-40">
              <Label htmlFor="season-cash">Saldo inicial</Label>
              <Input
                id="season-cash"
                inputMode="decimal"
                value={initialCash}
                onChange={(event) => {
                  setInitialCash(event.target.value);
                  setConfirming(false);
                }}
              />
            </div>
          </div>

          {/* Confirmação em dois passos, e não um `confirm()`: abrir temporada
              zera a carteira de todos os usuários. É a ação mais destrutiva do
              painel e a única com dois cliques. */}
          {confirming ? (
            <div className="mt-4 rounded-lg border border-loss/40 bg-loss-muted p-3">
              <p className="text-sm">
                Isto encerra{' '}
                {activeSeason ? <strong>{activeSeason.name}</strong> : 'a temporada atual'} e cria
                uma carteira nova de {formatBRL(cashValue)} para todos os{' '}
                {String(data.overview.users)} usuários. O histórico de ordens e extrato da temporada
                encerrada é preservado, mas ninguém volta a operar nela.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={open.isPending}
                  onClick={() => {
                    open.mutate();
                  }}
                >
                  {open.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Confirmar e resetar todos
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="mt-4"
              disabled={!canOpen}
              onClick={() => setConfirming(true)}
            >
              Abrir temporada
            </Button>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Catálogo de renda fixa</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Produto</th>
                <th className="px-4 py-2 text-right font-medium">Taxa</th>
                <th className="px-4 py-2 text-left font-medium">Liquidez</th>
                <th className="px-4 py-2 text-left font-medium">IR</th>
                <th className="px-4 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.products.map((product) => (
                <tr key={product.id} className="border-t border-border">
                  <td className={cn('px-4 py-2', !product.is_active && 'text-muted-foreground')}>
                    {product.name}
                  </td>
                  <td className="tabular px-4 py-2 text-right">
                    {formatPercent(product.annual_rate)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {product.liquidity === 'DAILY' ? 'diária' : 'no vencimento'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {product.is_tax_exempt ? 'isento' : 'tributado'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={toggle.isPending}
                      onClick={() => {
                        toggle.mutate({ id: product.id, isActive: !product.is_active });
                      }}
                    >
                      {product.is_active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Desativar esconde o produto do catálogo, mas não afeta aplicações já feitas — elas seguem
          rendendo e podem ser resgatadas.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Últimas execuções dos jobs</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Job</th>
                <th className="px-4 py-2 text-left font-medium">Quando</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id} className="border-t border-border">
                  <td className="px-4 py-2 whitespace-nowrap">{run.job}</td>
                  <td className="tabular px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(run.started_at)}
                  </td>
                  <td className={cn('px-4 py-2 font-medium', RUN_TONE[run.status])}>
                    {run.status}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{run.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Rodadas <span className="font-medium">SKIPPED</span> são registradas de propósito: sem
          elas, &ldquo;o cron nunca disparou&rdquo; ficaria indistinguível de &ldquo;disparou e
          decidiu não gastar requisição&rdquo;.
        </p>
      </section>
    </AppShell>
  );
}

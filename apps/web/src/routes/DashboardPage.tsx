import { formatBRL, formatDateTime, formatPercent, type Enums } from '@m8invest/core';
import { useQuery } from '@tanstack/react-query';
import { Loader2, LogOut } from 'lucide-react';

import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/useAuth';
import { fetchDashboard } from '@/features/portfolio/queries';
import { cn } from '@/lib/utils';

const LEDGER_LABEL: Record<Enums<'ledger_kind'>, string> = {
  DEPOSIT: 'Depósito',
  BUY: 'Compra',
  SELL: 'Venda',
  FEE: 'Taxa',
  TAX: 'IR',
  FI_APPLY: 'Aplicação',
  FI_REDEEM: 'Resgate',
  FI_INTEREST: 'Rendimento',
};

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'gain' | 'loss';
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular mt-1 text-xl font-semibold',
          tone === 'gain' && 'text-gain',
          tone === 'loss' && 'text-loss',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function DashboardPage() {
  const { user, signOut } = useAuth();

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
  });

  const season = dashboard.data?.season ?? null;
  const portfolio = dashboard.data?.portfolio ?? null;
  const ledger = dashboard.data?.ledger ?? [];

  // Fase 1 tem só caixa. Ativos entram na Fase 3 e renda fixa na Fase 5, e
  // então o patrimônio passa a somar as três parcelas.
  const equityValue = 0;
  const fixedIncomeValue = 0;
  const totalValue = (portfolio?.cash_balance ?? 0) + equityValue + fixedIncomeValue;
  const initialCash = season?.initial_cash ?? 0;
  const returnFraction = initialCash > 0 ? totalValue / initialCash - 1 : 0;
  const tone = returnFraction > 0 ? 'gain' : returnFraction < 0 ? 'loss' : undefined;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Logo />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut aria-hidden />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {dashboard.isPending ? (
          <div className="grid place-items-center py-20">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label="Carregando"
            />
          </div>
        ) : dashboard.isError ? (
          <div className="rounded-lg border border-loss/40 bg-loss-muted p-4">
            <p className="text-sm font-medium">Não foi possível carregar a carteira</p>
            <p className="mt-1 text-sm text-muted-foreground">{dashboard.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void dashboard.refetch()}
            >
              Tentar de novo
            </Button>
          </div>
        ) : !season ? (
          <div className="rounded-lg border border-border bg-card p-6">
            <h1 className="font-semibold">Nenhuma temporada aberta</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              As carteiras são criadas por temporada. Assim que uma for aberta, a sua aparece aqui
              com o saldo inicial creditado.
            </p>
          </div>
        ) : !portfolio ? (
          <div className="rounded-lg border border-border bg-card p-6">
            <h1 className="font-semibold">Você ainda não tem carteira nesta temporada</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A carteira é criada no primeiro cadastro. Se a sua conta existia antes da{' '}
              {season.name} começar, ela é criada quando a temporada for reaberta.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">Sua carteira</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {season.name} · iniciada com {formatBRL(initialCash)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Patrimônio"
                value={formatBRL(totalValue)}
                hint={`${formatPercent(returnFraction)} desde o início`}
                {...(tone ? { tone } : {})}
              />
              <Metric
                label="Caixa"
                value={formatBRL(portfolio.cash_balance)}
                hint="Disponível para investir"
              />
              <Metric
                label="Em ativos"
                value={formatBRL(equityValue)}
                hint="Ações e FIIs (Fase 3)"
              />
              <Metric
                label="Renda fixa"
                value={formatBRL(fixedIncomeValue)}
                hint="CDB e Tesouro (Fase 5)"
              />
            </div>

            <section className="mt-8">
              <h2 className="mb-3 text-sm font-medium">Extrato</h2>
              {ledger.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Nenhum lançamento ainda.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Quando</th>
                        <th className="px-4 py-2 text-left font-medium">Tipo</th>
                        <th className="px-4 py-2 text-left font-medium">Descrição</th>
                        <th className="px-4 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((entry) => (
                        <tr key={entry.id} className="border-t border-border">
                          <td className="tabular px-4 py-2 whitespace-nowrap text-muted-foreground">
                            {formatDateTime(entry.occurred_at)}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {LEDGER_LABEL[entry.kind]}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{entry.description}</td>
                          <td
                            className={cn(
                              'tabular px-4 py-2 text-right font-medium whitespace-nowrap',
                              entry.amount > 0 ? 'text-gain' : 'text-loss',
                            )}
                          >
                            {/* O sinal explícito é o que carrega a informação —
                                cor sozinha exclui quem tem discromatopsia. */}
                            {entry.amount > 0 ? '+' : '−'}
                            {formatBRL(Math.abs(entry.amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        <p className="mt-10 text-xs text-muted-foreground">
          Simulação com fins educacionais. Cotações com atraso. Não constitui recomendação de
          investimento.
        </p>
      </main>
    </div>
  );
}

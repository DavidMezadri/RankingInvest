import { formatBRL, formatDateTime, formatPercent, money, type Enums } from '@m8invest/core';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Link } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { PortfolioChart } from '@/components/PortfolioChart';
import { Button } from '@/components/ui/button';
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
  DIVIDEND: 'Dividendo',
  JCP: 'JCP',
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
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
  });

  const season = dashboard.data?.season ?? null;
  const portfolio = dashboard.data?.portfolio ?? null;
  const ledger = dashboard.data?.ledger ?? [];
  const positions = dashboard.data?.positions ?? [];

  // Patrimônio e valor em ativos são somados na query, com sumMoney: juntar
  // valores já arredondados com `+` cru reintroduz o erro binário que o
  // módulo money existe para fechar.
  const equityValue = dashboard.data?.equityValue ?? 0;
  const totalValue = dashboard.data?.totalValue ?? 0;
  const equityCurve = dashboard.data?.equityCurve ?? [];
  const previousClose = dashboard.data?.previousClose ?? null;
  const fixedIncomeValue = dashboard.data?.fixedIncomeValue ?? 0;
  const initialCash = season?.initial_cash ?? 0;

  // Variação do dia só existe se houver fechamento anterior. No primeiro dia
  // fica nula em vez de zero: zero afirmaria que o patrimônio não variou.
  const dayChange = previousClose === null ? null : money(totalValue - previousClose);
  const dayChangePct =
    previousClose !== null && previousClose > 0 ? totalValue / previousClose - 1 : null;
  const returnFraction = initialCash > 0 ? totalValue / initialCash - 1 : 0;
  const tone = returnFraction > 0 ? 'gain' : returnFraction < 0 ? 'loss' : undefined;

  return (
    <AppShell>
      {dashboard.isPending ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
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
            As carteiras são criadas por temporada. Assim que uma for aberta, a sua aparece aqui com
            o saldo inicial creditado.
          </p>
        </div>
      ) : !portfolio ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="font-semibold">Você ainda não tem carteira nesta temporada</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A carteira é criada no primeiro cadastro. Se a sua conta existia antes da {season.name}{' '}
            começar, ela é criada quando a temporada for reaberta.
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
              hint={
                dayChangePct !== null && dayChange !== null
                  ? `${formatPercent(dayChangePct)} hoje · ${formatPercent(returnFraction)} desde o início`
                  : `${formatPercent(returnFraction)} desde o início`
              }
              {...(tone ? { tone } : {})}
            />
            <Metric
              label="Caixa"
              value={formatBRL(portfolio.cash_balance)}
              hint="Disponível para investir"
            />
            <Metric label="Em ativos" value={formatBRL(equityValue)} hint="Ações e FIIs (Fase 3)" />
            <Metric
              label="Renda fixa"
              value={formatBRL(fixedIncomeValue)}
              hint="CDB, LCI e Tesouro"
            />
          </div>

          <section className="mt-8 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-xs font-medium text-muted-foreground">
              Evolução do patrimônio
            </h2>
            <PortfolioChart points={equityCurve} />
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-medium">Posições</h2>
            {positions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Nenhuma posição aberta.{' '}
                <Link to="/app/mercado" className="text-foreground hover:underline">
                  Ver o mercado
                </Link>
                .
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Ativo</th>
                      <th className="px-4 py-2 text-right font-medium">Qtd.</th>
                      <th className="px-4 py-2 text-right font-medium">Preço médio</th>
                      <th className="px-4 py-2 text-right font-medium">Cotação</th>
                      <th className="px-4 py-2 text-right font-medium">Valor</th>
                      <th className="px-4 py-2 text-right font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((position) => (
                      <tr key={position.ticker} className="border-t border-border">
                        <td className="px-4 py-2 font-medium whitespace-nowrap">
                          <Link to={`/app/ativo/${position.ticker}`} className="hover:underline">
                            {position.ticker}
                          </Link>
                        </td>
                        <td className="tabular px-4 py-2 text-right">{position.quantity}</td>
                        <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                          {formatBRL(position.avgPrice)}
                        </td>
                        <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                          {position.price === null ? '—' : formatBRL(position.price)}
                        </td>
                        <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                          {formatBRL(position.marketValue)}
                        </td>
                        <td
                          className={cn(
                            'tabular px-4 py-2 text-right font-medium whitespace-nowrap',
                            position.unrealizedPnl > 0
                              ? 'text-gain'
                              : position.unrealizedPnl < 0
                                ? 'text-loss'
                                : 'text-muted-foreground',
                          )}
                        >
                          {/* Sinal explícito além da cor: cor sozinha exclui
                              quem tem discromatopsia. */}
                          {position.unrealizedPnl >= 0 ? '+' : '−'}
                          {formatBRL(Math.abs(position.unrealizedPnl))}
                          <span className="ml-1 text-xs font-normal">
                            ({formatPercent(position.unrealizedPct)})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

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
                        <td className="px-4 py-2 whitespace-nowrap">{LEDGER_LABEL[entry.kind]}</td>
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
    </AppShell>
  );
}

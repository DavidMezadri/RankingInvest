import { formatBRL, formatCompactBRL, formatPercent } from '@m8invest/core';
import { BarChart3, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';

import type { MarketRow } from '@/features/market/queries';
import { cn } from '@/lib/utils';

const SIZE = 5;

type Metric = 'gain' | 'loss' | 'volume';

type Ranking = {
  top: MarketRow[];
  /** Por que a lista saiu vazia. `null` quando há resultado. */
  reason: string | null;
};

/**
 * Ordena descartando quem não tem o dado.
 *
 * Ativo sem cotação não pode figurar em "maiores altas": ele não subiu nem
 * caiu, apenas não foi sincronizado. Tratá-lo como zero o colocaria no meio
 * do ranking como se fosse informação.
 *
 * Quando nada sobra, devolve o MOTIVO em vez de um vazio mudo. As causas são
 * diferentes e levam a ações diferentes: mercado recém-aberto se resolve
 * esperando, sync parado é problema a investigar. Um "sem dados ainda" único
 * para as duas confunde as duas.
 */
function rank(rows: readonly MarketRow[], metric: Metric): Ranking {
  if (rows.length === 0) {
    return { top: [], reason: 'Nenhum ativo neste filtro.' };
  }

  if (metric === 'volume') {
    const top = rows
      .filter((row) => row.financialVolume !== null && row.financialVolume > 0)
      .sort((a, b) => (b.financialVolume ?? 0) - (a.financialVolume ?? 0))
      .slice(0, SIZE);

    if (top.length > 0) return { top, reason: null };

    // Distingue "não temos a cotação" de "não houve negócio". O segundo é o
    // estado normal nos primeiros minutos após a abertura, e em FII ilíquido
    // dura o dia inteiro: RBRF11 fecha com preço e volume zero.
    return {
      top: [],
      reason: rows.every((row) => row.price === null)
        ? 'Cotações ainda não sincronizadas.'
        : 'Nenhum negócio registrado até agora.',
    };
  }

  const top = rows
    .filter((row) => row.changePct !== null)
    .sort((a, b) =>
      metric === 'gain'
        ? (b.changePct ?? 0) - (a.changePct ?? 0)
        : (a.changePct ?? 0) - (b.changePct ?? 0),
    )
    .slice(0, SIZE);

  return top.length > 0
    ? { top, reason: null }
    : { top: [], reason: 'Cotações ainda não sincronizadas.' };
}

function Card({ title, metric, ranking }: { title: string; metric: Metric; ranking: Ranking }) {
  const rows = ranking.top;

  const Icon = metric === 'gain' ? TrendingUp : metric === 'loss' ? TrendingDown : BarChart3;
  const iconTone =
    metric === 'gain' ? 'text-gain' : metric === 'loss' ? 'text-loss' : 'text-muted-foreground';

  return (
    <section className="rounded-lg border border-border bg-card">
      <h3 className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn('size-3.5', iconTone)} aria-hidden />
        {title}
      </h3>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{ranking.reason}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.ticker} className="border-b border-border last:border-b-0">
              <Link
                to={`/app/ativo/${row.ticker}`}
                className="flex items-baseline justify-between gap-3 px-4 py-2 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium">{row.ticker}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.name}</span>
                </span>

                <span className="shrink-0 text-right">
                  {metric === 'volume' ? (
                    <>
                      <span className="tabular block text-sm font-medium">
                        {formatCompactBRL(row.financialVolume ?? 0)}
                      </span>
                      <span className="tabular block text-xs text-muted-foreground">
                        {row.price === null ? '—' : formatBRL(row.price)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className={cn(
                          'tabular block text-sm font-medium',
                          (row.changePct ?? 0) > 0
                            ? 'text-gain'
                            : (row.changePct ?? 0) < 0
                              ? 'text-loss'
                              : 'text-muted-foreground',
                        )}
                      >
                        {/* change_pct vem em pontos percentuais, não em fração. */}
                        {formatPercent((row.changePct ?? 0) / 100)}
                      </span>
                      <span className="tabular block text-xs text-muted-foreground">
                        {row.price === null ? '—' : formatBRL(row.price)}
                      </span>
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MarketHighlights({ rows }: { rows: readonly MarketRow[] }) {
  const gainers = useMemo(() => rank(rows, 'gain'), [rows]);
  const losers = useMemo(() => rank(rows, 'loss'), [rows]);
  const traded = useMemo(() => rank(rows, 'volume'), [rows]);

  return (
    <div className="mb-6">
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Maiores altas" metric="gain" ranking={gainers} />
        <Card title="Maiores baixas" metric="loss" ranking={losers} />
        <Card title="Mais negociados" metric="volume" ranking={traded} />
      </div>

      {/* O critério precisa estar escrito: "mais negociado" em número de ações
          colocaria papel de centavos no topo. MGLU3 girou 12,5 M de ações a
          R$ 5,79 (R$ 72 mi) contra 7,9 M de PETR4 a R$ 47 (R$ 373 mi) — em
          contagem a primeira ganha, em dinheiro perde por cinco vezes. */}
      <p className="mt-2 text-xs text-muted-foreground">
        &ldquo;Mais negociados&rdquo; usa volume financeiro (preço × quantidade), não contagem de
        ações — é o que mede liquidez de verdade.
      </p>
    </div>
  );
}

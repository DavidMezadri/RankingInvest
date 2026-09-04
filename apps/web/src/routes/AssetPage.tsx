import { formatBRL, formatDateTime, formatPercent, type Enums } from '@m8invest/core';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { CandleChart } from '@/components/CandleChart';
import { OrderTicket } from '@/components/OrderTicket';
import { fetchAsset } from '@/features/market/queries';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<Enums<'asset_type'>, string> = {
  STOCK: 'Ação',
  FII: 'Fundo Imobiliário',
  UNIT: 'Unit',
  BDR: 'BDR',
};

const compactNumber = new Intl.NumberFormat('pt-BR', { notation: 'compact' });

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

export function AssetPage() {
  const { ticker = '' } = useParams();

  const asset = useQuery({
    queryKey: ['asset', ticker],
    queryFn: () => fetchAsset(ticker.toUpperCase()),
    staleTime: 5 * 60_000,
    enabled: ticker !== '',
  });

  const detail = asset.data ?? null;
  const quote = detail?.quote ?? null;
  const changeFraction = quote?.change_pct === null ? null : (quote?.change_pct ?? 0) / 100;

  return (
    <AppShell>
      <Link
        to="/app/mercado"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Mercado
      </Link>

      {asset.isPending ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
        </div>
      ) : asset.isError ? (
        <div className="rounded-lg border border-loss/40 bg-loss-muted p-4 text-sm">
          <p className="font-medium">Não foi possível carregar o ativo</p>
          <p className="mt-1 text-muted-foreground">{asset.error.message}</p>
        </div>
      ) : !detail ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="font-semibold">Ativo não encontrado</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O código <span className="font-medium">{ticker.toUpperCase()}</span> não está no
            universo negociável do simulador.
          </p>
        </div>
      ) : (
        <>
          <header className="mb-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{detail.asset.ticker}</h1>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {TYPE_LABEL[detail.asset.type]}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{detail.asset.name}</p>
          </header>

          {quote ? (
            <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-2">
              <p className="tabular text-3xl font-semibold">{formatBRL(quote.price)}</p>
              {changeFraction !== null ? (
                <p
                  className={cn(
                    'tabular pb-1 text-sm font-medium',
                    changeFraction > 0
                      ? 'text-gain'
                      : changeFraction < 0
                        ? 'text-loss'
                        : 'text-muted-foreground',
                  )}
                >
                  {formatPercent(changeFraction)} hoje
                </p>
              ) : null}
              <p className="pb-1 text-xs text-muted-foreground">
                preço de {formatDateTime(quote.quoted_at)}
              </p>
            </div>
          ) : (
            <p className="mb-6 text-sm text-muted-foreground">
              Sem cotação em cache ainda. O sync roda a cada 30 minutos em horário de mercado.
            </p>
          )}

          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-xs font-medium text-muted-foreground">
              Últimos 3 meses · candles diários
            </h2>
            {detail.candles.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Sem histórico para este ativo.
              </p>
            ) : (
              <CandleChart candles={detail.candles} />
            )}
          </section>

          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-xs font-medium text-muted-foreground">Dados</h2>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field
                label="Fechamento anterior"
                value={quote?.prev_close ? formatBRL(quote.prev_close) : '—'}
              />
              <Field
                label="Volume do dia"
                value={quote?.volume ? compactNumber.format(quote.volume) : '—'}
              />
              <Field label="Lote mínimo" value={String(detail.asset.lot_size)} />
              <Field label="Fonte" value={quote?.source ?? '—'} />
            </dl>
          </section>

          {quote ? (
            <OrderTicket
              ticker={detail.asset.ticker}
              referencePrice={quote.price}
              quotedAt={quote.quoted_at}
              lotSize={detail.asset.lot_size}
            />
          ) : (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Sem cotação em cache, não é possível operar. O sync roda a cada 30 minutos em horário
              de mercado.
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}

import { formatBRL, formatPercent, formatTime, type Enums } from '@m8invest/core';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Search, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { Input } from '@/components/ui/input';
import { fetchMarket, type MarketRow } from '@/features/market/queries';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<Enums<'asset_type'>, string> = {
  STOCK: 'Ação',
  FII: 'FII',
  UNIT: 'Unit',
  BDR: 'BDR',
};

const FILTERS: { value: 'ALL' | Enums<'asset_type'>; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'STOCK', label: 'Ações' },
  { value: 'FII', label: 'FIIs' },
  { value: 'UNIT', label: 'Units' },
  { value: 'BDR', label: 'BDRs' },
];

type SortKey = 'ticker' | 'price' | 'changePct';

const compactNumber = new Intl.NumberFormat('pt-BR', { notation: 'compact' });

/** Ordena nulos sempre no fim, para ativo sem cotação não encabeçar a lista. */
function compare(a: MarketRow, b: MarketRow, key: SortKey, asc: boolean): number {
  if (key === 'ticker') {
    return asc ? a.ticker.localeCompare(b.ticker) : b.ticker.localeCompare(a.ticker);
  }

  const left = a[key];
  const right = b[key];
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return asc ? left - right : right - left;
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  align = 'right',
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; asc: boolean };
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === column;

  return (
    <th className={cn('px-4 py-2 font-medium', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          active && 'text-foreground',
        )}
      >
        {label}
        {active ? (
          sort.asc ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}

export function MarketPage() {
  const [term, setTerm] = useState('');
  const [type, setType] = useState<'ALL' | Enums<'asset_type'>>('ALL');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'ticker', asc: true });

  const market = useQuery({
    queryKey: ['market'],
    queryFn: fetchMarket,
    // O dado do provider só muda a cada ~30 min; revalidar antes disso
    // gastaria requisição sem trazer preço novo.
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const source = market.data?.rows ?? [];

    return source
      .filter((row) => (type === 'ALL' ? true : row.type === type))
      .filter(
        (row) =>
          needle === '' ||
          row.ticker.toLowerCase().includes(needle) ||
          row.name.toLowerCase().includes(needle),
      )
      .sort((a, b) => compare(a, b, sort.key, sort.asc));
  }, [market.data, term, type, sort]);

  function handleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, asc: !current.asc }
        : // Ticker começa crescente (A→Z); número começa decrescente, porque
          // "maiores altas" é o que se quer ver primeiro.
          { key, asc: key === 'ticker' },
    );
  }

  // Relógio reativo: o aviso de cotação velha precisa surgir numa aba que
  // ficou aberta, sem depender de um render acidental.
  const now = useNow();
  const lastSync = market.data?.lastSync ?? null;
  const syncAgeMinutes = lastSync?.finished_at
    ? (now - new Date(lastSync.finished_at).getTime()) / 60_000
    : null;
  const syncStale = syncAgeMinutes !== null && syncAgeMinutes > 75;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mercado</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {market.data ? `${String(market.data.rows.length)} ativos disponíveis` : 'Carregando…'}
          {lastSync?.finished_at ? (
            <>
              {' · '}
              <span className={cn(syncStale && 'text-loss')}>
                cotações de {formatTime(lastSync.finished_at)}
              </span>
            </>
          ) : null}
        </p>
      </div>

      {/* Honestidade sobre a idade do dado: o provider entrega com ~30 min de
          atraso e o sync roda a cada 30, então o preço na tela pode ter até
          uma hora. Esconder isso seria deixar o usuário achar que opera ao
          preço do instante. */}
      {syncStale ? (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-loss/40 bg-loss-muted p-4 text-sm">
          <TriangleAlert className="mt-0.5 shrink-0 text-loss" aria-hidden />
          <div>
            <p className="font-medium">Cotações desatualizadas</p>
            <p className="mt-0.5 text-muted-foreground">
              A última sincronização foi há {syncAgeMinutes?.toFixed(0)} minutos. Ordens serão
              rejeitadas até o sync voltar.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Buscar por código ou nome"
            className="pl-9"
            aria-label="Buscar ativo"
          />
        </div>

        <div className="flex gap-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setType(filter.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                type === filter.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {market.isPending ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
        </div>
      ) : market.isError ? (
        <div className="rounded-lg border border-loss/40 bg-loss-muted p-4 text-sm">
          <p className="font-medium">Não foi possível carregar o mercado</p>
          <p className="mt-1 text-muted-foreground">{market.error.message}</p>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum ativo encontrado para “{term}”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <SortableHeader
                  label="Código"
                  column="ticker"
                  sort={sort}
                  onSort={handleSort}
                  align="left"
                />
                <th className="px-4 py-2 text-left font-medium">Nome</th>
                <th className="px-4 py-2 text-left font-medium">Tipo</th>
                <SortableHeader label="Preço" column="price" sort={sort} onSort={handleSort} />
                <SortableHeader
                  label="Variação"
                  column="changePct"
                  sort={sort}
                  onSort={handleSort}
                />
                <th className="px-4 py-2 text-right font-medium">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ticker} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium whitespace-nowrap">
                    <Link to={`/app/ativo/${row.ticker}`} className="hover:underline">
                      {row.ticker}
                    </Link>
                  </td>
                  <td className="max-w-[18rem] truncate px-4 py-2 text-muted-foreground">
                    {row.name}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {TYPE_LABEL[row.type]}
                  </td>
                  <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                    {row.price === null ? '—' : formatBRL(row.price)}
                  </td>
                  <td
                    className={cn(
                      'tabular px-4 py-2 text-right font-medium whitespace-nowrap',
                      row.changePct === null
                        ? 'text-muted-foreground'
                        : row.changePct > 0
                          ? 'text-gain'
                          : row.changePct < 0
                            ? 'text-loss'
                            : 'text-muted-foreground',
                    )}
                  >
                    {/* change_pct vem da fonte em pontos percentuais, não em
                        fração — daí a divisão antes de formatar. */}
                    {row.changePct === null ? '—' : formatPercent(row.changePct / 100)}
                  </td>
                  <td className="tabular px-4 py-2 text-right whitespace-nowrap text-muted-foreground">
                    {row.volume === null ? '—' : compactNumber.format(row.volume)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

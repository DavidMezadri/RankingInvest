import { APP_TIMEZONE, money, sumMoney, type Tables } from '@m8invest/core';

import { getSupabaseClient } from '@/lib/supabase';

export type HeldPosition = {
  ticker: string;
  name: string;
  quantity: number;
  avgPrice: number;
  /** Último preço em cache. `null` quando o ativo ainda não sincronizou. */
  price: number | null;
  /** Valor a mercado. Cai para o custo quando não há cotação. */
  marketValue: number;
  costValue: number;
  unrealizedPnl: number;
  unrealizedPct: number;
};

export type Dashboard = {
  season: Tables<'seasons'> | null;
  portfolio: Tables<'portfolios'> | null;
  ledger: Tables<'ledger_entries'>[];
  positions: HeldPosition[];
  equityValue: number;
  totalValue: number;
  /** Curva de patrimônio, do mais antigo ao mais recente. */
  equityCurve: { date: string; value: number }[];
  /**
   * Patrimônio no último fechamento ANTERIOR ao de hoje. `null` no primeiro
   * dia — sem fechamento anterior não existe variação do dia, e mostrar zero
   * seria afirmar que não variou.
   */
  previousClose: number | null;
};

/**
 * Estado da carteira do usuário na temporada aberta.
 *
 * Em queries separadas e não numa só com embedding: a distinção entre "não
 * existe temporada aberta" e "existe temporada mas o usuário não tem carteira
 * nela" precisa aparecer na interface, e um join interno colapsaria os dois
 * casos em `null` — dois problemas diferentes com soluções diferentes.
 *
 * Nenhuma query filtra por usuário. A RLS já limita ao dono, e filtrar aqui
 * daria a falsa impressão de que a segurança está no cliente.
 */
export async function fetchDashboard(): Promise<Dashboard> {
  const supabase = getSupabaseClient();

  const empty = { positions: [], equityValue: 0, equityCurve: [], previousClose: null };

  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();

  if (seasonError) throw new Error(seasonError.message);
  if (!season) {
    return { season: null, portfolio: null, ledger: [], ...empty, totalValue: 0 };
  }

  const { data: portfolio, error: portfolioError } = await supabase
    .from('portfolios')
    .select('*')
    .eq('season_id', season.id)
    .maybeSingle();

  if (portfolioError) throw new Error(portfolioError.message);
  if (!portfolio) {
    return { season, portfolio: null, ledger: [], ...empty, totalValue: 0 };
  }

  const [ledger, positions, snapshots] = await Promise.all([
    supabase
      .from('ledger_entries')
      .select('*')
      .eq('portfolio_id', portfolio.id)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase
      .from('positions')
      .select('ticker, quantity, avg_price')
      .eq('portfolio_id', portfolio.id),
    supabase
      .from('portfolio_snapshots')
      .select('date, total_value')
      .eq('portfolio_id', portfolio.id)
      .order('date', { ascending: true }),
  ]);

  if (ledger.error) throw new Error(ledger.error.message);
  if (positions.error) throw new Error(positions.error.message);
  if (snapshots.error) throw new Error(snapshots.error.message);

  const tickers = (positions.data ?? []).map((row) => row.ticker);

  // Busca preço e nome só dos ativos em carteira. Carregar os 151 para
  // valorizar 3 posições seria desperdício de banda em cada abertura de tela.
  const [quotes, assets] = await Promise.all([
    tickers.length > 0
      ? supabase.from('quotes').select('ticker, price').in('ticker', tickers)
      : Promise.resolve({ data: [], error: null }),
    tickers.length > 0
      ? supabase.from('assets').select('ticker, name').in('ticker', tickers)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const priceByTicker = new Map((quotes.data ?? []).map((row) => [row.ticker, row.price]));
  const nameByTicker = new Map((assets.data ?? []).map((row) => [row.ticker, row.name]));

  const held: HeldPosition[] = (positions.data ?? []).map((row) => {
    const price = priceByTicker.get(row.ticker) ?? null;
    const costValue = money(row.avg_price * row.quantity);
    // Sem cotação, avaliar a custo em vez de a zero: mostrar patrimônio
    // sumindo porque um sync falhou seria pior que mostrar o valor de entrada.
    const marketValue = price === null ? costValue : money(price * row.quantity);

    return {
      ticker: row.ticker,
      name: nameByTicker.get(row.ticker) ?? row.ticker,
      quantity: row.quantity,
      avgPrice: row.avg_price,
      price,
      marketValue,
      costValue,
      unrealizedPnl: money(marketValue - costValue),
      unrealizedPct: costValue > 0 ? marketValue / costValue - 1 : 0,
    };
  });

  held.sort((a, b) => b.marketValue - a.marketValue);

  // sumMoney e não `+`: somar valores já arredondados com o operador cru
  // reintroduz o erro binário que o módulo money existe para fechar.
  const equityValue = sumMoney(held.map((position) => position.marketValue));
  const totalValue = sumMoney([portfolio.cash_balance, equityValue]);

  const history = snapshots.data ?? [];

  // A curva histórica termina no valor de AGORA, não no último fechamento:
  // durante o dia o patrimônio já mudou, e mostrar a curva parando ontem
  // enquanto o cartão mostra outro número seria contradizer a própria tela.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const equityCurve = [
    ...history
      .filter((row) => row.date < today)
      .map((row) => ({ date: row.date, value: row.total_value })),
    { date: today, value: totalValue },
  ];

  const closes = history.filter((row) => row.date < today);
  const previousClose = closes.length > 0 ? (closes[closes.length - 1]?.total_value ?? null) : null;

  return {
    season,
    portfolio,
    ledger: ledger.data ?? [],
    positions: held,
    equityValue,
    totalValue,
    equityCurve,
    previousClose,
  };
}

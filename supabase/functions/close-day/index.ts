import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { money, sumMoney } from '../../../packages/core/src/money.ts';
import { readMarketClock } from '../_shared/market-calendar.ts';

/**
 * Fecha o dia: grava um snapshot do patrimônio de cada carteira.
 *
 * Roda 18:30 de Brasília, meia hora depois do fim da sessão, para o último
 * sync já ter registrado o preço de fechamento.
 *
 * Como `sync-quotes`, dispensa segredo compartilhado com o cron: a escrita é
 * um upsert em (portfolio_id, date), então rodar duas vezes no mesmo dia
 * produz exatamente o mesmo estado. Invocar a URL de fora não causa dano —
 * no máximo recalcula o snapshot de hoje com o preço de agora.
 */

const JOB = 'close-day';

type Outcome = {
  status: 'OK' | 'SKIPPED' | 'FAILED';
  detail: string;
  date: string | null;
  snapshots: number;
  backfilled: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function record(
  db: SupabaseClient,
  status: Outcome['status'],
  detail: string,
  snapshots = 0,
): Promise<void> {
  const timestamp = new Date().toISOString();
  await db.from('sync_runs').insert({
    job: JOB,
    started_at: timestamp,
    finished_at: timestamp,
    status: status === 'SKIPPED' ? 'SKIPPED' : status,
    tickers_ok: snapshots,
    detail,
  });
}

async function runCloseDay(db: SupabaseClient, force: boolean): Promise<Outcome> {
  const clock = readMarketClock();

  if (!force) {
    if (clock.weekday === 0 || clock.weekday === 6) {
      const detail = 'fim de semana';
      await record(db, 'SKIPPED', detail);
      return { status: 'SKIPPED', detail, date: clock.date, snapshots: 0, backfilled: 0 };
    }

    const { data: holiday } = await db
      .from('market_holidays')
      .select('name')
      .eq('date', clock.date)
      .maybeSingle();

    if (holiday) {
      const detail = `feriado: ${holiday.name}`;
      await record(db, 'SKIPPED', detail);
      return { status: 'SKIPPED', detail, date: clock.date, snapshots: 0, backfilled: 0 };
    }
  }

  const { data: season, error: seasonError } = await db
    .from('seasons')
    .select('id, initial_cash')
    .eq('is_active', true)
    .maybeSingle();

  if (seasonError) throw new Error(`seasons: ${seasonError.message}`);

  if (!season) {
    const detail = 'nenhuma temporada aberta';
    await record(db, 'SKIPPED', detail);
    return { status: 'SKIPPED', detail, date: clock.date, snapshots: 0, backfilled: 0 };
  }

  const [portfolios, positions, quotes] = await Promise.all([
    db.from('portfolios').select('id, cash_balance, created_at').eq('season_id', season.id),
    db.from('positions').select('portfolio_id, ticker, quantity, avg_price'),
    db.from('quotes').select('ticker, price'),
  ]);

  if (portfolios.error) throw new Error(`portfolios: ${portfolios.error.message}`);
  if (positions.error) throw new Error(`positions: ${positions.error.message}`);
  if (quotes.error) throw new Error(`quotes: ${quotes.error.message}`);

  const priceByTicker = new Map((quotes.data ?? []).map((row) => [row.ticker, row.price]));

  const equityByPortfolio = new Map<string, number[]>();
  for (const position of positions.data ?? []) {
    const price = priceByTicker.get(position.ticker);
    // Sem cotação, avalia a CUSTO. Avaliar a zero faria o gráfico de
    // patrimônio despencar por falha de sync — dado falso é pior que ausente.
    const value = money((price ?? position.avg_price) * position.quantity);
    const bucket = equityByPortfolio.get(position.portfolio_id) ?? [];
    bucket.push(value);
    equityByPortfolio.set(position.portfolio_id, bucket);
  }

  const rows: Record<string, unknown>[] = [];
  const backfill: Record<string, unknown>[] = [];

  // Carteiras que ainda não têm nenhum snapshot recebem um na data de
  // criação, valendo o saldo inicial. Não é dado inventado: naquele dia a
  // carteira valia exatamente isso. Sem essa âncora o gráfico de evolução
  // começaria num único ponto e não mostraria variação alguma.
  const { data: existing } = await db
    .from('portfolio_snapshots')
    .select('portfolio_id')
    .in(
      'portfolio_id',
      (portfolios.data ?? []).map((row) => row.id),
    );

  const hasSnapshot = new Set((existing ?? []).map((row) => row.portfolio_id));

  for (const portfolio of portfolios.data ?? []) {
    const equityValue = sumMoney(equityByPortfolio.get(portfolio.id) ?? []);
    const totalValue = sumMoney([portfolio.cash_balance, equityValue]);

    rows.push({
      portfolio_id: portfolio.id,
      date: clock.date,
      cash: portfolio.cash_balance,
      equity_value: equityValue,
      fixed_income_value: 0,
      total_value: totalValue,
    });

    if (!hasSnapshot.has(portfolio.id)) {
      const openedOn = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(portfolio.created_at));

      if (openedOn < clock.date) {
        backfill.push({
          portfolio_id: portfolio.id,
          date: openedOn,
          cash: season.initial_cash,
          equity_value: 0,
          fixed_income_value: 0,
          total_value: season.initial_cash,
        });
      }
    }
  }

  for (const chunk of [backfill, rows]) {
    if (chunk.length === 0) continue;
    const { error } = await db
      .from('portfolio_snapshots')
      .upsert(chunk, { onConflict: 'portfolio_id,date' });
    if (error) throw new Error(`upsert snapshots: ${error.message}`);
  }

  const detail = `${String(rows.length)} snapshots em ${clock.date}${
    backfill.length > 0 ? `, ${String(backfill.length)} de abertura` : ''
  }`;

  await record(db, 'OK', detail, rows.length);

  return {
    status: 'OK',
    detail,
    date: clock.date,
    snapshots: rows.length,
    backfilled: backfill.length,
  };
}

Deno.serve(async (request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    return json({ error: 'ambiente do Supabase incompleto' }, 500);
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    return json(await runCloseDay(db, force));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'erro desconhecido';
    await record(db, 'FAILED', message);
    return json({ status: 'FAILED', error: message }, 500);
  }
});

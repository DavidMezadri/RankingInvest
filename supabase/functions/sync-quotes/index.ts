import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { getMarketStatus } from '../_shared/market-calendar.ts';
import {
  createBrapiProvider,
  yahooProvider,
  type QuoteProvider,
  type QuoteSnapshot,
} from '../_shared/quote-providers.ts';

/**
 * Sincroniza o cache de cotações. Chamada pelo pg_cron a cada 30 min em dia
 * útil, em horário de mercado.
 *
 * Roda com `verify_jwt = false` — sem segredo compartilhado entre o cron e a
 * função. Isso é seguro porque a função é IDEMPOTENTE e AUTO-LIMITADA: se o
 * último sync bem-sucedido tem menos de `MIN_INTERVAL_MINUTES`, ela devolve
 * SKIPPED sem fazer uma única chamada externa. Invocar a URL repetidamente,
 * de fora, custa uma leitura no banco e nada mais.
 *
 * A alternativa era guardar a service_role key no Vault e um CRON_SECRET nos
 * dois lados. Mais peças para configurar, mais segredo circulando, e a
 * proteção real continuaria sendo a idempotência — que é de graça.
 */

const MIN_INTERVAL_MINUTES = 25;
const OVERLAP_LOCK_MINUTES = 5;
const CONCURRENCY = 4;

/** Candles reescritos a cada rodada quando o ticker já tem histórico. */
const RECENT_CANDLE_DAYS = 3;

/** Abaixo disso o ticker é tratado como novo e recebe o range inteiro. */
const BACKFILL_THRESHOLD = 20;

type SyncOutcome = {
  status: 'OK' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  detail: string;
  tickersOk: number;
  tickersFailed: number;
  bySource: Record<string, number>;
  failures: { ticker: string; error: string }[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Executa `task` sobre `items` com paralelismo limitado. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results.push(await task(item));
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Registra uma rodada pulada.
 *
 * Sem isto, `SKIPPED` retornaria sem deixar rastro — e "o cron nunca
 * disparou" ficaria indistinguível de "disparou e decidiu não gastar
 * requisição". Justamente a diferença que importa para detectar job morto.
 */
async function recordSkip(db: SupabaseClient, detail: string): Promise<SyncOutcome> {
  const timestamp = new Date().toISOString();

  await db.from('sync_runs').insert({
    job: 'sync-quotes',
    started_at: timestamp,
    finished_at: timestamp,
    status: 'SKIPPED',
    detail,
  });

  return { status: 'SKIPPED', detail, tickersOk: 0, tickersFailed: 0, bySource: {}, failures: [] };
}

async function fetchWithFallback(
  ticker: string,
  providers: readonly QuoteProvider[],
): Promise<{ snapshot: QuoteSnapshot } | { error: string }> {
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return { snapshot: await provider.fetchQuote(ticker) };
    } catch (caught) {
      errors.push(`${provider.name}: ${caught instanceof Error ? caught.message : 'erro'}`);
    }
  }

  return { error: errors.join(' | ') };
}

async function runSync(db: SupabaseClient, force: boolean): Promise<SyncOutcome> {
  // ─── trava de sobreposição ───────────────────────────────────────────────
  // Duas rodadas simultâneas dobrariam as requisições e disputariam o mesmo
  // upsert. `force` não ignora esta trava, só a de intervalo.
  const lockCutoff = new Date(Date.now() - OVERLAP_LOCK_MINUTES * 60_000).toISOString();
  const { data: running } = await db
    .from('sync_runs')
    .select('id')
    .eq('job', 'sync-quotes')
    .eq('status', 'RUNNING')
    .gte('started_at', lockCutoff)
    .limit(1);

  if (running && running.length > 0) {
    return await recordSkip(db, 'outra rodada em andamento');
  }

  // ─── janela e intervalo ──────────────────────────────────────────────────
  const [{ data: settings }, { data: holidayRows }] = await Promise.all([
    db.rpc('platform_setting', { p_key: 'trading' }),
    db.from('market_holidays').select('date'),
  ]);

  const trading = (settings ?? {}) as { opensAt?: string; closesAt?: string };
  const holidays = new Set((holidayRows ?? []).map((row) => row.date));

  const market = getMarketStatus(
    { opensAt: trading.opensAt ?? '10:00', closesAt: trading.closesAt ?? '17:55' },
    holidays,
  );

  if (!market.open && !force) {
    return await recordSkip(db, `mercado fechado (${market.reason})`);
  }

  if (!force) {
    const { data: lastOk } = await db
      .from('sync_runs')
      .select('finished_at')
      .eq('job', 'sync-quotes')
      .in('status', ['OK', 'PARTIAL'])
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastOk?.finished_at) {
      const ageMinutes = (Date.now() - new Date(lastOk.finished_at).getTime()) / 60_000;
      if (ageMinutes < MIN_INTERVAL_MINUTES) {
        return await recordSkip(db, `último sync há ${ageMinutes.toFixed(0)} min`);
      }
    }
  }

  // ─── providers ───────────────────────────────────────────────────────────
  const brapiToken = Deno.env.get('BRAPI_TOKEN');
  const providers: QuoteProvider[] = [yahooProvider];
  if (brapiToken) providers.push(createBrapiProvider(brapiToken));

  const { data: assets, error: assetsError } = await db
    .from('assets')
    .select('ticker')
    .eq('is_synced', true)
    .order('ticker');

  if (assetsError) throw new Error(`assets: ${assetsError.message}`);
  const tickers = (assets ?? []).map((row) => row.ticker);

  if (tickers.length === 0) {
    return await recordSkip(db, 'nenhum ativo marcado para sync');
  }

  const { data: runRow } = await db
    .from('sync_runs')
    .insert({ job: 'sync-quotes', provider: providers.map((p) => p.name).join('>') })
    .select('id')
    .single();
  const runId = runRow?.id as number | undefined;

  try {
    // Tickers que já têm histórico levam upsert só dos últimos dias; os novos
    // recebem o range inteiro. Uma consulta agregada evita 151 checagens.
    const backfillCutoff = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const { data: existingCandles } = await db
      .from('daily_candles')
      .select('ticker')
      .gte('date', backfillCutoff);

    const candleCount = new Map<string, number>();
    for (const row of existingCandles ?? []) {
      candleCount.set(row.ticker, (candleCount.get(row.ticker) ?? 0) + 1);
    }

    const recentCutoff = new Date(Date.now() - RECENT_CANDLE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const results = await pool(tickers, CONCURRENCY, async (ticker) => ({
      ticker,
      ...(await fetchWithFallback(ticker, providers)),
    }));

    const quoteRows: Record<string, unknown>[] = [];
    const candleRows: Record<string, unknown>[] = [];
    const failures: { ticker: string; error: string }[] = [];
    const bySource: Record<string, number> = {};

    for (const result of results) {
      if (!('snapshot' in result)) {
        failures.push({ ticker: result.ticker, error: result.error });
        continue;
      }

      const snap = result.snapshot;
      bySource[snap.source] = (bySource[snap.source] ?? 0) + 1;

      quoteRows.push({
        ticker: snap.ticker,
        price: snap.price,
        prev_close: snap.prevClose,
        change_pct: snap.changePct,
        volume: snap.volume,
        quoted_at: snap.quotedAt,
        fetched_at: new Date().toISOString(),
        source: snap.source,
      });

      const isNew = (candleCount.get(snap.ticker) ?? 0) < BACKFILL_THRESHOLD;
      for (const candle of snap.candles) {
        if (!isNew && candle.date < recentCutoff) continue;
        candleRows.push({
          ticker: snap.ticker,
          date: candle.date,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        });
      }
    }

    if (quoteRows.length > 0) {
      const { error } = await db.from('quotes').upsert(quoteRows, { onConflict: 'ticker' });
      if (error) throw new Error(`upsert quotes: ${error.message}`);
    }

    let candlesSaved = 0;
    let candleError: string | null = null;

    for (let i = 0; i < candleRows.length; i += 1000) {
      const chunk = candleRows.slice(i, i + 1000);
      const { error } = await db.from('daily_candles').upsert(chunk, { onConflict: 'ticker,date' });

      if (error) {
        // Não aborta a rodada. A cotação já está gravada, e é ela que
        // precifica ordem — o candle só alimenta gráfico. Lançar aqui marcava
        // FAILED um sync cujo dado principal deu certo, e como `lastSync` na
        // tela e a auto-limitação de 25 min contam apenas OK e PARTIAL, o
        // efeito era duplo: o preço novo ficava invisível e a rodada seguinte
        // refazia as 151 chamadas ao provider como se nada tivesse rodado.
        candleError = error.message;
        break;
      }

      candlesSaved += chunk.length;
    }

    const degraded = failures.length > 0 || candleError !== null;
    const status: SyncOutcome['status'] = !degraded
      ? 'OK'
      : quoteRows.length === 0
        ? 'FAILED'
        : 'PARTIAL';

    const outcome: SyncOutcome = {
      status,
      detail:
        `${String(quoteRows.length)} cotações, ${String(candlesSaved)} candles` +
        (candleError === null ? '' : ` · candles falharam: ${candleError}`),
      tickersOk: quoteRows.length,
      tickersFailed: failures.length,
      bySource,
      failures: failures.slice(0, 20),
    };

    if (runId !== undefined) {
      await db
        .from('sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          status,
          tickers_ok: outcome.tickersOk,
          tickers_failed: outcome.tickersFailed,
          detail: outcome.detail,
        })
        .eq('id', runId);
    }

    return outcome;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'erro desconhecido';

    if (runId !== undefined) {
      await db
        .from('sync_runs')
        .update({ finished_at: new Date().toISOString(), status: 'FAILED', detail: message })
        .eq('id', runId);
    }

    throw caught;
  }
}

Deno.serve(async (request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    return jsonResponse({ error: 'ambiente do Supabase incompleto' }, 500);
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    return jsonResponse(await runSync(db, force));
  } catch (caught) {
    return jsonResponse(
      { status: 'FAILED', error: caught instanceof Error ? caught.message : 'erro' },
      500,
    );
  }
});

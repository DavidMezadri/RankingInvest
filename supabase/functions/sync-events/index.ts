import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { parseFeeConfig } from '../../../packages/core/src/fees.ts';
import {
  classifyProvento,
  isinMatchesTicker,
  parseBrazilianDate,
  parseBrazilianDecimal,
  quoteProvento,
} from '../../../packages/core/src/proventos.ts';
import { readMarketClock } from '../_shared/market-calendar.ts';

/**
 * Importa eventos societários da B3 e credita proventos.
 *
 * A fonte são os endpoints públicos da própria bolsa: oficial, sem token, sem
 * cota, e o identificador é o prefixo do ticker. Uma requisição por ativo
 * traz o histórico inteiro.
 *
 * Três etapas por execução:
 *
 *   1. IMPORTA os eventos de cada ativo sincronizado.
 *   2. PROVISIONA: para evento com data-com de hoje, congela a quantidade que
 *      cada carteira tem AGORA e calcula o valor. Congelar é o que torna o
 *      valor correto — `positions` guarda só a posição atual, então calcular
 *      na data de pagamento pagaria a quem comprou depois e não pagaria a
 *      quem vendeu no meio.
 *   3. PAGA: crédito no caixa dos provisionados cuja data de pagamento chegou.
 *
 * Sem CORS: quem chama é o pg_net, de dentro do Postgres.
 */

const JOB = 'sync-events';
const CONCURRENCY = 3;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const COMPANY_URL =
  'https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany';
const FUNDS_URL =
  'https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds';

type B3CashDividend = {
  isinCode?: unknown;
  label?: unknown;
  rate?: unknown;
  valueCash?: unknown;
  lastDatePrior?: unknown;
  lastDatePriorEx?: unknown;
  paymentDate?: unknown;
  approvedOn?: unknown;
  dateApproval?: unknown;
  relatedTo?: unknown;
  corporateAction?: unknown;
};

type B3StockDividend = {
  isinCode?: unknown;
  label?: unknown;
  factor?: unknown;
  lastDatePrior?: unknown;
  approvedOn?: unknown;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** O parâmetro dos endpoints da B3 é um JSON em base64 na própria URL. */
function b3Url(base: string, params: Record<string, unknown>): string {
  return `${base}/${btoa(JSON.stringify(params))}`;
}

/**
 * Algumas respostas da B3 vêm como string JSON aninhada, outras como objeto.
 * Desembrulhar até chegar ao objeto evita depender de qual variante o
 * endpoint devolveu hoje.
 */
function unwrap(value: unknown): Record<string, unknown> | null {
  let current = value;
  for (let i = 0; i < 3 && typeof current === 'string'; i += 1) {
    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }

  if (Array.isArray(current)) current = current[0];
  return typeof current === 'object' && current !== null
    ? (current as Record<string, unknown>)
    : null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

type EventRow = {
  ticker: string;
  kind: 'DIVIDEND' | 'JCP' | 'SPLIT';
  rate_per_share: number | null;
  factor: number | null;
  ex_date: string;
  payment_date: string | null;
  approved_on: string | null;
  related_to: string | null;
  isin_code: string | null;
};

function toEventRows(ticker: string, payload: Record<string, unknown>): EventRow[] {
  const rows: EventRow[] = [];

  for (const raw of (payload.cashDividends ?? []) as B3CashDividend[]) {
    const isin = text(raw.isinCode);
    // O endpoint devolve todas as classes da empresa numa resposta só, então
    // filtrar pelo ISIN é o que impede pagar ao dono de PETR4 o provento da
    // PETR3.
    if (isin && !isinMatchesTicker(isin, ticker)) continue;

    const label = text(raw.label) ?? text(raw.corporateAction);
    const rateText = text(raw.rate) ?? text(raw.valueCash);
    const exText = text(raw.lastDatePrior) ?? text(raw.lastDatePriorEx);
    if (!label || !rateText || !exText) continue;

    try {
      rows.push({
        ticker,
        kind: classifyProvento(label),
        rate_per_share: parseBrazilianDecimal(rateText),
        factor: null,
        ex_date: parseBrazilianDate(exText),
        payment_date: text(raw.paymentDate) ? parseBrazilianDate(text(raw.paymentDate)!) : null,
        approved_on: (() => {
          const approved = text(raw.approvedOn) ?? text(raw.dateApproval);
          return approved ? parseBrazilianDate(approved) : null;
        })(),
        related_to: text(raw.relatedTo),
        isin_code: isin,
      });
    } catch {
      // Registro com data ou valor fora do formato é DESCARTADO, não
      // aproximado: um provento com valor errado credita dinheiro errado.
      continue;
    }
  }

  for (const raw of (payload.stockDividends ?? []) as B3StockDividend[]) {
    const isin = text(raw.isinCode);
    if (isin && !isinMatchesTicker(isin, ticker)) continue;

    const factorText = text(raw.factor);
    const exText = text(raw.lastDatePrior);
    if (!factorText || !exText) continue;

    try {
      rows.push({
        ticker,
        kind: 'SPLIT',
        rate_per_share: null,
        factor: parseBrazilianDecimal(factorText),
        ex_date: parseBrazilianDate(exText),
        payment_date: null,
        approved_on: text(raw.approvedOn) ? parseBrazilianDate(text(raw.approvedOn)!) : null,
        related_to: text(raw.label),
        isin_code: isin,
      });
    } catch {
      continue;
    }
  }

  return rows;
}

async function fetchEvents(ticker: string, isFund: boolean): Promise<EventRow[]> {
  // O identificador da B3 é o prefixo do ticker sem a classe.
  const identifier = ticker.replace(/\d{1,2}$/u, '');

  const url = isFund
    ? b3Url(FUNDS_URL, { typeFund: 7, identifierFund: identifier })
    : b3Url(COMPANY_URL, { issuingCompany: identifier, language: 'pt-br' });

  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);

  const payload = unwrap(await response.json());
  return payload ? toEventRows(ticker, payload) : [];
}

async function pool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        if (item === undefined) continue;
        results.push(await task(item));
      }
    }),
  );

  return results;
}

Deno.serve(async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'ambiente incompleto' }, 500);

  const db: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const today = readMarketClock().date;
  const startedAt = new Date().toISOString();

  try {
    // ─── 1. importa ────────────────────────────────────────────────────────
    const { data: assets, error: assetsError } = await db
      .from('assets')
      .select('ticker, type')
      .eq('is_synced', true)
      .order('ticker');

    if (assetsError) throw new Error(`assets: ${assetsError.message}`);

    const outcomes = await pool(assets ?? [], CONCURRENCY, async (asset) => {
      try {
        return { ok: true as const, rows: await fetchEvents(asset.ticker, asset.type === 'FII') };
      } catch (caught) {
        return {
          ok: false as const,
          ticker: asset.ticker,
          error: caught instanceof Error ? caught.message : 'erro',
        };
      }
    });

    const eventRows = outcomes.flatMap((item) => (item.ok ? item.rows : []));
    const failures = outcomes.filter((item) => !item.ok).length;

    for (let i = 0; i < eventRows.length; i += 500) {
      const { error } = await db.from('corporate_events').upsert(eventRows.slice(i, i + 500), {
        onConflict: 'ticker,kind,ex_date,rate_per_share,isin_code',
        ignoreDuplicates: true,
      });
      if (error) throw new Error(`upsert eventos: ${error.message}`);
    }

    // ─── 2. provisiona ─────────────────────────────────────────────────────
    const { data: feesValue } = await db.rpc('platform_setting', { p_key: 'fees' });
    const config = parseFeeConfig(feesValue);
    // JCP tem 15% retidos na fonte, mesma alíquota do IR de swing trade.
    const jcpTaxRate = config.equityTaxRate;

    const { data: dueToday } = await db
      .from('corporate_events')
      .select('id, ticker, kind, rate_per_share')
      .eq('ex_date', today)
      .in('kind', ['DIVIDEND', 'JCP']);

    let provisioned = 0;

    for (const event of dueToday ?? []) {
      if (event.rate_per_share === null) continue;

      const { data: holders } = await db
        .from('positions')
        .select('portfolio_id, quantity')
        .eq('ticker', event.ticker);

      for (const holder of holders ?? []) {
        const quote = quoteProvento({
          kind: event.kind === 'JCP' ? 'JCP' : 'DIVIDEND',
          quantity: holder.quantity,
          ratePerShare: event.rate_per_share,
          jcpTaxRate,
        });

        // `unique (portfolio_id, event_id)` mais ignoreDuplicates é a trava
        // contra provisionar duas vezes se o job rodar de novo hoje.
        const { error } = await db.from('dividend_entitlements').upsert(
          {
            portfolio_id: holder.portfolio_id,
            event_id: event.id,
            quantity: holder.quantity,
            gross_amount: quote.grossAmount,
            tax_amount: quote.taxAmount,
            net_amount: quote.netAmount,
          },
          { onConflict: 'portfolio_id,event_id', ignoreDuplicates: true },
        );

        if (!error) provisioned += 1;
      }
    }

    // ─── 3. paga ───────────────────────────────────────────────────────────
    const { data: payable } = await db
      .from('dividend_entitlements')
      .select('id, corporate_events!inner(payment_date)')
      .eq('status', 'PROVISIONED')
      .lte('corporate_events.payment_date', today);

    let paid = 0;

    for (const item of payable ?? []) {
      const { error } = await db.rpc('pay_dividend_tx', { p_entitlement_id: item.id });
      if (!error) paid += 1;
    }

    const detail =
      `${String(eventRows.length)} eventos, ${String(provisioned)} provisionados, ` +
      `${String(paid)} pagos${failures > 0 ? `, ${String(failures)} ativos falharam` : ''}`;

    await db.from('sync_runs').insert({
      job: JOB,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: failures === 0 ? 'OK' : 'PARTIAL',
      provider: 'b3',
      tickers_ok: (assets ?? []).length - failures,
      tickers_failed: failures,
      detail,
    });

    return json({ status: 'OK', detail, events: eventRows.length, provisioned, paid, failures });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'erro desconhecido';

    await db.from('sync_runs').insert({
      job: JOB,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: 'FAILED',
      provider: 'b3',
      detail: message,
    });

    return json({ status: 'FAILED', error: message }, 500);
  }
});

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  describeRejection,
  parseFeeConfig,
  quoteOrder,
  type OrderSide,
  type RejectionCode,
} from '../../../packages/core/src/fees.ts';
import { corsJson, handlePreflight } from '../_shared/cors.ts';
import { getMarketStatus } from '../_shared/market-calendar.ts';

/**
 * Executa uma ordem a mercado.
 *
 * Ao contrário de `sync-quotes`, esta função EXIGE JWT: ela move dinheiro em
 * nome de alguém, então precisa saber quem é. O `p_user_id` vem do token
 * validado, nunca do corpo da requisição — aceitá-lo do cliente deixaria
 * qualquer usuário operar na carteira de outro.
 *
 * O preço também não vem do cliente. É lido da tabela `quotes`. Se viesse no
 * corpo, alguém compraria PETR4 a R$ 0,01 pelo console do navegador e o
 * simulador acabava no primeiro dia.
 *
 * O cálculo é o de packages/core — o MESMO que a boleta usa no preview. Se
 * fossem códigos diferentes, o usuário seria debitado de um valor que não viu.
 */

const MAX_ORDERS_PER_MINUTE = 30;

type OrderRequest = { ticker: string; side: OrderSide; quantity: number };

// Delega ao helper para que TODA resposta leve CORS, inclusive as de erro:
// sem os cabeçalhos, o navegador esconde o corpo e o usuário vê um erro
// genérico em vez do motivo da rejeição.
function json(body: unknown, status = 200): Response {
  return corsJson(body, status);
}

function rejected(code: RejectionCode, status = 422): Response {
  return json({ status: 'REJECTED', code, message: describeRejection(code) }, status);
}

function parseRequest(body: unknown): OrderRequest | null {
  if (typeof body !== 'object' || body === null) return null;

  const raw = body as Record<string, unknown>;
  const ticker = typeof raw.ticker === 'string' ? raw.ticker.trim().toUpperCase() : '';
  const side = raw.side === 'BUY' || raw.side === 'SELL' ? raw.side : null;
  const quantity = typeof raw.quantity === 'number' ? raw.quantity : Number(raw.quantity);

  if (!/^[A-Z][A-Z0-9]{3}[0-9]{1,2}$/.test(ticker) || side === null) return null;
  if (!Number.isInteger(quantity) || quantity <= 0) return null;

  return { ticker, side, quantity };
}

/**
 * Registra a rejeição no histórico do usuário.
 *
 * Ordem recusada é informação: sem a linha, quem perdeu uma compra por saldo
 * não tem como reconstruir o que tentou. Falha ao registrar não derruba a
 * resposta — o usuário já vai receber o motivo.
 */
async function logRejection(
  db: SupabaseClient,
  portfolioId: string | null,
  request: OrderRequest,
  code: RejectionCode,
  referencePrice: number | null,
): Promise<void> {
  if (!portfolioId) return;

  await db
    .from('orders')
    .insert({
      portfolio_id: portfolioId,
      ticker: request.ticker,
      side: request.side,
      quantity: request.quantity,
      status: 'REJECTED',
      rejection_code: code,
      reference_price: referencePrice,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!url || !serviceKey || !anonKey) {
    return json({ error: 'ambiente do Supabase incompleto' }, 500);
  }

  if (request.method !== 'POST') {
    return json({ error: 'use POST' }, 405);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) {
    return json({ error: 'sem credencial' }, 401);
  }

  // Cliente com o token do usuário: serve só para descobrir QUEM é. A
  // identidade vem do JWT verificado, não do corpo.
  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: 'credencial inválida' }, 401);
  }

  const userId = userData.user.id;
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const parsed = parseRequest(await request.json().catch(() => null));
  if (!parsed) {
    return rejected('INVALID_QUANTITY', 400);
  }

  // ─── contexto ────────────────────────────────────────────────────────────
  const [portfolioResult, assetResult, quoteResult, feesResult, tradingResult, holidaysResult] =
    await Promise.all([
      db
        .from('portfolios')
        .select('id, cash_balance, seasons!inner(id, is_active, ends_at)')
        .eq('user_id', userId)
        .eq('seasons.is_active', true)
        .maybeSingle(),
      db
        .from('assets')
        .select('ticker, lot_size, is_tradable')
        .eq('ticker', parsed.ticker)
        .maybeSingle(),
      db.from('quotes').select('price, quoted_at').eq('ticker', parsed.ticker).maybeSingle(),
      db.rpc('platform_setting', { p_key: 'fees' }),
      db.rpc('platform_setting', { p_key: 'trading' }),
      db.from('market_holidays').select('date'),
    ]);

  const portfolio = portfolioResult.data;
  const portfolioId = portfolio?.id ?? null;

  if (!portfolio) return rejected('NO_PORTFOLIO');

  const season = portfolio.seasons as unknown as { ends_at: string | null } | null;
  if (season?.ends_at && new Date(season.ends_at) < new Date()) {
    await logRejection(db, portfolioId, parsed, 'SEASON_ENDED', null);
    return rejected('SEASON_ENDED');
  }

  const asset = assetResult.data;
  if (!asset || !asset.is_tradable) {
    await logRejection(db, portfolioId, parsed, 'ASSET_NOT_TRADABLE', null);
    return rejected('ASSET_NOT_TRADABLE');
  }

  if (parsed.quantity % asset.lot_size !== 0) {
    await logRejection(db, portfolioId, parsed, 'INVALID_LOT', null);
    return rejected('INVALID_LOT');
  }

  const trading = (tradingResult.data ?? {}) as {
    opensAt?: string;
    closesAt?: string;
    maxQuoteAgeMinutes?: number;
    maxOrdersPerMinute?: number;
  };

  const market = getMarketStatus(
    { opensAt: trading.opensAt ?? '10:00', closesAt: trading.closesAt ?? '17:55' },
    new Set((holidaysResult.data ?? []).map((row) => row.date)),
  );

  if (!market.open) {
    await logRejection(db, portfolioId, parsed, 'MARKET_CLOSED', null);
    return rejected('MARKET_CLOSED');
  }

  // Rate limit por carteira. Protege a integridade contábil de um script que
  // dispare centenas de ordens em paralelo, não a cota da API.
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recentOrders } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('portfolio_id', portfolio.id)
    .eq('status', 'FILLED')
    .gte('created_at', oneMinuteAgo);

  if ((recentOrders ?? 0) >= (trading.maxOrdersPerMinute ?? MAX_ORDERS_PER_MINUTE)) {
    return rejected('RATE_LIMITED', 429);
  }

  const quote = quoteResult.data;
  if (!quote) {
    await logRejection(db, portfolioId, parsed, 'NO_QUOTE', null);
    return rejected('NO_QUOTE');
  }

  const quoteAgeMinutes = (Date.now() - new Date(quote.quoted_at).getTime()) / 60_000;
  if (quoteAgeMinutes > (trading.maxQuoteAgeMinutes ?? 75)) {
    await logRejection(db, portfolioId, parsed, 'STALE_QUOTE', quote.price);
    return rejected('STALE_QUOTE');
  }

  // ─── cálculo ─────────────────────────────────────────────────────────────
  const { data: position } = await db
    .from('positions')
    .select('quantity, avg_price')
    .eq('portfolio_id', portfolio.id)
    .eq('ticker', parsed.ticker)
    .maybeSingle();

  const config = parseFeeConfig(feesResult.data);

  const order = quoteOrder({
    side: parsed.side,
    quantity: parsed.quantity,
    referencePrice: quote.price,
    position: position ? { quantity: position.quantity, avgPrice: position.avg_price } : null,
    config,
  });

  // Checagens amigáveis antes da RPC. Ela revalida sob trava e é a autoridade
  // final — isto existe só para devolver o código exato em vez de um erro de
  // banco, e para registrar a tentativa.
  if (parsed.side === 'BUY' && portfolio.cash_balance + order.netAmount < 0) {
    await logRejection(db, portfolioId, parsed, 'INSUFFICIENT_CASH', quote.price);
    return rejected('INSUFFICIENT_CASH');
  }

  if (parsed.side === 'SELL' && (position?.quantity ?? 0) < parsed.quantity) {
    await logRejection(db, portfolioId, parsed, 'INSUFFICIENT_POSITION', quote.price);
    return rejected('INSUFFICIENT_POSITION');
  }

  // ─── escrita ─────────────────────────────────────────────────────────────
  const { data: filled, error: rpcError } = await db.rpc('execute_order_tx', {
    p_user_id: userId,
    p_ticker: parsed.ticker,
    p_side: parsed.side,
    p_quantity: parsed.quantity,
    p_reference_price: order.referencePrice,
    p_executed_price: order.executedPrice,
    p_gross_amount: order.grossAmount,
    p_fee_amount: order.feeAmount,
    p_tax_amount: order.taxAmount,
    p_net_amount: order.netAmount,
    p_realized_pnl: order.realizedPnl,
    p_new_avg_price: order.newAvgPrice,
  });

  if (rpcError) {
    // A RPC sinaliza recusa por `raise exception` com o próprio código, que
    // chega aqui na mensagem. Traduzir mantém o contrato igual ao das
    // validações acima, em vez de vazar erro de Postgres para a tela.
    const code = (['INSUFFICIENT_CASH', 'INSUFFICIENT_POSITION', 'NO_PORTFOLIO'] as const).find(
      (candidate) => rpcError.message.includes(candidate),
    );

    if (code) {
      await logRejection(db, portfolioId, parsed, code, quote.price);
      return rejected(code);
    }

    return json({ status: 'FAILED', error: rpcError.message }, 500);
  }

  return json({ status: 'FILLED', order: filled, quote: order });
});

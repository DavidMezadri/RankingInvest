import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { parseFeeConfig } from '../../../packages/core/src/fees.ts';
import {
  accrueValue,
  canRedeem,
  countBusinessDays,
  quoteRedemption,
} from '../../../packages/core/src/fixed-income.ts';
import { readMarketClock } from '../_shared/market-calendar.ts';

/**
 * Aplicação e resgate de renda fixa.
 *
 * Exige JWT: move dinheiro em nome de alguém. O usuário vem do token, nunca
 * do corpo — e o VALOR do resgate nunca vem do cliente, é recalculado aqui.
 *
 * Diferente das ordens, não há janela de mercado: renda fixa não depende de
 * bolsa aberta. Mas depende de calendário de dias úteis, e é aqui que
 * `market_holidays` deixa de ser controle de custo e passa a ser dinheiro.
 */

type Payload =
  | { action: 'APPLY'; productId: string; principal: number }
  | { action: 'REDEEM'; investmentId: string };

const REJECTION_MESSAGE: Record<string, string> = {
  NO_PORTFOLIO: 'Você não tem carteira na temporada aberta.',
  PRODUCT_NOT_AVAILABLE: 'Este produto não está mais disponível.',
  PRODUCT_MATURED: 'Este produto já venceu e não aceita novas aplicações.',
  BELOW_MINIMUM: 'O valor está abaixo do mínimo do produto.',
  INSUFFICIENT_CASH: 'Saldo em caixa insuficiente para esta aplicação.',
  INVESTMENT_NOT_FOUND: 'Aplicação não encontrada.',
  ALREADY_REDEEMED: 'Esta aplicação já foi resgatada.',
  NOT_LIQUID_YET: 'Este produto só pode ser resgatado no vencimento.',
  INVALID_INPUT: 'Dados inválidos.',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rejected(code: string, status = 422): Response {
  return json(
    { status: 'REJECTED', code, message: REJECTION_MESSAGE[code] ?? 'Operação não permitida.' },
    status,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as Record<string, unknown>;

  if (raw.action === 'APPLY') {
    const principal = typeof raw.principal === 'number' ? raw.principal : Number(raw.principal);
    if (typeof raw.productId !== 'string' || !UUID.test(raw.productId)) return null;
    // Duas casas decimais: valor em reais não tem fração de centavo.
    if (
      !Number.isFinite(principal) ||
      principal <= 0 ||
      Math.round(principal * 100) !== principal * 100
    ) {
      return null;
    }
    return { action: 'APPLY', productId: raw.productId, principal };
  }

  if (raw.action === 'REDEEM') {
    if (typeof raw.investmentId !== 'string' || !UUID.test(raw.investmentId)) return null;
    return { action: 'REDEEM', investmentId: raw.investmentId };
  }

  return null;
}

function mapRpcError(message: string): string | null {
  return Object.keys(REJECTION_MESSAGE).find((code) => message.includes(code)) ?? null;
}

async function loadHolidays(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from('market_holidays').select('date');
  return new Set((data ?? []).map((row) => row.date));
}

Deno.serve(async (request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!url || !serviceKey || !anonKey) return json({ error: 'ambiente incompleto' }, 500);
  if (request.method !== 'POST') return json({ error: 'use POST' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'sem credencial' }, 401);

  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return json({ error: 'credencial inválida' }, 401);

  const userId = userData.user.id;
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) return rejected('INVALID_INPUT', 400);

  try {
    if (payload.action === 'APPLY') {
      const { data, error } = await db.rpc('apply_fixed_income_tx', {
        p_user_id: userId,
        p_product_id: payload.productId,
        p_principal: payload.principal,
      });

      if (error) {
        const code = mapRpcError(error.message);
        return code ? rejected(code) : json({ status: 'FAILED', error: error.message }, 500);
      }

      return json({ status: 'APPLIED', investment: data });
    }

    // ─── resgate ───────────────────────────────────────────────────────────
    const { data: investment, error: loadError } = await db
      .from('fixed_income_investments')
      .select('id, principal, applied_on, redeemed_at, fixed_income_products!inner(*)')
      .eq('id', payload.investmentId)
      .maybeSingle();

    if (loadError) return json({ status: 'FAILED', error: loadError.message }, 500);
    if (!investment) return rejected('INVESTMENT_NOT_FOUND');
    if (investment.redeemed_at) return rejected('ALREADY_REDEEMED');

    const product = investment.fixed_income_products as unknown as {
      annual_rate: number;
      is_tax_exempt: boolean;
      liquidity: 'DAILY' | 'AT_MATURITY';
      maturity_date: string;
    };

    const today = readMarketClock().date;

    if (
      !canRedeem({
        liquidity: product.liquidity,
        maturityDate: product.maturity_date,
        today,
      })
    ) {
      return rejected('NOT_LIQUID_YET');
    }

    // O valor é recalculado do zero, a partir do principal e da contagem de
    // dias úteis até HOJE — não lido de `accrued_value`. Aquela coluna é
    // atualizada pelo `close-day` e serve para exibir e para o snapshot; se
    // um fechamento falhar, ela fica um dia atrasada. Resgatar pelo valor
    // armazenado faria uma falha de job custar dinheiro ao usuário.
    const holidays = await loadHolidays(db);
    const businessDays = countBusinessDays(investment.applied_on, today, holidays);
    const accrued = accrueValue(investment.principal, product.annual_rate, businessDays);

    const { data: feesValue } = await db.rpc('platform_setting', { p_key: 'fees' });
    const config = parseFeeConfig(feesValue);

    const quote = quoteRedemption({
      principal: investment.principal,
      accruedValue: accrued,
      isTaxExempt: product.is_tax_exempt,
      fiTaxRate: config.fiTaxRate,
    });

    const { data, error } = await db.rpc('redeem_fixed_income_tx', {
      p_user_id: userId,
      p_investment_id: payload.investmentId,
      p_gross: quote.grossAmount,
      p_tax: quote.taxAmount,
      p_net: quote.netAmount,
    });

    if (error) {
      const code = mapRpcError(error.message);
      return code ? rejected(code) : json({ status: 'FAILED', error: error.message }, 500);
    }

    return json({ status: 'REDEEMED', investment: data, quote, businessDays });
  } catch (caught) {
    return json(
      { status: 'FAILED', error: caught instanceof Error ? caught.message : 'erro' },
      500,
    );
  }
});

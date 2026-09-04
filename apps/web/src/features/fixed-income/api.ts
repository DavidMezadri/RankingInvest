import {
  accrueValue,
  canRedeem,
  countBusinessDays,
  parseFeeConfig,
  quoteRedemption,
  type FeeConfig,
  type RedemptionQuote,
  type Tables,
} from '@m8invest/core';

import { getSupabaseClient } from '@/lib/supabase';

export type FixedIncomeProduct = Tables<'fixed_income_products'>;

export type OpenInvestment = {
  id: string;
  product: FixedIncomeProduct;
  principal: number;
  appliedOn: string;
  businessDays: number;
  /** Valor recalculado até hoje, não o de `accrued_value`. */
  currentValue: number;
  redeemable: boolean;
  quote: RedemptionQuote;
};

export type FixedIncomeSnapshot = {
  products: FixedIncomeProduct[];
  investments: OpenInvestment[];
  holidays: Set<string>;
  config: FeeConfig;
  cashBalance: number;
  today: string;
  /** Soma do valor atual das aplicações abertas. */
  totalValue: number;
};

function marketToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Catálogo, aplicações abertas e o que é preciso para simular.
 *
 * O valor de cada aplicação é RECALCULADO no cliente, com a mesma função que
 * a Edge Function usa no resgate — não é lido de `accrued_value`. Aquela
 * coluna é atualizada pelo fechamento diário; se um fechamento falhar, ela
 * fica um dia atrasada, e a tela mostraria um número diferente do que o
 * resgate vai pagar.
 *
 * Os feriados vêm junto porque a contagem de dias úteis depende deles. São 30
 * linhas — carregar é mais barato que a incoerência de não carregar.
 */
export async function fetchFixedIncome(): Promise<FixedIncomeSnapshot> {
  const supabase = getSupabaseClient();
  const today = marketToday();

  const [products, investments, holidayRows, fees, portfolio] = await Promise.all([
    supabase
      .from('fixed_income_products')
      .select('*')
      .eq('is_active', true)
      .order('annual_rate', { ascending: false }),
    supabase
      .from('fixed_income_investments')
      .select('id, principal, applied_on, fixed_income_products(*)')
      .is('redeemed_at', null)
      .order('applied_on', { ascending: false }),
    supabase.from('market_holidays').select('date'),
    supabase.rpc('platform_setting', { p_key: 'fees' }),
    supabase.from('portfolios').select('cash_balance').maybeSingle(),
  ]);

  if (products.error) throw new Error(products.error.message);
  if (investments.error) throw new Error(investments.error.message);

  const holidays = new Set((holidayRows.data ?? []).map((row) => row.date));
  const config = parseFeeConfig(fees.data);

  const open: OpenInvestment[] = [];

  for (const row of investments.data ?? []) {
    const product = row.fixed_income_products;
    if (!product) continue;

    const businessDays = countBusinessDays(row.applied_on, today, holidays);
    const currentValue = accrueValue(row.principal, product.annual_rate, businessDays);

    open.push({
      id: row.id,
      product,
      principal: row.principal,
      appliedOn: row.applied_on,
      businessDays,
      currentValue,
      redeemable: canRedeem({
        liquidity: product.liquidity,
        maturityDate: product.maturity_date,
        today,
      }),
      quote: quoteRedemption({
        principal: row.principal,
        accruedValue: currentValue,
        isTaxExempt: product.is_tax_exempt,
        fiTaxRate: config.fiTaxRate,
      }),
    });
  }

  return {
    products: products.data ?? [],
    investments: open,
    holidays,
    config,
    cashBalance: portfolio.data?.cash_balance ?? 0,
    today,
    totalValue: open.reduce((total, item) => total + item.currentValue, 0),
  };
}

export type FixedIncomeResult =
  { status: 'APPLIED' | 'REDEEMED' } | { status: 'REJECTED'; code: string; message: string };

function isRejection(body: unknown): body is Extract<FixedIncomeResult, { status: 'REJECTED' }> {
  if (typeof body !== 'object' || body === null) return false;
  const raw = body as Record<string, unknown>;
  return raw.status === 'REJECTED' && typeof raw.message === 'string';
}

function extractResponse(error: unknown): Response | null {
  if (typeof error !== 'object' || error === null || !('context' in error)) return null;
  const { context } = error;
  return context instanceof Response ? context : null;
}

async function invoke(body: Record<string, unknown>): Promise<FixedIncomeResult> {
  const supabase = getSupabaseClient();

  const result: { data: unknown; error: unknown } = await supabase.functions.invoke(
    'fixed-income',
    { body },
  );

  if (result.error) {
    const response = extractResponse(result.error);
    if (response) {
      const parsed: unknown = await response.json().catch(() => null);
      if (isRejection(parsed)) return parsed;
    }
    throw new Error(
      result.error instanceof Error ? result.error.message : 'Falha na operação de renda fixa',
    );
  }

  if (isRejection(result.data)) return result.data;

  const raw = result.data as Record<string, unknown> | null;
  if (raw?.status === 'APPLIED' || raw?.status === 'REDEEMED') {
    return { status: raw.status };
  }

  throw new Error('Resposta do servidor em formato inesperado');
}

export function applyFixedIncome(productId: string, principal: number): Promise<FixedIncomeResult> {
  return invoke({ action: 'APPLY', productId, principal });
}

export function redeemFixedIncome(investmentId: string): Promise<FixedIncomeResult> {
  return invoke({ action: 'REDEEM', investmentId });
}

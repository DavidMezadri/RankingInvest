import { parseFeeConfig, type FeeConfig, type OrderSide, type Tables } from '@m8invest/core';

import { getSupabaseClient } from '@/lib/supabase';

export type OrderContext = {
  config: FeeConfig;
  cashBalance: number;
  position: { quantity: number; avgPrice: number } | null;
};

/**
 * Tudo que a boleta precisa para calcular o preview: as taxas vigentes, o
 * caixa e a posição atual no ativo.
 *
 * As taxas vêm do banco, não de constante no frontend — é a MESMA linha de
 * `platform_settings` que a Edge Function lê para cobrar. Se o preview usasse
 * um valor próprio, o dia em que a taxa mudasse a tela mostraria um número e
 * o banco debitaria outro.
 */
export async function fetchOrderContext(ticker: string): Promise<OrderContext> {
  const supabase = getSupabaseClient();

  const [fees, portfolio] = await Promise.all([
    supabase.rpc('platform_setting', { p_key: 'fees' }),
    supabase.from('portfolios').select('id, cash_balance').maybeSingle(),
  ]);

  if (!portfolio.data) {
    return { config: parseFeeConfig(fees.data), cashBalance: 0, position: null };
  }

  const { data: position } = await supabase
    .from('positions')
    .select('quantity, avg_price')
    .eq('portfolio_id', portfolio.data.id)
    .eq('ticker', ticker)
    .maybeSingle();

  return {
    config: parseFeeConfig(fees.data),
    cashBalance: portfolio.data.cash_balance,
    position: position ? { quantity: position.quantity, avgPrice: position.avg_price } : null,
  };
}

export type PlaceOrderResult =
  | { status: 'FILLED'; order: Tables<'orders'> }
  | { status: 'REJECTED'; code: string; message: string };

/**
 * O SDK embala a resposta HTTP num campo `context` tipado como `any`. Em vez
 * de destravar o lint com um cast, estreitamos de verdade: se o formato
 * mudar numa atualização do SDK, o guard devolve null e cai no erro genérico,
 * em vez de estourar em tempo de execução com "cannot read property".
 */
function extractResponse(error: unknown): Response | null {
  if (typeof error !== 'object' || error === null || !('context' in error)) return null;
  const { context } = error;
  return context instanceof Response ? context : null;
}

function isRejection(body: unknown): body is Extract<PlaceOrderResult, { status: 'REJECTED' }> {
  if (typeof body !== 'object' || body === null) return false;
  const raw = body as Record<string, unknown>;
  return (
    raw.status === 'REJECTED' && typeof raw.code === 'string' && typeof raw.message === 'string'
  );
}

function isFilled(body: unknown): body is Extract<PlaceOrderResult, { status: 'FILLED' }> {
  if (typeof body !== 'object' || body === null) return false;
  const raw = body as Record<string, unknown>;
  return raw.status === 'FILLED' && typeof raw.order === 'object' && raw.order !== null;
}

/**
 * Envia a ordem.
 *
 * O corpo leva apenas ticker, lado e quantidade. Preço e identidade NÃO são
 * enviados: o preço é lido server-side da tabela `quotes` e o usuário vem do
 * JWT. Se o cliente pudesse informar preço, compraria a R$ 0,01 pelo console
 * do navegador.
 */
export async function placeOrder(input: {
  ticker: string;
  side: OrderSide;
  quantity: number;
}): Promise<PlaceOrderResult> {
  const supabase = getSupabaseClient();

  // O retorno do SDK vem com `data` como `any`, então o resultado é lido como
  // `unknown` e validado pelos guards abaixo — o mesmo tratamento que a
  // resposta de erro recebe. Confiar no genérico daria tipo bonito e nenhuma
  // garantia de que o corpo chegou no formato esperado.
  const result: { data: unknown; error: unknown } = await supabase.functions.invoke('place-order', {
    body: input,
  });
  const { data, error } = result;

  // Uma rejeição chega como HTTP 4xx, que o SDK trata como erro. Mas o corpo
  // traz o código e a mensagem em português — recuperá-los é a diferença
  // entre "Saldo insuficiente" e "FunctionsHttpError" na tela.
  if (error) {
    const response = extractResponse(error);

    if (response) {
      const body: unknown = await response.json().catch(() => null);
      if (isRejection(body)) return body;
    }

    throw new Error(error instanceof Error ? error.message : 'Falha ao enviar a ordem');
  }

  if (isRejection(data)) return data;
  if (isFilled(data)) return data;

  throw new Error('Resposta do servidor em formato inesperado');
}

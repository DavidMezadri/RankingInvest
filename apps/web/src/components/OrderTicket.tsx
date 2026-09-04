import {
  describeRejection,
  formatBRL,
  formatDateTime,
  quoteOrder,
  type OrderQuote,
  type OrderSide,
} from '@m8invest/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchOrderContext, placeOrder } from '@/features/orders/api';
import { cn } from '@/lib/utils';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cn('text-xs', strong ? 'font-medium' : 'text-muted-foreground')}>{label}</dt>
      <dd className={cn('tabular text-sm', strong && 'font-semibold')}>{value}</dd>
    </div>
  );
}

export function OrderTicket({
  ticker,
  referencePrice,
  quotedAt,
  lotSize,
}: {
  ticker: string;
  referencePrice: number;
  quotedAt: string;
  lotSize: number;
}) {
  const [side, setSide] = useState<OrderSide>('BUY');
  const [quantityText, setQuantityText] = useState('');
  const [result, setResult] = useState<
    { kind: 'FILLED'; quote: OrderQuote } | { kind: 'REJECTED'; message: string } | null
  >(null);

  const queryClient = useQueryClient();

  const context = useQuery({
    queryKey: ['order-context', ticker],
    queryFn: () => fetchOrderContext(ticker),
  });

  const quantity = Number(quantityText);
  const validQuantity =
    Number.isInteger(quantity) && quantity > 0 && quantity % lotSize === 0 ? quantity : null;

  const held = context.data?.position ?? null;
  const cashBalance = context.data?.cashBalance ?? 0;

  // O preview usa a MESMA função que a Edge Function chama para cobrar. Não é
  // uma estimativa: é o cálculo, rodando com as taxas lidas do banco.
  let preview: OrderQuote | null = null;
  if (validQuantity !== null && context.data) {
    preview = quoteOrder({
      side,
      quantity: validQuantity,
      referencePrice,
      position: held,
      config: context.data.config,
    });
  }

  const exceedsCash = preview !== null && side === 'BUY' && cashBalance + preview.netAmount < 0;
  const exceedsPosition =
    validQuantity !== null && side === 'SELL' && (held?.quantity ?? 0) < validQuantity;

  const mutation = useMutation({
    mutationFn: () => placeOrder({ ticker, side, quantity: validQuantity ?? 0 }),
    onSuccess: async (response) => {
      if (response.status === 'REJECTED') {
        setResult({
          kind: 'REJECTED',
          message: response.message || describeRejection(response.code),
        });
        return;
      }

      setResult(preview ? { kind: 'FILLED', quote: preview } : null);
      setQuantityText('');
      // Saldo, posição, extrato e a própria boleta mudaram.
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setResult({ kind: 'REJECTED', message: error.message });
    },
  });

  const blocked = validQuantity === null || exceedsCash || exceedsPosition || mutation.isPending;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex gap-1">
        {(['BUY', 'SELL'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setSide(option);
              setResult(null);
            }}
            className={cn(
              'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              side === option
                ? option === 'BUY'
                  ? 'bg-gain text-gain-foreground'
                  : 'bg-loss text-loss-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option === 'BUY' ? 'Comprar' : 'Vender'}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="quantity">Quantidade</Label>
        <Input
          id="quantity"
          type="number"
          min={lotSize}
          step={lotSize}
          inputMode="numeric"
          value={quantityText}
          onChange={(event) => {
            setQuantityText(event.target.value);
            setResult(null);
          }}
          placeholder={lotSize > 1 ? `múltiplo de ${String(lotSize)}` : '0'}
        />
        <p className="text-xs text-muted-foreground">
          {side === 'BUY'
            ? `Caixa disponível: ${formatBRL(cashBalance)}`
            : `Em carteira: ${String(held?.quantity ?? 0)} ${held ? `· médio ${formatBRL(held.avgPrice)}` : ''}`}
        </p>
      </div>

      {preview ? (
        <dl className="mt-4 space-y-2 border-t border-border pt-4">
          <Row
            label={`Preço de execução (${side === 'BUY' ? '+' : '−'}0,${String(context.data?.config.slippageBps ?? 0).padStart(2, '0')}% de slippage)`}
            value={formatBRL(preview.executedPrice)}
          />
          <Row label="Valor bruto" value={formatBRL(preview.grossAmount)} />
          <Row label="Custo de operação" value={`− ${formatBRL(preview.feeAmount)}`} />
          {preview.taxAmount > 0 ? (
            <Row label="IR sobre o lucro (15%)" value={`− ${formatBRL(preview.taxAmount)}`} />
          ) : null}
          {preview.realizedPnl !== null ? (
            <Row
              label="Resultado apurado"
              value={`${preview.realizedPnl >= 0 ? '+' : '−'}${formatBRL(Math.abs(preview.realizedPnl))}`}
            />
          ) : null}
          <div className="border-t border-border pt-2">
            <Row
              label={side === 'BUY' ? 'Sai do caixa' : 'Entra no caixa'}
              value={formatBRL(Math.abs(preview.netAmount))}
              strong
            />
          </div>
          {preview.newAvgPrice !== null ? (
            <Row label="Novo preço médio" value={formatBRL(preview.newAvgPrice)} />
          ) : null}
        </dl>
      ) : null}

      {exceedsCash ? (
        <p className="mt-3 text-sm text-loss">{describeRejection('INSUFFICIENT_CASH')}</p>
      ) : null}
      {exceedsPosition ? (
        <p className="mt-3 text-sm text-loss">{describeRejection('INSUFFICIENT_POSITION')}</p>
      ) : null}
      {quantityText !== '' && validQuantity === null ? (
        <p className="mt-3 text-sm text-loss">
          {describeRejection(lotSize > 1 ? 'INVALID_LOT' : 'INVALID_QUANTITY')}
        </p>
      ) : null}

      <Button
        className="mt-4 w-full"
        disabled={blocked}
        onClick={() => {
          mutation.mutate();
        }}
      >
        {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {side === 'BUY' ? 'Confirmar compra' : 'Confirmar venda'}
      </Button>

      {result?.kind === 'FILLED' ? (
        <p role="status" className="mt-3 flex items-start gap-2 text-sm text-gain">
          <CircleCheck className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Executada: {result.quote.quantity} {ticker} a {formatBRL(result.quote.executedPrice)}.
          </span>
        </p>
      ) : null}

      {result?.kind === 'REJECTED' ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-loss">
          <TriangleAlert className="mt-0.5 shrink-0" aria-hidden />
          <span>{result.message}</span>
        </p>
      ) : null}

      {/* A idade do preço fica ao lado do botão de confirmar, e não escondida
          no topo da página: é neste momento que ela muda a decisão. */}
      <p className="mt-4 text-xs text-muted-foreground">
        Executa ao preço de {formatDateTime(quotedAt)}, com slippage aplicado contra você. Cotação
        com atraso da fonte — não é o preço do instante.
      </p>
    </section>
  );
}

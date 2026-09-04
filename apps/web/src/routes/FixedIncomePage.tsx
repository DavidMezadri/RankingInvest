import {
  accrueValue,
  countBusinessDays,
  formatBRL,
  formatDate,
  formatPercent,
  quoteRedemption,
  type Enums,
} from '@m8invest/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, Lock, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  applyFixedIncome,
  fetchFixedIncome,
  redeemFixedIncome,
  type FixedIncomeProduct,
} from '@/features/fixed-income/api';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<Enums<'fi_kind'>, string> = {
  CDB: 'CDB',
  LCI: 'LCI',
  LCA: 'LCA',
  TESOURO: 'Tesouro',
};

function Field({ label, value, tone }: { label: string; value: string; tone?: 'gain' }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular mt-0.5 text-sm font-medium', tone === 'gain' && 'text-gain')}>
        {value}
      </dd>
    </div>
  );
}

export function FixedIncomePage() {
  const [selected, setSelected] = useState<FixedIncomeProduct | null>(null);
  const [amountText, setAmountText] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const queryClient = useQueryClient();

  const snapshot = useQuery({ queryKey: ['fixed-income'], queryFn: fetchFixedIncome });

  const amount = Number(amountText.replace(',', '.'));
  const validAmount =
    Number.isFinite(amount) && amount > 0 && Math.round(amount * 100) === amount * 100
      ? amount
      : null;

  const apply = useMutation({
    mutationFn: () => applyFixedIncome(selected?.id ?? '', validAmount ?? 0),
    onSuccess: async (result) => {
      if (result.status === 'REJECTED') {
        setFeedback({ ok: false, message: result.message });
        return;
      }
      setFeedback({ ok: true, message: 'Aplicação realizada.' });
      setAmountText('');
      setSelected(null);
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => setFeedback({ ok: false, message: error.message }),
  });

  const redeem = useMutation({
    mutationFn: (investmentId: string) => redeemFixedIncome(investmentId),
    onSuccess: async (result) => {
      if (result.status === 'REJECTED') {
        setFeedback({ ok: false, message: result.message });
        return;
      }
      setFeedback({ ok: true, message: 'Resgate realizado.' });
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => setFeedback({ ok: false, message: error.message }),
  });

  const data = snapshot.data;

  // Projeção até o vencimento, calculada com as MESMAS funções do resgate.
  // É o que torna a comparação entre um produto isento e um tributado
  // honesta: a taxa nominal maior não vence sempre.
  let projection: { businessDays: number; gross: number; net: number; yieldNet: number } | null =
    null;

  if (selected && validAmount !== null && data) {
    const businessDays = countBusinessDays(data.today, selected.maturity_date, data.holidays);
    const gross = accrueValue(validAmount, selected.annual_rate, businessDays);
    const quote = quoteRedemption({
      principal: validAmount,
      accruedValue: gross,
      isTaxExempt: selected.is_tax_exempt,
      fiTaxRate: data.config.fiTaxRate,
    });
    projection = {
      businessDays,
      gross,
      net: quote.netAmount,
      yieldNet: quote.netAmount - validAmount,
    };
  }

  const insufficient = validAmount !== null && data !== undefined && validAmount > data.cashBalance;
  const belowMinimum =
    validAmount !== null && selected !== null && validAmount < selected.min_investment;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Renda fixa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Taxas prefixadas, rendimento acruado por dia útil em base 252 — a convenção do mercado
          brasileiro. Fim de semana e feriado não rendem.
        </p>
      </div>

      {feedback ? (
        <p
          role="status"
          className={cn(
            'mb-5 flex items-start gap-2 rounded-lg border p-3 text-sm',
            feedback.ok ? 'border-gain/40 bg-gain-muted' : 'border-loss/40 bg-loss-muted',
          )}
        >
          {feedback.ok ? (
            <CircleCheck className="mt-0.5 shrink-0 text-gain" aria-hidden />
          ) : (
            <TriangleAlert className="mt-0.5 shrink-0 text-loss" aria-hidden />
          )}
          <span>{feedback.message}</span>
        </p>
      ) : null}

      {snapshot.isPending ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
        </div>
      ) : snapshot.isError ? (
        <div className="rounded-lg border border-loss/40 bg-loss-muted p-4 text-sm">
          <p className="font-medium">Não foi possível carregar a renda fixa</p>
          <p className="mt-1 text-muted-foreground">{snapshot.error.message}</p>
        </div>
      ) : !data ? null : (
        <>
          {data.investments.length > 0 ? (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-medium">
                Minhas aplicações · {formatBRL(data.totalValue)}
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Produto</th>
                      <th className="px-4 py-2 text-right font-medium">Aplicado</th>
                      <th className="px-4 py-2 text-right font-medium">Valor hoje</th>
                      <th className="px-4 py-2 text-right font-medium">Rendimento</th>
                      <th className="px-4 py-2 text-right font-medium">Líquido no resgate</th>
                      <th className="px-4 py-2 text-right font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.investments.map((item) => (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-4 py-2">
                          <span className="font-medium">{item.product.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {formatPercent(item.product.annual_rate)} a.a. · vence{' '}
                            {formatDate(item.product.maturity_date)} ·{' '}
                            {item.businessDays === 0
                              ? 'aplicado hoje'
                              : `${String(item.businessDays)} dias úteis`}
                          </span>
                        </td>
                        <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                          {formatBRL(item.principal)}
                        </td>
                        <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                          {formatBRL(item.currentValue)}
                        </td>
                        <td
                          className={cn(
                            'tabular px-4 py-2 text-right whitespace-nowrap',
                            item.quote.yieldAmount > 0 ? 'text-gain' : 'text-muted-foreground',
                          )}
                        >
                          {item.quote.yieldAmount > 0 ? '+' : ''}
                          {formatBRL(item.quote.yieldAmount)}
                        </td>
                        <td className="tabular px-4 py-2 text-right whitespace-nowrap">
                          {formatBRL(item.quote.netAmount)}
                          {item.quote.taxAmount > 0 ? (
                            <span className="block text-xs text-muted-foreground">
                              IR {formatBRL(item.quote.taxAmount)}
                            </span>
                          ) : item.product.is_tax_exempt ? (
                            <span className="block text-xs text-gain">isento de IR</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {item.redeemable ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={redeem.isPending}
                              onClick={() => {
                                redeem.mutate(item.id);
                              }}
                            >
                              Resgatar
                            </Button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Lock className="size-3" aria-hidden />
                              no vencimento
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-3 text-sm font-medium">Produtos disponíveis</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.products.map((product) => {
                const isSelected = selected?.id === product.id;

                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => {
                      setSelected(isSelected ? null : product);
                      setFeedback(null);
                    }}
                    className={cn(
                      'rounded-lg border border-border bg-card p-4 text-left transition-colors',
                      isSelected ? 'border-primary' : 'hover:border-muted-foreground/40',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{product.name}</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {KIND_LABEL[product.kind]}
                      </span>
                    </div>
                    <p className="tabular mt-2 text-lg font-semibold text-gain">
                      {formatPercent(product.annual_rate)} a.a.
                    </p>
                    <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      <div>Vence {formatDate(product.maturity_date)}</div>
                      <div>
                        {product.liquidity === 'DAILY'
                          ? 'Liquidez diária'
                          : 'Resgate no vencimento'}
                      </div>
                      <div>Mínimo {formatBRL(product.min_investment)}</div>
                      {product.is_tax_exempt ? (
                        <div className="text-gain">Isento de IR</div>
                      ) : (
                        <div>IR de {formatPercent(data.config.fiTaxRate)} sobre o rendimento</div>
                      )}
                    </dl>
                  </button>
                );
              })}
            </div>
          </section>

          {selected ? (
            <section className="mt-6 rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Aplicar em {selected.name}</h2>

              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="amount">Valor</Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(event) => {
                    setAmountText(event.target.value);
                    setFeedback(null);
                  }}
                  placeholder={`mínimo ${formatBRL(selected.min_investment)}`}
                />
                <p className="text-xs text-muted-foreground">
                  Caixa disponível: {formatBRL(data.cashBalance)}
                </p>
              </div>

              {projection ? (
                <dl className="mt-4 grid max-w-2xl grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
                  <Field
                    label="Dias úteis até o vencimento"
                    value={String(projection.businessDays)}
                  />
                  <Field label="Valor bruto" value={formatBRL(projection.gross)} />
                  <Field label="Líquido de IR" value={formatBRL(projection.net)} />
                  <Field
                    label="Rendimento líquido"
                    value={`+${formatBRL(projection.yieldNet)}`}
                    tone="gain"
                  />
                </dl>
              ) : null}

              {belowMinimum ? (
                <p className="mt-3 text-sm text-loss">
                  O mínimo deste produto é {formatBRL(selected.min_investment)}.
                </p>
              ) : null}
              {insufficient ? (
                <p className="mt-3 text-sm text-loss">Saldo em caixa insuficiente.</p>
              ) : null}

              <Button
                className="mt-4"
                disabled={validAmount === null || belowMinimum || insufficient || apply.isPending}
                onClick={() => {
                  apply.mutate();
                }}
              >
                {apply.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Confirmar aplicação
              </Button>

              {selected.liquidity === 'AT_MATURITY' ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Este produto não pode ser resgatado antes de {formatDate(selected.maturity_date)}.
                  A taxa maior é o preço dessa restrição.
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </AppShell>
  );
}

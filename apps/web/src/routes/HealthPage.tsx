import { DEFAULT_INITIAL_CASH, formatBRL, money } from '@m8invest/core';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { envResult } from '@/lib/env';
import { pingSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Status = 'ok' | 'fail' | 'pending';

function StatusDot({ status }: { status: Status }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-1.5 size-2 shrink-0 rounded-full',
        status === 'ok' && 'bg-gain',
        status === 'fail' && 'bg-loss',
        status === 'pending' && 'animate-pulse bg-muted-foreground',
      )}
    />
  );
}

const STATUS_LABEL: Record<Status, string> = {
  ok: 'OK',
  fail: 'Falha',
  pending: 'Verificando',
};

function StatusRow({
  status,
  title,
  children,
}: {
  status: Status;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3 border-b border-border py-4 last:border-b-0">
      <StatusDot status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium">{title}</h2>
          <span
            className={cn(
              'text-xs font-medium',
              status === 'ok' && 'text-gain',
              status === 'fail' && 'text-loss',
              status === 'pending' && 'text-muted-foreground',
            )}
          >
            {STATUS_LABEL[status]}
          </span>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export function HealthPage() {
  // Prova que o pacote de domínio está linkado e que o arredondamento
  // determinístico funciona no bundle, não só no Vitest.
  const roundingWorks = money(0.1 + 0.2) === 0.3 && money(1.005) === 1.01;

  const ping = useQuery({
    queryKey: ['supabase', 'ping'],
    queryFn: pingSupabase,
    enabled: envResult.ok,
    retry: false,
  });

  const supabaseStatus: Status = !envResult.ok
    ? 'fail'
    : ping.isPending
      ? 'pending'
      : ping.data?.ok
        ? 'ok'
        : 'fail';

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <header className="mb-10">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="size-5 text-gain" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">M8.Invest</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Fase 0 — Fundação</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta tela existe para confirmar que a base está de pé: build, pacote de domínio,
            roteamento SPA e conexão com o Supabase. Ela sai do ar na Fase 1, quando entra o login.
          </p>
        </header>

        <ul className="rounded-lg border border-border bg-card px-5">
          <StatusRow status="ok" title="Build e runtime">
            Vite + React 19 + TypeScript 6, Tailwind v4 com tokens do shadcn/ui. Os tokens{' '}
            <code className="text-foreground">--gain</code> e{' '}
            <code className="text-foreground">--loss</code> são as bolinhas coloridas desta lista.
          </StatusRow>

          <StatusRow
            status={roundingWorks ? 'ok' : 'fail'}
            title="Pacote de domínio (@m8invest/core)"
          >
            Aritmética monetária determinística ativa. Saldo inicial padrão de uma temporada:{' '}
            <span className="tabular font-medium text-foreground">
              {formatBRL(DEFAULT_INITIAL_CASH)}
            </span>
            .
          </StatusRow>

          <StatusRow status="ok" title="Roteamento SPA">
            React Router respondendo em <code className="text-foreground">/</code>. Qualquer outra
            rota cai no fallback — é o que o redirect 200 do{' '}
            <code className="text-foreground">netlify.toml</code> garante em produção.
          </StatusRow>

          <StatusRow status={supabaseStatus} title="Supabase">
            {!envResult.ok ? (
              <>
                <p>
                  Copie <code className="text-foreground">.env.example</code> para{' '}
                  <code className="text-foreground">apps/web/.env.local</code> e preencha com os
                  dados do projeto (Settings → API):
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5">
                  {envResult.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                {ping.data?.detail ?? 'Consultando /rest/v1/…'}
                {ping.data && ping.data.status > 0 ? ` (HTTP ${String(ping.data.status)})` : null}
              </>
            )}
          </StatusRow>
        </ul>

        <footer className="mt-10 space-y-2 text-xs text-muted-foreground">
          <p>
            Próximo: Fase 1 — Supabase Auth com Google, e-mail/senha e magic link, tabela{' '}
            <code>profiles</code>, temporada ativa e criação automática da carteira com{' '}
            {formatBRL(DEFAULT_INITIAL_CASH)}.
          </p>
          <p>
            Simulação com fins educacionais. Cotações com atraso. Não constitui recomendação de
            investimento.
          </p>
        </footer>
      </div>
    </div>
  );
}

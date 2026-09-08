import { DEFAULT_INITIAL_CASH, formatBRL, money } from '@m8invest/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { Logo } from '@/components/Logo';
import { envResult } from '@/lib/env';
import { checkSupabaseHealth } from '@/lib/supabase';
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

  const health = useQuery({
    queryKey: ['supabase', 'health'],
    queryFn: checkSupabaseHealth,
    enabled: envResult.ok,
    retry: false,
  });

  const supabaseStatus: Status = !envResult.ok
    ? 'fail'
    : health.isPending
      ? 'pending'
      : health.data?.ok
        ? 'ok'
        : 'fail';

  const auth = health.data?.ok ? health.data.auth : null;

  // O que ainda falta configurar no dashboard do Supabase para o login rodar
  // completo. Nada disso quebra o build, então só aparece aqui.
  const authPending = auth
    ? [
        !auth.email && 'provedor de e-mail desligado (Authentication → Sign In / Providers)',
        !auth.google && 'Google OAuth não configurado (precisa de credencial no Google Cloud)',
        !auth.signupsEnabled && 'cadastro de novos usuários desabilitado',
      ].filter((item): item is string => typeof item === 'string')
    : [];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16">
        {/* Esta tela tem dois papéis: a rota /diagnostico, aberta de propósito,
            e o fallback de `main.tsx` quando o ambiente não valida. No segundo
            caso ela é a ÚNICA coisa que o visitante vê, então o cabeçalho diz
            qual dos dois é — anunciar "diagnóstico" para quem só queria entrar
            no site esconde que existe algo a corrigir. */}
        <header className="mb-10">
          <Logo className="mb-3" />
          <h1 className="text-2xl font-semibold tracking-tight">
            {envResult.ok ? 'Diagnóstico' : 'Configuração incompleta'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {envResult.ok
              ? 'Estado do build, do pacote de domínio e da conexão com o Supabase.'
              : 'O app não subiu porque faltam as variáveis de ambiente do Supabase. O restante da base está de pé — veja abaixo o que corrigir.'}
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
                <ul className="list-disc space-y-0.5 pl-5">
                  {envResult.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>

                {/* A instrução precisa distinguir os dois ambientes. Mandar
                    editar `.env.local` é inútil em produção, onde esse arquivo
                    não existe: o Vite grava as variáveis DENTRO do bundle
                    durante o build, então na Netlify o conserto é cadastrar e
                    reconstruir — e um redeploy comum reaproveita o build
                    anterior, o que faz a correção parecer não ter funcionado. */}
                <p className="mt-3 font-medium text-foreground">Rodando local</p>
                <p>
                  Copie <code className="text-foreground">.env.example</code> para{' '}
                  <code className="text-foreground">apps/web/.env.local</code> e preencha com os
                  valores de Supabase → Project Settings → API Keys.
                </p>

                <p className="mt-3 font-medium text-foreground">Publicado na Netlify</p>
                <p>
                  Cadastre as duas em Site configuration → Environment variables e refaça o build em
                  Deploys → Trigger deploy → <em>Clear cache and deploy site</em>. As variáveis são
                  gravadas no bundle durante o build, por isso um redeploy comum não basta.
                </p>
              </>
            ) : auth ? (
              <>
                <p>
                  Projeto respondendo e publishable key aceita. Provedores de login ativos:{' '}
                  <span className="text-foreground">
                    {[auth.email && 'e-mail e magic link', auth.google && 'Google']
                      .filter(Boolean)
                      .join(', ') || 'nenhum'}
                  </span>
                  .
                </p>
                {auth.emailConfirmationRequired ? (
                  <p className="mt-1">
                    Confirmação de e-mail exigida — no free tier o SMTP do Supabase entrega poucos
                    e-mails por hora, então vale plugar Resend antes de abrir cadastro público.
                  </p>
                ) : null}
                {authPending.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5">
                    {authPending.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <>
                {health.data?.ok === false ? health.data.detail : 'Consultando /auth/v1/settings…'}
                {health.data && health.data.status > 0
                  ? ` (HTTP ${String(health.data.status)})`
                  : null}
              </>
            )}
          </StatusRow>
        </ul>

        <footer className="mt-10 space-y-2 text-xs text-muted-foreground">
          <p>
            Simulação com fins educacionais. Cotações com atraso. Não constitui recomendação de
            investimento.
          </p>
        </footer>
      </div>
    </div>
  );
}

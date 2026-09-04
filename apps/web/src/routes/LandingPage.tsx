import { DEFAULT_INITIAL_CASH, formatBRL } from '@m8invest/core';
import { CalendarClock, Landmark, LineChart, Receipt, Trophy } from 'lucide-react';
import { Link, Navigate } from 'react-router';

import { Logo } from '@/components/Logo';
import { buttonVariants } from '@/components/ui/button-variants';
import { useAuth } from '@/features/auth/useAuth';

const FEATURES = [
  {
    Icon: LineChart,
    title: '151 ativos com preço real',
    body: 'Ações, FIIs, units e BDR da B3, sincronizados a cada 30 minutos em horário de mercado. Cada ticker foi validado contra a fonte — nada de papel que saiu da bolsa.',
  },
  {
    Icon: Receipt,
    title: 'Custos que existem de verdade',
    body: 'Emolumentos de 0,0325% por operação, IR de 15% sobre o lucro na venda e deslize de preço contra você. A boleta mostra tudo antes de confirmar, calculado pelo mesmo código que cobra depois.',
  },
  {
    Icon: Landmark,
    title: 'Renda fixa com a matemática certa',
    body: 'CDB, LCI, LCA e Tesouro rendendo por dia útil em base 252 — a convenção do mercado brasileiro. Fim de semana e feriado não rendem, e LCI e LCA são isentas de IR.',
  },
  {
    Icon: CalendarClock,
    title: 'Histórico de patrimônio',
    body: 'Fechamento diário automático grava a evolução da sua carteira. A curva mostra o que aconteceu, e o extrato reconstrói o saldo ao centavo.',
  },
  {
    Icon: Trophy,
    title: 'Ranking por temporada',
    body: 'Todos começam com o mesmo saldo e a classificação é apurada no fechamento. Sem vantagem de quem entrou antes.',
  },
];

export function LandingPage() {
  const { user, loading } = useAuth();

  // Quem já está logado não precisa de página de apresentação.
  if (!loading && user) {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Logo />
        <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Entrar
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-16">
        <section className="py-12 sm:py-20">
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">
            Aprenda a investir sem arriscar dinheiro de verdade.
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Você começa com {formatBRL(DEFAULT_INITIAL_CASH)} fictícios e opera com preços reais da
            B3. As taxas, o imposto e as regras de liquidez são os da vida real — porque errar num
            simulador que ignora custos não ensina nada.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login" className={buttonVariants({ size: 'lg' })}>
              Criar conta grátis
            </Link>
            <Link to="/termos" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Como funciona
            </Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-5">
              <Icon className="size-5 text-gain" aria-hidden />
              <h2 className="mt-3 font-medium">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        {/* O disclaimer não fica escondido no rodapé em letra miúda: quem
            chega na página precisa entender, antes de criar conta, que isto
            não é uma corretora. */}
        <section className="mt-8 rounded-lg border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-medium">O que este serviço não é</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Não é corretora nem plataforma de investimento. Nenhum dinheiro real é movimentado,
            custodiado ou investido, e nada aqui é recomendação de investimento. As cotações vêm de
            fontes públicas com atraso de cerca de 30 minutos, os produtos de renda fixa são
            fictícios, e as regras de tributação são simplificadas em relação às reais. É uma
            ferramenta para aprender — os{' '}
            <Link to="/termos" className="underline underline-offset-2 hover:text-foreground">
              termos
            </Link>{' '}
            detalham cada simplificação.
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-xs text-muted-foreground">
          <span>M8.Invest · simulador educacional</span>
          <Link to="/termos" className="underline underline-offset-2 hover:text-foreground">
            Termos e privacidade
          </Link>
        </div>
      </footer>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Logo } from '@/components/Logo';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export function TermsPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link to="/" aria-label="M8.Invest, início">
          <Logo className="mb-8" />
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">Termos de uso e privacidade</h1>
        <p className="mt-2 text-sm text-muted-foreground">Atualizado em 4 de setembro de 2026.</p>

        <Section title="O que este serviço é">
          <p>
            O M8.Invest é um <strong>simulador educacional</strong>. Você recebe um saldo fictício e
            opera com preços reais da B3, mas nenhum dinheiro real é movimentado, custodiado ou
            investido. Não há conta bancária, corretora, custódia nem qualquer produto financeiro
            envolvido.
          </p>
          <p>
            Nada aqui é recomendação, oferta ou análise de investimento. O simulador não avalia seu
            perfil, não sugere ativos e não deve orientar decisão financeira real. Rentabilidade
            passada de qualquer ativo não indica rentabilidade futura.
          </p>
        </Section>

        <Section title="Sobre os dados de mercado">
          <p>
            As cotações vêm de fontes públicas de terceiros e chegam <strong>com atraso</strong> —
            tipicamente 30 minutos ou mais. O simulador exibe a idade de cada preço e aplica um
            deslize (<em>slippage</em>) na execução justamente porque o preço mostrado não é o do
            instante.
          </p>
          <p>
            Taxas, impostos e regras de liquidez são <strong>simplificados</strong>. O custo por
            operação é único (0,0325%), o imposto de renda é uma alíquota fixa, e não há compensação
            de prejuízo, IOF, isenção mensal nem emissão de DARF. A tributação real de investimentos
            no Brasil é mais complexa que a modelada aqui.
          </p>
          <p>
            Os produtos de renda fixa são <strong>fictícios</strong>, com taxas plausíveis mas não
            correspondentes a ofertas de mercado. &ldquo;Banco Simulado S.A.&rdquo; não existe.
          </p>
        </Section>

        <Section title="Dados que coletamos">
          <p>
            Apenas o seu <strong>e-mail</strong> (para autenticar) e um{' '}
            <strong>nome de exibição</strong> que você pode editar. Se você entrar com Google,
            também recebemos o nome e a foto do perfil que o Google fornece.
          </p>
          <p>
            Guardamos ainda o que você faz no simulador: ordens, aplicações, saldo e histórico de
            patrimônio. Nada disso é vendido, compartilhado com terceiros para publicidade nem usado
            para perfilar você fora do serviço.
          </p>
          <p>
            O <strong>nome de exibição aparece no ranking</strong> para todos os usuários logados.
            No primeiro acesso ele é gerado a partir da parte local do seu e-mail — se você não
            quiser que outros vejam isso, troque o nome na tela de ranking.
          </p>
        </Section>

        <Section title="Seus direitos">
          <p>
            Você pode corrigir seu nome de exibição a qualquer momento no próprio serviço. Para
            solicitar exportação ou exclusão da sua conta e de todos os dados associados, entre em
            contato pelo e-mail cadastrado como responsável pelo projeto.
          </p>
          <p>
            Excluir a conta remove o perfil, as carteiras, as ordens e o histórico — a exclusão é
            definitiva e não há backup recuperável do lado do usuário.
          </p>
        </Section>

        <Section title="Limitação de responsabilidade">
          <p>
            O serviço é oferecido &ldquo;como está&rdquo;, sem garantia de disponibilidade, exatidão
            de dados ou continuidade. Ele depende de fontes de terceiros que podem mudar ou sair do
            ar, e roda em infraestrutura de plano gratuito.
          </p>
          <p>
            Não nos responsabilizamos por decisões financeiras tomadas com base no simulador, nem
            por perdas decorrentes de indisponibilidade, erro de cálculo ou dado de mercado
            incorreto.
          </p>
        </Section>

        <p className="mt-10 text-xs text-muted-foreground">
          <Link to="/" className="underline underline-offset-2 hover:text-foreground">
            Voltar ao início
          </Link>
        </p>
      </div>
    </div>
  );
}

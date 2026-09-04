# M8.Invest

Portal de simulação de investimentos espelhado na B3: ações, FIIs e renda fixa,
com taxas, ranking e temporadas. Roda inteiro em free tier.

O plano completo — decisões, modelo de dados, roadmap e riscos — está em
[PLANO.md](PLANO.md).

> Simulação com fins educacionais. Cotações com atraso. Não constitui
> recomendação de investimento.

## Stack

| Camada     | Escolha                                                              |
| ---------- | -------------------------------------------------------------------- |
| Frontend   | Vite + React 19 + TypeScript 6, Tailwind v4, shadcn/ui, React Router |
| Dados      | TanStack Query, Supabase JS                                          |
| Backend    | Supabase — Postgres com RLS, Edge Functions (Deno), pg_cron          |
| Cotações   | brapi.dev, cacheada no Postgres                                      |
| Hospedagem | Netlify (site estático)                                              |
| Monorepo   | npm workspaces                                                       |

## Estrutura

```
apps/web/         SPA React — é o único artefato publicado na Netlify
packages/core/    Domínio puro em TS: dinheiro, taxas, IR, P&L, calendário
supabase/         Migrations, Edge Functions e seed
```

`packages/core` não tem dependência de runtime e usa imports com extensão
`.ts` explícita — assim o mesmo código roda no Vite, no Vitest e no Deno das
Edge Functions, sem build intermediário. A regra de cálculo de uma ordem é
escrita uma vez e usada tanto para o preview na boleta quanto para a cobrança.

## Rodando localmente

```bash
npm install
cp .env.example apps/web/.env.local   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev                            # http://localhost:5173
```

A tela inicial da Fase 0 confere build, pacote de domínio, roteamento SPA e
conexão com o Supabase. Sem `.env.local` ela ainda abre, mostrando o que falta.

## Comandos

| Comando             | O que faz                                            |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Servidor de desenvolvimento do frontend              |
| `npm run build`     | Typecheck + build de produção em `apps/web/dist`     |
| `npm test`          | Testes do domínio (Vitest)                           |
| `npm run typecheck` | `tsc --noEmit` em todos os workspaces                |
| `npm run lint`      | ESLint com regras type-aware                         |
| `npm run format`    | Prettier em tudo                                     |
| `npm run check`     | Formatação + lint + tipos + testes (o que o CI roda) |

Banco e funções (requerem `npx supabase link` no projeto):

| Comando                   | O que faz                                     |
| ------------------------- | --------------------------------------------- |
| `npm run db:push`         | Aplica as migrations no projeto remoto        |
| `npm run db:diff -- nome` | Gera migration a partir de mudanças no schema |
| `npm run db:types`        | Regera `packages/core/src/db.types.ts`        |
| `npm run fn:deploy`       | Publica as Edge Functions                     |

## Segurança — regras que não se negociam

1. `BRAPI_TOKEN` e `SUPABASE_SERVICE_ROLE_KEY` só existem como secrets de Edge
   Function. Numa SPA, qualquer variável `VITE_*` vai para o bundle e é pública.
2. O frontend nunca envia preço numa ordem. O preço de execução é lido
   server-side da tabela `quotes`.
3. `orders`, `positions`, `portfolios` e `ledger_entries` são somente-leitura
   via RLS. Toda escrita passa pela RPC transacional.

## Variáveis na Netlify

Apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Nada mais.

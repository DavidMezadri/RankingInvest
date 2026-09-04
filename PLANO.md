# M8.Invest — Plano de Construção

Portal de simulação de investimentos (paper trading) espelhado na B3, com renda fixa,
taxas, ranking e temporadas. Hospedado 100% em free tier.

> **Disclaimer obrigatório no produto:** simulação com fins educacionais, cotações com
> atraso, não constitui recomendação de investimento. Precisa aparecer no rodapé, na
> boleta e nos termos de uso.

---

## 1. Decisões travadas

| Tema              | Decisão                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| Cotações          | **Yahoo Finance** primário (sem cota) + **brapi** reserva, cacheado no Postgres |
| Execução de ordem | **Preço atual + slippage**, execução imediata                                   |
| Escopo MVP        | **Ações e FIIs à vista** + **renda fixa**                                       |
| Taxas / IR        | **Simplificado**: taxa % por operação + IR na venda/resgate                     |
| Social            | **Ranking global + temporadas**                                                 |
| Frontend          | **Vite + React + TypeScript (SPA)** na Netlify                                  |
| Jobs              | **Supabase pg_cron + Edge Functions**                                           |
| Renda fixa        | **Taxa anual fixa**, acruamento por dia útil (base 252)                         |
| Auth              | **Google OAuth + e-mail/senha + magic link** (Supabase Auth)                    |
| Lógica de ordem   | **Híbrido**: regra em TS na Edge Function, escrita final em RPC transacional    |
| Universo          | **~150 ativos** (IBOV + FIIs líquidos), curados                                 |
| UI                | **Tailwind + shadcn/ui**, gráficos com lightweight-charts + Recharts            |

**Fora do MVP (v2+):** proventos e eventos corporativos, derivativos, venda a
descoberto, indexadores reais (CDI/IPCA via API do BCB), taxas e IR realistas
(emolumentos B3, isenção de R$ 20k, compensação de prejuízo, DARF), ligas privadas.

---

## 2. Arquitetura

```
┌────────────────────────┐        ┌──────────────────────────────────────┐
│  Netlify (estático)    │        │  Supabase                            │
│  Vite + React + TS     │        │                                      │
│                        │        │  Postgres + RLS                      │
│  - publishable key     │──JWT──▶│   ├─ tabelas de domínio              │
│  - nunca vê brapi token│        │   ├─ RPC execute_order_tx (SECURITY   │
│                        │        │   │   DEFINER, transacional)         │
│  lê cotações do cache  │        │   └─ pg_cron + pg_net                │
└────────────────────────┘        │                                      │
                                  │  Edge Functions (Deno/TS)            │
                                  │   ├─ place-order    (chamada do app) │
                                  │   ├─ sync-quotes    (cron 15min)     │
                                  │   ├─ close-day      (cron 18:30)     │
                                  │   └─ fixed-income   (aplicar/resgatar)│
                                  │                                      │
                                  │  Secrets: BRAPI_TOKEN, SECRET_KEY    │
                                  └──────────────┬───────────────────────┘
                                                 │
                                          ┌──────▼───────┐
                                          │  brapi.dev   │
                                          └──────────────┘
```

**Regras invioláveis de segurança:**

1. O `BRAPI_TOKEN` existe **só** em secret de Edge Function. Numa SPA, qualquer
   variável `VITE_*` é pública — se o token for pro bundle, ele vaza.
2. O frontend **nunca** manda preço na ordem. O preço de execução é lido
   server-side da tabela `quotes`. Se o cliente pudesse mandar preço, o
   simulador acabava no primeiro dia.
3. `orders`, `positions`, `ledger_entries` e `portfolios` são **read-only** via RLS.
   Toda escrita passa pela RPC.
4. A secret key (`sb_secret_…`, antes `service_role`) só como secret do
   Supabase — nunca no repo, nunca na Netlify, nunca por chat. Se circular,
   revogue e gere outra: no formato novo isso é instantâneo e não invalida
   mais nada do projeto.

---

## 3. Modelo de dados

Convenções: dinheiro em `numeric(18,2)`, preços e fatores em `numeric(18,6)`,
quantidade em `integer`. **Nunca `float`/`double`.** Timestamps em `timestamptz`
(UTC), cálculos de calendário em `America/Sao_Paulo`.

```sql
-- ── identidade e temporada ────────────────────────────────────────────────
create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text not null,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

create table seasons (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  initial_cash  numeric(18,2) not null default 20000.00,
  is_active     boolean not null default false
);
create unique index on seasons (is_active) where is_active;  -- só uma ativa

create table portfolios (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  season_id     uuid not null references seasons(id),
  cash_balance  numeric(18,2) not null,
  created_at    timestamptz not null default now(),
  unique (user_id, season_id)
);

-- ── universo e mercado ───────────────────────────────────────────────────
create type asset_type as enum ('STOCK','FII','UNIT','BDR');

create table assets (
  ticker      text primary key,
  name        text not null,
  type        asset_type not null,
  sector      text,
  lot_size    integer not null default 1,
  is_tradable boolean not null default true
);

-- snapshot do último preço conhecido (1 linha por ticker)
create table quotes (
  ticker      text primary key references assets(ticker),
  price       numeric(18,6) not null,
  prev_close  numeric(18,6),
  change_pct  numeric(10,4),
  volume      bigint,
  fetched_at  timestamptz not null,
  source      text not null default 'brapi'
);

-- candles diários, para gráficos e para o snapshot de fechamento
create table daily_candles (
  ticker  text not null references assets(ticker),
  date    date not null,
  open    numeric(18,6), high numeric(18,6),
  low     numeric(18,6), close numeric(18,6) not null,
  volume  bigint,
  primary key (ticker, date)
);

create table market_holidays (date date primary key, name text);

-- ── ordens, posições, contabilidade ──────────────────────────────────────
create type order_side   as enum ('BUY','SELL');
create type order_status as enum ('FILLED','REJECTED');

create table orders (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references portfolios(id) on delete cascade,
  ticker         text not null references assets(ticker),
  side           order_side not null,
  quantity       integer not null check (quantity > 0),
  status         order_status not null,
  reference_price numeric(18,6),   -- preço do cache
  executed_price numeric(18,6),    -- com slippage
  gross_amount   numeric(18,2),
  fee_amount     numeric(18,2),
  tax_amount     numeric(18,2),    -- IR retido na venda
  net_amount     numeric(18,2),    -- efeito real no caixa
  realized_pnl   numeric(18,2),    -- só em venda
  rejection_code text,
  created_at     timestamptz not null default now()
);
create index on orders (portfolio_id, created_at desc);

create table positions (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  ticker       text not null references assets(ticker),
  quantity     integer not null check (quantity >= 0),
  avg_price    numeric(18,6) not null,
  unique (portfolio_id, ticker)
);

create type ledger_kind as enum
  ('DEPOSIT','BUY','SELL','FEE','TAX','FI_APPLY','FI_REDEEM','FI_INTEREST');

create table ledger_entries (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  kind         ledger_kind not null,
  amount       numeric(18,2) not null,   -- assinado: + entra, - sai
  description  text not null,
  order_id     uuid references orders(id),
  investment_id uuid,
  occurred_at  timestamptz not null default now()
);
create index on ledger_entries (portfolio_id, occurred_at desc);

-- ── renda fixa simplificada ──────────────────────────────────────────────
create type fi_kind      as enum ('CDB','LCI','LCA','TESOURO');
create type fi_liquidity as enum ('DAILY','AT_MATURITY');

create table fixed_income_products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  issuer         text not null,
  kind           fi_kind not null,
  annual_rate    numeric(10,6) not null,   -- ex: 0.1250 = 12,50% a.a.
  maturity_date  date not null,
  min_investment numeric(18,2) not null default 100.00,
  liquidity      fi_liquidity not null,
  is_tax_exempt  boolean not null default false,  -- LCI/LCA
  is_active      boolean not null default true
);

create table fixed_income_investments (
  id              uuid primary key default gen_random_uuid(),
  portfolio_id    uuid not null references portfolios(id) on delete cascade,
  product_id      uuid not null references fixed_income_products(id),
  principal       numeric(18,2) not null,
  accrued_value   numeric(18,2) not null,   -- atualizado pelo close-day
  applied_on      date not null,
  last_accrual_on date not null,
  redeemed_at     timestamptz,
  redeem_gross    numeric(18,2),
  redeem_tax      numeric(18,2),
  redeem_net      numeric(18,2)
);

-- ── séries de patrimônio e ranking ───────────────────────────────────────
create table portfolio_snapshots (
  portfolio_id       uuid not null references portfolios(id) on delete cascade,
  date               date not null,
  cash               numeric(18,2) not null,
  equity_value       numeric(18,2) not null,
  fixed_income_value numeric(18,2) not null,
  total_value        numeric(18,2) not null,
  primary key (portfolio_id, date)
);

-- configuração versionada de taxas/tributos: hoje 1 linha "simplificado",
-- amanhã outra linha "realista" sem migração de schema
create table platform_settings (
  key            text not null,
  value          jsonb not null,
  effective_from timestamptz not null default now(),
  primary key (key, effective_from)
);

create table watchlist (
  user_id uuid references profiles(id) on delete cascade,
  ticker  text references assets(ticker),
  primary key (user_id, ticker)
);
```

### RLS (resumo)

| Tabela                                                                                                   | SELECT                             | INSERT/UPDATE/DELETE      |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------- |
| `assets`, `quotes`, `daily_candles`, `fixed_income_products`, `seasons`, `market_holidays`               | público/authenticated              | ninguém (só service_role) |
| `profiles`                                                                                               | próprio + campos públicos via view | próprio (nome/avatar)     |
| `portfolios`, `positions`, `orders`, `ledger_entries`, `fixed_income_investments`, `portfolio_snapshots` | `user_id = auth.uid()` via join    | **ninguém** — só RPC      |
| `watchlist`                                                                                              | próprio                            | próprio                   |
| `leaderboard_view`                                                                                       | authenticated                      | —                         |

`leaderboard_view` expõe apenas `display_name`, `avatar_url`, `total_value`,
`return_pct`, `rank` — nunca posições nem ordens de terceiros.

---

## 4. Motor de custos (`packages/core`)

Módulo **TypeScript puro, sem dependências**, compartilhado entre Edge Function e
frontend. Isso permite mostrar o custo exato na boleta antes de confirmar, com o
mesmo código que cobra depois.

```ts
export type FeeConfig = {
  tradingCostBps: number; // custo por operação, 3.25 = 0,0325% (emolumentos B3)
  tradingCostMin: number; // piso em R$, ex: 0
  slippageBps: number; // ex: 10 = 0,10% contra o usuário
  equityTaxRate: number; // IR sobre lucro na venda, ex: 0.15
  fiTaxRate: number; // IR sobre rendimento no resgate, ex: 0.175
};

export function quoteOrder(input: {
  side: 'BUY' | 'SELL';
  quantity: number;
  referencePrice: number;
  position?: { quantity: number; avgPrice: number };
  config: FeeConfig;
}): OrderQuote; // { executedPrice, gross, fee, tax, net, realizedPnl }

export function accrueFixedIncome(input: {
  principal: number;
  annualRate: number;
  businessDays: number;
}): number; // principal * (1 + annualRate) ** (businessDays / 252)
```

**Valores em vigor** (linha `fees` de `platform_settings`, definida em
`migrations/20260904120100_bootstrap_data.sql`):

| Parâmetro        | Valor          | Origem                                                                                                       |
| ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `tradingCostBps` | 3.25 → 0,0325% | Custo real da B3: emolumentos + taxa de liquidação. Corretagem fica zerada porque é o padrão de mercado hoje |
| `tradingCostMin` | R$ 0           | Sem piso                                                                                                     |
| `slippageBps`    | 10 → 0,10%     | Sempre contra o usuário; compensa os ~15 min de atraso da cotação                                            |
| `equityTaxRate`  | 15%            | Alíquota real de swing trade                                                                                 |
| `fiTaxRate`      | 17,5%          | Meio da tabela regressiva                                                                                    |

**Regras do MVP simplificado:**

- Slippage: compra executa a `price * (1 + slippageBps/10000)`, venda a
  `price * (1 - slippageBps/10000)`.
- Compra: `net = -(gross + fee)`. Novo `avg_price` = média ponderada **incluindo a
  taxa** (assim o P&L já nasce líquido de custo de entrada).
- Venda: `realizedPnl = (executedPrice - avgPrice) * qty`;
  `tax = max(0, realizedPnl) * equityTaxRate`; `net = gross - fee - tax`.
  Prejuízo não gera crédito no MVP (isso é a versão realista).
- Renda fixa: acruamento por dia útil, base 252, calendário `market_holidays`.
  Resgate: `tax = (accrued - principal) * fiTaxRate`, zero se `is_tax_exempt`.
- Toda validação de arredondamento em 2 casas, `ROUND_HALF_UP`, sempre a favor da
  plataforma no caso de taxa.

**Testes com Vitest são obrigatórios aqui** — é o único lugar do sistema onde um
erro de centavo se propaga por toda a base.

---

## 5. Fluxo de uma ordem

```
Frontend                Edge Function place-order            Postgres
   │                              │                              │
   │ POST {ticker, side, qty}     │                              │
   ├─────────────────────────────▶│                              │
   │        (JWT do usuário)      │ 1. valida JWT → user_id      │
   │                              │ 2. lê quotes + assets        │
   │                              ├─────────────────────────────▶│
   │                              │ 3. mercado aberto?           │
   │                              │    cotação < 30 min?         │
   │                              │    ativo tradable?           │
   │                              │    lote válido?              │
   │                              │ 4. quoteOrder() em core      │
   │                              │ 5. rpc execute_order_tx()    │
   │                              ├─────────────────────────────▶│
   │                              │                    BEGIN     │
   │                              │       SELECT ... FOR UPDATE  │
   │                              │       checa saldo/quantidade │
   │                              │       upsert positions       │
   │                              │       update cash_balance    │
   │                              │       insert orders + ledger │
   │                              │                    COMMIT    │
   │◀─────────────────────────────┤                              │
   │  OrderQuote + order_id       │                              │
```

Motivos de rejeição padronizados (código + mensagem em pt-BR):
`MARKET_CLOSED`, `STALE_QUOTE`, `INSUFFICIENT_CASH`, `INSUFFICIENT_POSITION`,
`ASSET_NOT_TRADABLE`, `INVALID_LOT`, `SEASON_ENDED`, `RATE_LIMITED`.

Janela de negociação: dias úteis, 10:00–17:55 BRT, checada server-side.
Rate limit: máx. ~30 ordens/minuto por portfólio (contagem em `orders`).

---

## 6. Jobs agendados

`pg_cron` dispara `pg_net` → Edge Function, com a service_role key guardada no
Supabase Vault. Bônus: o cron mantém o projeto free tier ativo (Supabase pausa
projeto após ~7 dias de inatividade).

| Job               | Cron (UTC)           | O que faz                                                                             |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `sync-quotes`     | `*/15 13-21 * * 1-5` | Busca ~150 tickers na brapi em lotes, upsert em `quotes`                              |
| `close-day`       | `30 21 * * 1-5`      | Grava `daily_candles`, acrua renda fixa, gera `portfolio_snapshots`, atualiza ranking |
| `refresh-catalog` | `0 6 * * 1`          | Revalida `assets` (splits de nome, ativos deslistados)                                |

`sync-quotes` chama a brapi em lotes de ~20 tickers por request. Com 32
execuções/dia útil × ~8 requests, dá ~5,6k requests/mês — **confirme o limite
vigente do plano free da brapi antes de fechar o intervalo de 15 min**; se
apertar, sobe pra 30 min ou reduz o universo.

---

## 7. Estrutura do repositório

```
M8.Invest/
├─ apps/web/                     # Vite + React + TS (deploy Netlify)
│  ├─ src/
│  │  ├─ routes/                 # /, /login, /app/*, /ranking, /admin
│  │  ├─ features/
│  │  │  ├─ auth/  market/  portfolio/  orders/  fixed-income/  leaderboard/
│  │  ├─ components/ui/          # shadcn
│  │  ├─ lib/supabase.ts         # client + tipos gerados
│  │  └─ lib/queries/            # TanStack Query hooks
│  └─ index.html
├─ packages/core/                # domínio puro: fees, IR, P&L, dias úteis
│  └─ src/{fees,tax,pnl,calendar,validation,db.types}.ts
├─ supabase/
│  ├─ migrations/                # SQL versionado
│  ├─ functions/{place-order,sync-quotes,close-day,fixed-income}/
│  └─ seed.sql                   # 150 assets, feriados ANBIMA, produtos RF, settings
├─ netlify.toml
├─ eslint.config.js               # flat config, type-aware, na raiz
├─ tsconfig.base.json
└─ PLANO.md
```

Monorepo com **npm workspaces**, não pnpm: uma ferramenta menos para instalar e
nenhuma divergência de versão entre a máquina de desenvolvimento e a imagem de
build da Netlify.

Compilador em **TypeScript 6**, não 7. O `typescript-eslint` 8 declara
`typescript >=4.8.4 <6.1.0` como peer — usar o 7 (o compilador nativo em Go)
desligaria todo o lint type-aware, e é justamente ele que pega
`no-floating-promises` num app que mexe com saldo. Revisitar quando o
`typescript-eslint` suportar o 7.

`netlify.toml` (o build roda na raiz, porque as devDependencies estão hasteadas
no workspace):

```toml
[build]
  command = "npm run build"
  publish = "apps/web/dist"

[[redirects]]                    # SPA fallback
  from = "/*"
  to = "/index.html"
  status = 200
```

Env na Netlify: só `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.

Imports em `packages/core` carregam a extensão `.ts` explícita
(`allowImportingTsExtensions`). É a única forma que resolve igual no Vite, no
Vitest e no Deno das Edge Functions — o mesmo cálculo de taxa que alimenta o
preview da boleta é o que cobra do saldo, sem build intermediário nem código
duplicado.

Tipos do banco gerados por `supabase gen types typescript --linked` para
`packages/core/src/db.types.ts` — roda no CI e falha o build se estiver defasado.

---

## 8. Telas

| Rota                 | Conteúdo                                                                               |
| -------------------- | -------------------------------------------------------------------------------------- |
| `/`                  | Landing: o que é, como funciona, ranking em destaque, CTA                              |
| `/login`             | Google, e-mail/senha, magic link                                                       |
| `/app`               | Patrimônio total, variação do dia, gráfico de evolução, top posições, atalho de boleta |
| `/app/mercado`       | Busca e filtro por tipo/setor, tabela com preço e variação, watchlist                  |
| `/app/ativo/:ticker` | Candles (lightweight-charts), dados do ativo, boleta com preview de custos             |
| `/app/carteira`      | Posições, preço médio, P&L não realizado, alocação (donut), renda fixa                 |
| `/app/renda-fixa`    | Catálogo com filtro por prazo/taxa, simulador, minhas aplicações, resgate              |
| `/app/extrato`       | Ordens e lançamentos com filtro por período/tipo, export CSV                           |
| `/ranking`           | Leaderboard da temporada, minha posição, histórico de temporadas                       |
| `/admin`             | CRUD de assets e produtos RF, `platform_settings`, abrir/fechar temporada              |

---

## 9. Roadmap

| Fase                            | Entregável                                                                                                                                                                                     | Esforço  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ~~**0. Fundação**~~ ✅          | Monorepo npm workspaces, Vite+TS 6+Tailwind v4+shadcn, `packages/core` com aritmética monetária testada, `supabase init`, netlify.toml, CI                                                     | feito    |
| ~~**1. Auth e conta**~~ ✅      | Migrations com RLS, trigger de perfil + carteira de R$ 20k, e-mail/senha e magic link (Google pendente de credencial no Google Cloud), guarda de rota, dashboard com extrato                   | feito    |
| ~~**2. Dados de mercado**~~ ✅  | 151 ativos validados contra a fonte, 30 feriados, Edge Function `sync-quotes` com Yahoo primário e brapi reserva, pg_cron confirmado disparando, tela de mercado e página do ativo com candles | feito    |
| ~~**3. Motor de ordens**~~ ✅   | `core/fees.ts` com 26 testes, RPC `execute_order_tx` transacional, Edge Function `place-order`, boleta com preview, posições com P&L. Invariantes contábeis verificadas contra o banco         | feito    |
| ~~**4. Fechamento diário**~~ ✅ | Edge Function `close-day` em pg_cron, `portfolio_snapshots`, curva de patrimônio e variação do dia                                                                                             | feito    |
| ~~**5. Renda fixa**~~ ✅        | `core/fixed-income.ts` com 20 testes, catálogo de 8 produtos, aplicação e resgate transacionais, acruamento por dia útil no `close-day`, tela com simulador de projeção                        | feito    |
| **6. Ranking e temporadas**     | `leaderboard_view`, `/ranking`, encerramento de temporada, arquivamento e reset                                                                                                                | 1–2 dias |
| **7. Admin e polimento**        | Painel admin, dark mode, mobile, empty states, mensagens de erro, disclaimer/termos                                                                                                            | 2–3 dias |
| **8. Hardening**                | Rate limit, testes E2E do fluxo de ordem, logs e alerta de job falho, backup de schema, LGPD                                                                                                   | 1–2 dias |

**Total: ~15–22 dias de trabalho focado.** Fases 0–4 já são um produto usável.

---

## 10. Riscos e limites do free tier

| Risco                                                                | Mitigação                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Atraso de 15–30 min na cotação permite arbitragem contra o simulador | Slippage, rejeição de cotação stale, rate limit de ordens. Se virar problema, migrar pra execução no fechamento (a decisão fica isolada na Edge Function)                                        |
| Limite de requests da brapi                                          | Universo enxuto, lotes de 20 tickers, cache no Postgres como única fonte pro frontend, intervalo ajustável por config                                                                            |
| Supabase free: 500 MB de banco                                       | `daily_candles` é o que cresce (150 tickers × 252 dias ≈ 38k linhas/ano — trivial). `portfolio_snapshots` cresce com usuários: 1 linha/dia/usuário. Retenção de 2 anos e agregação mensal depois |
| Supabase free pausa projeto após ~7 dias inativo                     | Os crons diários já resolvem                                                                                                                                                                     |
| SMTP free do Supabase (~3 e-mails/hora)                              | Plugar Resend ou Brevo (free tier) antes de abrir cadastro público                                                                                                                               |
| Netlify free: 125k invocações de function                            | Irrelevante: o site é estático, as funções ficam no Supabase                                                                                                                                     |
| Só 2 projetos Supabase ativos no free                                | Um projeto de produção; desenvolvimento local com `supabase start` (Docker)                                                                                                                      |
| Chave anon exposta no bundle                                         | É por design — a proteção é RLS. Auditar RLS na Fase 8 com testes automatizados por papel                                                                                                        |
| Aparência de recomendação de investimento                            | Disclaimer em rodapé, boleta e termos. Sem "sugestão de compra", sem carteira recomendada                                                                                                        |

**Custo mensal esperado: R$ 0.** Primeiros gastos prováveis, em ordem: domínio
próprio (~R$ 40/ano), plano pago da brapi se o intervalo de 15 min apertar,
Supabase Pro (US$ 25) só quando passar de 500 MB ou precisar de backup diário.

---

## 11. Ganchos deixados de propósito pra v2

Estes pontos já nascem preparados pra evoluir sem refatoração grande:

- `platform_settings` versionado → trocar taxas simplificadas por emolumentos B3
  reais, isenção de R$ 20k/mês e compensação de prejuízo é uma nova linha + novo
  branch no `packages/core`.
- `orders` já tem `reference_price` separado de `executed_price` → suporta ordem
  limitada e stop quando entrar o matching engine.
- `ledger_entries` com `kind` enum → proventos (`DIVIDEND`, `JCP`) entram como
  novos valores, sem mudar a contabilidade.
- `fixed_income_products.annual_rate` → adicionar `index_type` (`CDI`, `IPCA`) e
  uma tabela `index_series` alimentada pela API SGS do Banco Central.
- `seasons` → `leagues` privadas com código de convite reusam a mesma mecânica de
  portfólio isolado por temporada.

---

## 12. Estado atual e próximo passo

**Fases 0 e 1 concluídas.** Projeto Supabase `hmqoxctpeyirlgghufdq` linkado,
migrations aplicadas, login funcionando. Validado contra o banco: signup sem
erro de trigger, `profiles` com `display_name` derivado do e-mail, carteira
com R$ 20.000, lançamento `DEPOSIT`, e `42501 permission denied` para quem não
tem sessão.

**Pendências que não bloqueiam a Fase 2:**

- Google OAuth desligado — precisa de credencial no Google Cloud. O botão
  aparece sozinho no login quando `/auth/v1/settings` reportar o provedor
  ativo, sem mudança de código.
- Confirmação de e-mail desligada para desenvolvimento. **Religar antes de
  abrir ao público**, e nesse momento plugar Resend ou Brevo: o SMTP do free
  tier entrega poucos e-mails por hora, e cadastros passam a falhar em
  silêncio.
- Netlify não conectada. O `netlify.toml` está pronto; falta cadastrar as duas
  variáveis `VITE_*`.

**Para a Fase 2 começar** é preciso um token da brapi.dev, configurado como
secret da Edge Function (`npx supabase secrets set BRAPI_TOKEN=...`) — nunca
como variável `VITE_*`, que iria para o bundle. Antes de escrever o job de
sincronização, vale conferir a cota do plano free: o dimensionamento aqui
assume ~5,6k requests/mês (15 min × ~150 tickers em lotes de 20), e se
apertar o intervalo sobe para 30 min ou o universo diminui.

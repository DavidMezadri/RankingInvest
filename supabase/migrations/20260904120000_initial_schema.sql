-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 1 — identidade, temporada, carteira e contabilidade
--
-- Convenções do projeto:
--   dinheiro  numeric(18,2)   nunca float — 0.1 não existe em binário
--   preços    numeric(18,6)
--   tempo     timestamptz     armazenado em UTC, exibido em America/Sao_Paulo
--
-- Princípio de escrita: o usuário NUNCA escreve em carteira, saldo ou
-- lançamento. Não existe policy de INSERT/UPDATE/DELETE nessas tabelas —
-- só funções SECURITY DEFINER (o trigger de cadastro aqui, a RPC de ordens
-- na Fase 3) alteram dinheiro. RLS sem policy de escrita nega por padrão.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────── enums ─────

-- Enum completo já na primeira migration: os valores das fases seguintes
-- custam nada agora e evitam um ALTER TYPE por fase.
create type public.ledger_kind as enum (
  'DEPOSIT', -- crédito inicial da temporada
  'BUY', -- compra à vista            (Fase 3)
  'SELL', -- venda à vista             (Fase 3)
  'FEE', -- corretagem                (Fase 3)
  'TAX', -- IR retido                 (Fase 3)
  'FI_APPLY', -- aplicação em renda fixa   (Fase 5)
  'FI_REDEEM', -- resgate de renda fixa     (Fase 5)
  'FI_INTEREST' -- rendimento acruado        (Fase 5)
);

-- ──────────────────────────────────────────────────────────── profiles ─────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Dados públicos do usuário. O e-mail e as credenciais ficam em auth.users e nunca são copiados para cá.';

-- ───────────────────────────────────────────────────────────── seasons ─────

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  initial_cash numeric(18, 2) not null default 20000.00 check (initial_cash > 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint seasons_period_valid check (ends_at is null or ends_at > starts_at)
);

-- Índice parcial único: garante no banco que só existe uma temporada ativa.
-- Sem isso, um clique duplo no admin criaria duas e o cadastro de novo
-- usuário passaria a depender de qual o `limit 1` pegasse.
create unique index seasons_single_active_idx on public.seasons (is_active) where is_active;

comment on table public.seasons is
  'Rodada do simulador. Define saldo inicial e período. Carteira é sempre por temporada, então encerrar uma e abrir outra reseta todos sem apagar histórico.';

-- ────────────────────────────────────────────────────────── portfolios ─────

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete restrict,
  cash_balance numeric(18, 2) not null check (cash_balance >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, season_id)
);

create index portfolios_season_idx on public.portfolios (season_id);

comment on column public.portfolios.cash_balance is
  'Saldo em reais. O check >= 0 é a última linha de defesa contra compra a descoberto: mesmo que a RPC tenha bug, o banco recusa.';

-- ─────────────────────────────────────────────────────── ledger_entries ─────

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  kind public.ledger_kind not null,
  amount numeric(18, 2) not null check (amount <> 0),
  description text not null,
  occurred_at timestamptz not null default now()
);

create index ledger_entries_portfolio_idx on public.ledger_entries (portfolio_id, occurred_at desc);

comment on table public.ledger_entries is
  'Livro-caixa append-only. `amount` é assinado: positivo entra, negativo sai. A soma dos lançamentos de uma carteira deve sempre bater com cash_balance — é essa invariante que permite auditar um saldo estranho.';

-- As referências a `orders` e a aplicações de renda fixa entram nas Fases 3 e 5,
-- quando essas tabelas existirem.

-- ────────────────────────────────────────────────── platform_settings ─────

create table public.platform_settings (
  key text not null,
  value jsonb not null,
  effective_from timestamptz not null default now(),
  primary key (key, effective_from)
);

comment on table public.platform_settings is
  'Configuração versionada por data. Trocar as taxas simplificadas pelo modelo realista (emolumentos B3, isenção de 20k, compensação de prejuízo) é inserir uma linha nova, não migrar schema — e o histórico continua explicando por que uma ordem antiga cobrou o que cobrou.';

-- Lê a configuração vigente de uma chave. STABLE para o planner poder
-- reaproveitar dentro da mesma query.
create or replace function public.platform_setting(p_key text) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select ps.value
  from public.platform_settings ps
  where ps.key = p_key
    and ps.effective_from <= now()
  order by ps.effective_from desc
  limit 1
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Triggers
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.touch_updated_at() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row
execute function public.touch_updated_at();

-- ─── cadastro: cria perfil e credita o saldo inicial da temporada ──────────

-- SECURITY DEFINER porque roda no INSERT em auth.users, quando ainda não há
-- sessão — auth.uid() é nulo aqui. `search_path = ''` é exigência de segurança:
-- sem isso, um schema malicioso no path poderia sequestrar as chamadas, então
-- todo objeto abaixo está qualificado.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_season public.seasons;
  v_portfolio_id uuid;
begin
  -- Google OAuth traz full_name/name/avatar_url; e-mail e magic link não
  -- trazem nada, daí a parte local do e-mail como terceira opção.
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Investidor'
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(v_display_name, 40),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  select s.* into v_season from public.seasons s where s.is_active limit 1;

  -- Sem temporada ativa o usuário entra sem carteira, de propósito: é melhor
  -- que ele veja "nenhuma temporada aberta" do que o cadastro falhar. A
  -- carteira é criada quando a temporada abrir (Fase 6).
  if v_season.id is not null then
    insert into public.portfolios (user_id, season_id, cash_balance)
    values (new.id, v_season.id, v_season.initial_cash)
    on conflict (user_id, season_id) do nothing
    returning id into v_portfolio_id;

    -- Nulo quando o ON CONFLICT ignorou, ou seja, a carteira já existia —
    -- é o que torna este trigger idempotente e impede saldo inicial dobrado.
    if v_portfolio_id is not null then
      insert into public.ledger_entries (portfolio_id, kind, amount, description)
      values (
        v_portfolio_id,
        'DEPOSIT',
        v_season.initial_cash,
        format('Saldo inicial da temporada %s', v_season.name)
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- Função SECURITY DEFINER roda com os privilégios do dono (postgres) e
-- ignora RLS. O Postgres concede EXECUTE a `public` por padrão, então
-- revogamos: só o trigger deve invocá-la.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Privilégios de coluna
--
-- RLS filtra LINHAS, não colunas. Sem os grants abaixo, a policy de UPDATE
-- em profiles deixaria o usuário reescrever created_at do próprio registro.
-- O Supabase concede ALL por default privileges, então revogamos primeiro.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on public.profiles from anon, authenticated;
revoke all on public.seasons from anon, authenticated;
revoke all on public.portfolios from anon, authenticated;
revoke all on public.ledger_entries from anon, authenticated;
revoke all on public.platform_settings from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

grant select on public.seasons to authenticated;
grant select on public.portfolios to authenticated;
grant select on public.ledger_entries to authenticated;
grant select on public.platform_settings to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
--
-- `(select auth.uid())` e não `auth.uid()`: envolver num subselect deixa o
-- planner avaliar a função uma vez por query em vez de uma vez por linha.
-- Em tabela de extrato com milhares de lançamentos a diferença é grande.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.portfolios enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.platform_settings enable row level security;

-- profiles: só o próprio. A leitura pública de nome e avatar para o ranking
-- vem na Fase 6, por uma view que expõe apenas essas duas colunas.
create policy "profiles_select_own" on public.profiles
for select to authenticated
using (id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- seasons: qualquer usuário logado precisa saber qual temporada está aberta.
create policy "seasons_select_all" on public.seasons
for select to authenticated
using (true);

-- platform_settings: o frontend lê as taxas para mostrar o custo na boleta
-- antes de confirmar. É o mesmo dado que a Edge Function usa para cobrar.
create policy "platform_settings_select_all" on public.platform_settings
for select to authenticated
using (true);

create policy "portfolios_select_own" on public.portfolios
for select to authenticated
using (user_id = (select auth.uid()));

create policy "ledger_entries_select_own" on public.ledger_entries
for select to authenticated
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = ledger_entries.portfolio_id
      and p.user_id = (select auth.uid())
  )
);

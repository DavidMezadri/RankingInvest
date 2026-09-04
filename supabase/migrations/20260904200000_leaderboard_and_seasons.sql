-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 6 — ranking e ciclo de temporadas
-- ═══════════════════════════════════════════════════════════════════════════

-- Papel de administrador. O primeiro admin é promovido à mão, no SQL Editor:
--   update public.profiles set is_admin = true where id = '<seu uuid>';
-- Não existe caminho de auto-promoção de propósito — quem pode abrir e fechar
-- temporada pode zerar a carteira de todos.
alter table public.profiles add column is_admin boolean not null default false;

create or replace function public.is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- leaderboard
--
-- `security_invoker = false` é intencional, não descuido: a view PRECISA ler
-- linhas de outros usuários, e a RLS de `profiles` e `portfolio_snapshots`
-- restringe cada um ao próprio. Um ranking que só mostra você não é ranking.
--
-- O que a view expõe é o mínimo: nome, avatar, valor e retorno. Não expõe
-- user_id — em vez disso calcula `is_me` comparando com `auth.uid()`, que
-- continua devolvendo o chamador mesmo com a view rodando como dona. Assim a
-- tela consegue destacar a sua linha sem que ninguém enumere usuários.
--
-- O ranking é do ÚLTIMO FECHAMENTO, não do valor ao vivo. Três razões:
-- recalcular o patrimônio de todos exigiria reimplementar o acruamento de
-- renda fixa em SQL, criando uma segunda fonte de verdade; a posição no
-- ranking pararia de mudar a cada tique de cotação; e é assim que competição
-- de investimento funciona na prática — apura no fechamento.
-- ═══════════════════════════════════════════════════════════════════════════

create view public.leaderboard
with (security_invoker = false)
as
with latest as (
  select distinct on (ps.portfolio_id)
    ps.portfolio_id,
    ps.date,
    ps.total_value
  from public.portfolio_snapshots ps
  order by ps.portfolio_id, ps.date desc
)
select
  row_number() over (order by l.total_value / s.initial_cash desc, pr.display_name) as rank,
  pr.display_name,
  pr.avatar_url,
  s.name as season_name,
  l.date as as_of,
  l.total_value,
  s.initial_cash,
  l.total_value / s.initial_cash - 1 as return_pct,
  p.user_id = auth.uid() as is_me
from latest l
join public.portfolios p on p.id = l.portfolio_id
join public.seasons s on s.id = p.season_id
join public.profiles pr on pr.id = p.user_id
where s.is_active;

comment on view public.leaderboard is
  'Ranking da temporada aberta, apurado no último fechamento. Roda como dona para poder ler linhas de outros usuários — o que ela expõe é deliberadamente o mínimo, e nunca o user_id.';

revoke all on public.leaderboard from anon, authenticated;

-- Só para quem está logado. O ranking não é público porque `display_name`
-- nasce da parte local do e-mail no primeiro cadastro: expor a visitante
-- anônimo vazaria pedaço de endereço de e-mail de quem nunca escolheu um
-- apelido. Tornar público é decisão para depois de o usuário poder editar o
-- nome com consciência disso.
grant select on public.leaderboard to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Ciclo de temporadas
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.close_season(p_season_id uuid) returns public.seasons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season public.seasons;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  update public.seasons
  set is_active = false,
      ends_at = coalesce(ends_at, now())
  where id = p_season_id
  returning * into v_season;

  if v_season.id is null then
    raise exception 'SEASON_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_season;
end;
$$;

/**
 * Abre uma temporada nova e cria carteira para todos os perfis existentes.
 *
 * Fecha a anterior na mesma transação: o índice parcial único
 * `seasons_single_active_idx` garante uma só ativa, então desativar antes de
 * inserir não é ordem opcional.
 *
 * As carteiras antigas NÃO são apagadas. O histórico de ordens, extrato e
 * snapshots continua existindo, amarrado à temporada encerrada — é o que
 * permite consultar "como fui na Temporada 1" depois.
 */
create or replace function public.open_season(
  p_name text,
  p_initial_cash numeric default 20000
) returns public.seasons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season public.seasons;
  v_portfolio_id uuid;
  v_profile record;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  if p_initial_cash <= 0 then
    raise exception 'INVALID_INITIAL_CASH' using errcode = 'P0001';
  end if;

  update public.seasons
  set is_active = false, ends_at = coalesce(ends_at, now())
  where is_active;

  insert into public.seasons (name, starts_at, initial_cash, is_active)
  values (p_name, now(), p_initial_cash, true)
  returning * into v_season;

  for v_profile in select pr.id from public.profiles pr loop
    insert into public.portfolios (user_id, season_id, cash_balance)
    values (v_profile.id, v_season.id, p_initial_cash)
    on conflict (user_id, season_id) do nothing
    returning id into v_portfolio_id;

    if v_portfolio_id is not null then
      insert into public.ledger_entries (portfolio_id, kind, amount, description)
      values (
        v_portfolio_id,
        'DEPOSIT',
        p_initial_cash,
        format('Saldo inicial da temporada %s', v_season.name)
      );
    end if;
  end loop;

  return v_season;
end;
$$;

-- Chamáveis por usuário logado, porque a própria função checa `is_admin()`.
-- Quem não é admin recebe NOT_ADMIN, não um erro de permissão do Postgres.
grant execute on function public.close_season(uuid) to authenticated;
grant execute on function public.open_season(text, numeric) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 8 — saúde dos jobs e direitos do titular dos dados
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Saúde dos jobs.
 *
 * Devolve DUAS idades por job, e a distinção entre elas é o diagnóstico:
 *
 *   `minutes_since_run` alto  → o cron não está disparando. Problema de
 *                               agendamento, pg_cron ou pg_net.
 *   `minutes_since_ok` alto,
 *   `minutes_since_run` baixo → o cron dispara e a função recusa. Problema de
 *                               provedor, de janela ou de lógica.
 *
 * Um alerta que só olhasse "última execução bem-sucedida" confundiria os dois
 * — e eles pedem ações opostas.
 */
create or replace function public.job_health() returns table (
  job text,
  last_run timestamptz,
  last_ok timestamptz,
  minutes_since_run numeric,
  minutes_since_ok numeric,
  last_status text,
  last_detail text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    j.job,
    max(r.started_at) as last_run,
    max(r.started_at) filter (where r.status in ('OK', 'PARTIAL')) as last_ok,
    round(extract(epoch from now() - max(r.started_at)) / 60) as minutes_since_run,
    round(
      extract(
        epoch from now() - max(r.started_at) filter (where r.status in ('OK', 'PARTIAL'))
      ) / 60
    ) as minutes_since_ok,
    (array_agg(r.status order by r.started_at desc))[1] as last_status,
    (array_agg(r.detail order by r.started_at desc))[1] as last_detail
  from (values ('sync-quotes'), ('close-day')) as j (job)
  left join public.sync_runs r on r.job = j.job
  group by j.job
$$;

comment on function public.job_health is
  'Duas idades por job: desde a última execução e desde o último sucesso. A diferença entre elas separa "o cron morreu" de "o cron roda e a função recusa" — problemas que pedem ações opostas.';

grant execute on function public.job_health() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Direitos do titular (LGPD)
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * Exporta tudo que o serviço guarda sobre o usuário.
 *
 * SECURITY DEFINER com filtro por `auth.uid()` em cada subconsulta, e não
 * SECURITY INVOKER confiando na RLS: aqui o filtro é o requisito, não uma
 * consequência da política. Se uma policy fosse afrouxada por engano numa
 * migration futura, esta função continuaria devolvendo só o dono.
 *
 * Inclui o e-mail de `auth.users` porque é um dado pessoal que o serviço
 * guarda — uma exportação que omite o principal identificador não cumpre o
 * direito de acesso.
 */
create or replace function public.export_my_data() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exportedAt', now(),
    'account', (
      select jsonb_build_object('email', u.email, 'createdAt', u.created_at)
      from auth.users u where u.id = auth.uid()
    ),
    'profile', (
      select to_jsonb(p) - 'is_admin'
      from public.profiles p where p.id = auth.uid()
    ),
    'portfolios', coalesce((
      select jsonb_agg(to_jsonb(pf))
      from public.portfolios pf where pf.user_id = auth.uid()
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.created_at)
      from public.orders o
      join public.portfolios pf on pf.id = o.portfolio_id
      where pf.user_id = auth.uid()
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(to_jsonb(ps))
      from public.positions ps
      join public.portfolios pf on pf.id = ps.portfolio_id
      where pf.user_id = auth.uid()
    ), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.occurred_at)
      from public.ledger_entries l
      join public.portfolios pf on pf.id = l.portfolio_id
      where pf.user_id = auth.uid()
    ), '[]'::jsonb),
    'fixedIncome', coalesce((
      select jsonb_agg(to_jsonb(fi) order by fi.applied_on)
      from public.fixed_income_investments fi
      join public.portfolios pf on pf.id = fi.portfolio_id
      where pf.user_id = auth.uid()
    ), '[]'::jsonb),
    'snapshots', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.date)
      from public.portfolio_snapshots s
      join public.portfolios pf on pf.id = s.portfolio_id
      where pf.user_id = auth.uid()
    ), '[]'::jsonb)
  )
  where auth.uid() is not null
$$;

grant execute on function public.export_my_data() to authenticated;

/**
 * Exclusão definitiva da conta.
 *
 * Apaga a linha em `auth.users`, e o `on delete cascade` de `profiles` leva
 * embora carteiras, ordens, posições, extrato, aplicações e snapshots.
 * Apagar só o perfil deixaria um usuário de autenticação órfão, capaz de
 * logar num serviço onde ele não existe mais.
 *
 * Não há confirmação aqui: a confirmação é responsabilidade da interface, que
 * é onde existe um humano para confirmar. Uma função que pede confirmação por
 * parâmetro só empurra a decisão para quem chama.
 */
create or replace function public.delete_my_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  delete from auth.users where id = v_user_id;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account is
  'Exclusão definitiva, em cascata a partir de auth.users. Sem backup recuperável pelo usuário — os termos dizem isso explicitamente.';

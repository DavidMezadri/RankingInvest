-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 2 — observabilidade do sync e agendamento
-- ═══════════════════════════════════════════════════════════════════════════

create table public.sync_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'OK', 'PARTIAL', 'FAILED', 'SKIPPED')),
  provider text,
  tickers_ok integer not null default 0,
  tickers_failed integer not null default 0,
  detail text
);

create index sync_runs_job_idx on public.sync_runs (job, started_at desc);

-- Índice parcial que serve a trava de sobreposição da Edge Function: ela
-- procura por rodada RUNNING recente antes de começar outra.
create index sync_runs_running_idx on public.sync_runs (job, started_at desc)
where status = 'RUNNING';

comment on table public.sync_runs is
  'Histórico de execuções do sync. Serve a três coisas: trava de sobreposição (duas rodadas simultâneas dobrariam as requisições), auto-limitação por intervalo (é o que torna seguro expor a função sem segredo), e diagnóstico de job morto.';

revoke all on public.sync_runs from anon, authenticated;
grant select on public.sync_runs to authenticated;

alter table public.sync_runs enable row level security;

-- Leitura liberada para quem está logado: a tela pode mostrar "cotações
-- atualizadas às HH:MM" e admitir quando o sync falhou, em vez de exibir
-- preço velho como se fosse atual.
create policy "sync_runs_select_all" on public.sync_runs
for select to authenticated
using (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Agendamento
--
-- `pg_net` faz a chamada HTTP a partir do Postgres, `pg_cron` dispara o
-- horário.
--
-- Não existe segredo compartilhado entre o cron e a função, de propósito. A
-- Edge Function roda com verify_jwt = false e se protege sendo IDEMPOTENTE:
-- se o último sync bem-sucedido tem menos de 25 min, devolve SKIPPED sem
-- fazer nenhuma chamada externa. Invocar a URL de fora custa uma leitura em
-- sync_runs e nada mais. A alternativa — service_role key no Vault mais um
-- CRON_SECRET nos dois lados — seria mais peças para configurar e mais
-- segredo circulando, e a proteção real continuaria sendo a idempotência.
--
-- O cron roda de 30 em 30 min entre 13h e 21h UTC (10h às 18h de Brasília),
-- de segunda a sexta. Fim de semana, feriado e horário de verão são decididos
-- DENTRO da função, contra `market_holidays`: o cron erra para o lado de
-- disparar demais, e a função decide não gastar requisição.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A URL não é segredo — é a mesma que o frontend usa. Fica em
-- platform_settings para o agendamento não carregar o project ref cravado no
-- SQL, o que quebraria a migration em qualquer outro projeto.
insert into public.platform_settings (key, value, effective_from)
values (
  'jobs',
  jsonb_build_object(
    'syncQuotesUrl',
    'https://hmqoxctpeyirlgghufdq.supabase.co/functions/v1/sync-quotes'
  ),
  '2026-09-04T00:00:00Z'
)
on conflict (key, effective_from) do nothing;

create or replace function public.trigger_sync_quotes() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_request_id bigint;
begin
  v_url := public.platform_setting('jobs') ->> 'syncQuotesUrl';

  if v_url is null then
    raise warning 'jobs.syncQuotesUrl não configurado — sync-quotes não disparado';
    return null;
  end if;

  select net.http_post(url := v_url, timeout_milliseconds := 120000) into v_request_id;
  return v_request_id;
end;
$$;

comment on function public.trigger_sync_quotes is
  'Disparo do sync via pg_net. Existe para o agendamento no cron não embutir URL: trocar de projeto é trocar uma linha em platform_settings.';

-- Ninguém além do cron precisa disso. Chamar não causa dano (a função é
-- idempotente), mas expor não serve a nenhum propósito.
revoke execute on function public.trigger_sync_quotes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-quotes') then
    perform cron.unschedule('sync-quotes');
  end if;

  perform cron.schedule(
    'sync-quotes',
    '*/30 13-21 * * 1-5',
    'select public.trigger_sync_quotes()'
  );
end;
$$;

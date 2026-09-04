-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 4 — série histórica de patrimônio
--
-- Uma linha por carteira por dia útil, gravada no fechamento. É a base de
-- três coisas: o gráfico de evolução, a variação do dia (que precisa do
-- fechamento anterior para existir) e o ranking da Fase 6.
--
-- Por que não calcular na hora, a partir de ordens e cotações? Porque
-- reconstruir o patrimônio de uma data passada exigiria saber a posição
-- naquele dia E a cotação naquele dia, para todos os ativos — um join
-- histórico que fica mais caro a cada mês. O snapshot é a resposta já
-- calculada, e custa 1 linha por usuário por dia.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.portfolio_snapshots (
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  date date not null,
  cash numeric(18, 2) not null,
  equity_value numeric(18, 2) not null default 0,
  fixed_income_value numeric(18, 2) not null default 0,
  total_value numeric(18, 2) not null,
  created_at timestamptz not null default now(),
  primary key (portfolio_id, date)
);

-- Serve o ranking da Fase 6: "todas as carteiras numa data".
create index portfolio_snapshots_date_idx on public.portfolio_snapshots (date desc);

comment on column public.portfolio_snapshots.equity_value is
  'Posições avaliadas pela cotação em cache no momento do fechamento. Ativo sem cotação é avaliado a CUSTO, não a zero: patrimônio despencando no gráfico porque um sync falhou seria um dado falso pior que a ausência dele.';

revoke all on public.portfolio_snapshots from anon, authenticated;
grant select on public.portfolio_snapshots to authenticated;

alter table public.portfolio_snapshots enable row level security;

create policy "portfolio_snapshots_select_own" on public.portfolio_snapshots
for select to authenticated
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = portfolio_snapshots.portfolio_id
      and p.user_id = (select auth.uid())
  )
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Agendamento do fechamento
--
-- 21:30 UTC = 18:30 de Brasília, meia hora depois do fim da sessão, para o
-- último sync já ter gravado o preço de fechamento. Segunda a sexta; feriado
-- é decidido dentro da função, contra market_holidays.
--
-- O Brasil não adota horário de verão, então BRT = UTC−3 o ano todo e a
-- conversão fixa vale. Se voltar a adotar, este cron desloca uma hora e a
-- função continua correta — ela lê o relógio no fuso do mercado.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (key, value, effective_from)
values (
  'jobs',
  jsonb_build_object(
    'syncQuotesUrl', 'https://hmqoxctpeyirlgghufdq.supabase.co/functions/v1/sync-quotes',
    'closeDayUrl', 'https://hmqoxctpeyirlgghufdq.supabase.co/functions/v1/close-day'
  ),
  '2026-09-04T18:00:00Z'
)
on conflict (key, effective_from) do nothing;

create or replace function public.trigger_close_day() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_request_id bigint;
begin
  v_url := public.platform_setting('jobs') ->> 'closeDayUrl';

  if v_url is null then
    raise warning 'jobs.closeDayUrl não configurado — close-day não disparado';
    return null;
  end if;

  select net.http_post(url := v_url, timeout_milliseconds := 120000) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.trigger_close_day() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'close-day') then
    perform cron.unschedule('close-day');
  end if;

  perform cron.schedule('close-day', '30 21 * * 1-5', 'select public.trigger_close_day()');
end;
$$;

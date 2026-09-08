-- ═══════════════════════════════════════════════════════════════════════════
-- Proventos, com o modelo de PROVISIONAMENTO
--
-- Fonte: os endpoints públicos da própria B3 (`GetListedSupplementCompany` e
-- `GetListedSupplementFunds`). Oficial, sem token e sem cota, e o
-- identificador é o prefixo do ticker, que já está em `assets`.
--
-- O modelo tem duas etapas porque a realidade tem duas datas:
--
--   data-com (`ex_date`)   quem tem a posição NESTE dia adquire o direito
--   pagamento              semanas depois, o dinheiro entra no caixa
--
-- Provisionar na data-com resolve um problema que seria insolúvel de outra
-- forma: `positions` guarda só a posição ATUAL, não a histórica. Se o crédito
-- fosse calculado na data de pagamento, quem vendeu no meio perderia um
-- provento a que tinha direito, e quem comprou depois receberia um que não
-- tinha. Congelar a quantidade na data-com é o que torna o valor correto.
--
-- De brinde, a tela pode mostrar "provento provisionado" antes do pagamento,
-- que é exatamente como corretora apresenta.
-- ═══════════════════════════════════════════════════════════════════════════

create type public.event_kind as enum ('DIVIDEND', 'JCP', 'SPLIT', 'SUBSCRIPTION');

create table public.corporate_events (
  id uuid primary key default gen_random_uuid(),
  ticker text not null references public.assets (ticker) on delete cascade,
  kind public.event_kind not null,

  -- Valor por ação/cota. A B3 informa 11 casas decimais porque o provento
  -- unitário é fração de centavo — daí numeric(18,10) e não (18,6).
  rate_per_share numeric(18, 10) check (rate_per_share > 0),
  /** Fator de desdobramento ou grupamento. Só em SPLIT. */
  factor numeric(18, 10) check (factor > 0),

  /** Último dia com direito ao provento. */
  ex_date date not null,
  payment_date date,
  approved_on date,
  /** Competência informada pela B3: "Agosto-2026", "Anual/2026". */
  related_to text,
  /** ISIN do papel específico: separa ON de PN na mesma empresa. */
  isin_code text,
  source text not null default 'b3',
  created_at timestamptz not null default now(),

  -- Chave natural do evento. A B3 devolve o histórico inteiro em cada
  -- chamada, então sem isto cada sync duplicaria tudo.
  unique (ticker, kind, ex_date, rate_per_share, isin_code)
);

create index corporate_events_ticker_idx on public.corporate_events (ticker, ex_date desc);
create index corporate_events_ex_date_idx on public.corporate_events (ex_date desc);

comment on table public.corporate_events is
  'Eventos societários vindos da B3. O histórico completo é importado para EXIBIÇÃO; só eventos com data-com a partir da importação geram crédito, para não alterar saldo de operação já fechada.';

create type public.entitlement_status as enum ('PROVISIONED', 'PAID');

create table public.dividend_entitlements (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  event_id uuid not null references public.corporate_events (id) on delete cascade,

  /** Quantidade CONGELADA na data-com. É o que torna o valor correto. */
  quantity integer not null check (quantity > 0),
  gross_amount numeric(18, 2) not null check (gross_amount > 0),
  /** IR retido na fonte: 15% em JCP, zero em dividendo. */
  tax_amount numeric(18, 2) not null default 0 check (tax_amount >= 0),
  net_amount numeric(18, 2) not null check (net_amount > 0),

  status public.entitlement_status not null default 'PROVISIONED',
  provisioned_at timestamptz not null default now(),
  paid_at timestamptz,

  -- Um provento por carteira por evento. É a trava contra crédito dobrado se
  -- o job rodar duas vezes no mesmo dia.
  unique (portfolio_id, event_id)
);

create index dividend_entitlements_portfolio_idx
on public.dividend_entitlements (portfolio_id, provisioned_at desc);

create index dividend_entitlements_pending_idx on public.dividend_entitlements (event_id)
where status = 'PROVISIONED';

-- ═══════════════════════════════════════════════════════════════════════════
-- Privilégios e RLS
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on public.corporate_events from anon, authenticated;
revoke all on public.dividend_entitlements from anon, authenticated;

grant select on public.corporate_events to authenticated;
grant select on public.dividend_entitlements to authenticated;

alter table public.corporate_events enable row level security;
alter table public.dividend_entitlements enable row level security;

-- Histórico de provento é dado de mercado: público para quem está logado, e é
-- o que permite comparar o retorno em dividendos de dois ativos.
create policy "corporate_events_select_all" on public.corporate_events
for select to authenticated
using (true);

create policy "dividend_entitlements_select_own" on public.dividend_entitlements
for select to authenticated
using (
  exists (
    select 1
    from public.portfolios p
    where p.id = dividend_entitlements.portfolio_id
      and p.user_id = (select auth.uid())
  )
);

alter table public.ledger_entries
  add column entitlement_id uuid references public.dividend_entitlements (id) on delete set null;

-- ═══════════════════════════════════════════════════════════════════════════
-- pay_dividend_tx
--
-- Credita um provento provisionado. Recebe os valores já calculados em
-- packages/core e faz a escrita atômica, como a RPC de ordens.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.pay_dividend_tx(p_entitlement_id uuid)
returns public.dividend_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entitlement public.dividend_entitlements;
  v_event public.corporate_events;
begin
  select de.* into v_entitlement
  from public.dividend_entitlements de
  where de.id = p_entitlement_id
  for update;

  if v_entitlement.id is null then
    raise exception 'ENTITLEMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Trava contra pagamento dobrado. Duas execuções simultâneas do job
  -- serializam na trava acima e a segunda cai aqui.
  if v_entitlement.status = 'PAID' then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  select ce.* into v_event
  from public.corporate_events ce
  where ce.id = v_entitlement.event_id;

  update public.portfolios
  set cash_balance = cash_balance + v_entitlement.net_amount
  where id = v_entitlement.portfolio_id;

  -- Bruto e IR em lançamentos separados: é o que permite responder "quanto
  -- recebi de provento" e "quanto perdi de IR em JCP" sem reabrir cada
  -- evento. A soma continua batendo com o caixa.
  insert into public.ledger_entries
    (portfolio_id, kind, amount, description, entitlement_id)
  values (
    v_entitlement.portfolio_id,
    case when v_event.kind = 'JCP' then 'JCP'::public.ledger_kind
         else 'DIVIDEND'::public.ledger_kind end,
    v_entitlement.gross_amount,
    format(
      '%s de %s · %s %s',
      case when v_event.kind = 'JCP' then 'JCP' else 'Dividendo' end,
      v_event.ticker,
      v_entitlement.quantity,
      case when v_event.ticker ~ '11$' then 'cotas' else 'ações' end
    ),
    v_entitlement.id
  );

  if v_entitlement.tax_amount > 0 then
    insert into public.ledger_entries
      (portfolio_id, kind, amount, description, entitlement_id)
    values (
      v_entitlement.portfolio_id,
      'TAX',
      -v_entitlement.tax_amount,
      format('IR retido na fonte sobre JCP · %s', v_event.ticker),
      v_entitlement.id
    );
  end if;

  update public.dividend_entitlements
  set status = 'PAID', paid_at = now()
  where id = v_entitlement.id
  returning * into v_entitlement;

  return v_entitlement;
end;
$$;

revoke execute on function public.pay_dividend_tx(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Agendamento
--
-- 22:00 UTC = 19:00 de Brasília, depois do close-day das 18:30, para o
-- snapshot do dia já estar gravado antes de o provento mexer no caixa.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (key, value, effective_from)
values (
  'jobs',
  jsonb_build_object(
    'syncQuotesUrl', 'https://hmqoxctpeyirlgghufdq.supabase.co/functions/v1/sync-quotes',
    'closeDayUrl', 'https://hmqoxctpeyirlgghufdq.supabase.co/functions/v1/close-day',
    'syncEventsUrl', 'https://hmqoxctpeyirlgghufdq.supabase.co/functions/v1/sync-events'
  ),
  '2026-09-08T13:00:00Z'
)
on conflict (key, effective_from) do nothing;

create or replace function public.trigger_sync_events() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_request_id bigint;
begin
  v_url := public.platform_setting('jobs') ->> 'syncEventsUrl';

  if v_url is null then
    raise warning 'jobs.syncEventsUrl não configurado — sync-events não disparado';
    return null;
  end if;

  select net.http_post(url := v_url, timeout_milliseconds := 240000) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.trigger_sync_events() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-events') then
    perform cron.unschedule('sync-events');
  end if;

  perform cron.schedule('sync-events', '0 22 * * 1-5', 'select public.trigger_sync_events()');
end;
$$;

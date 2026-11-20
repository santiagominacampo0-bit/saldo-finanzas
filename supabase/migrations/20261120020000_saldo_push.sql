begin;

create table if not exists public.saldo_push_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count smallint not null check (request_count between 1 and 8)
);
alter table public.saldo_push_rate_limits enable row level security;
revoke all on table public.saldo_push_rate_limits from public, anon, authenticated;
grant select, insert, update on table public.saldo_push_rate_limits to service_role;

create or replace function public.saldo_claim_push_quota(p_user_id uuid)
returns boolean
language sql
set search_path = ''
as $$
  with counter as (
    insert into public.saldo_push_rate_limits as limits (user_id, window_start, request_count)
    values (p_user_id, statement_timestamp(), 1)
    on conflict (user_id) do update
    set
      window_start = case
        when limits.window_start <= statement_timestamp() - interval '5 minutes' then statement_timestamp()
        else limits.window_start
      end,
      request_count = case
        when limits.window_start <= statement_timestamp() - interval '5 minutes' then 1
        else limits.request_count + 1
      end
    where limits.window_start <= statement_timestamp() - interval '5 minutes' or limits.request_count < 8
    returning 1
  )
  select exists (select from counter);
$$;

revoke all on function public.saldo_claim_push_quota(uuid) from public, anon, authenticated;
grant execute on function public.saldo_claim_push_quota(uuid) to service_role;

alter table public.push_reminder_dispatches
  add column if not exists attempt_count smallint not null default 1,
  add column if not exists completed_at timestamptz;
revoke all on table public.push_reminder_dispatches from public, anon, authenticated;
grant select, insert, update on table public.push_reminder_dispatches to service_role;
grant select on table public.saldo_data to service_role;
grant select, delete on table public.push_subscriptions to service_role;

create or replace function public.saldo_claim_due_push_reminders(p_limit integer default 24)
returns table (user_id uuid, reminder_month text, attempt_count smallint)
language sql
set search_path = ''
as $$
  with local_clock as (
    select statement_timestamp() at time zone 'America/Bogota' as now_bogota
  ),
  months_in_window as (
    select distinct local_clock.now_bogota, date_trunc('month', relevant.instant) as month_start
    from local_clock
    cross join lateral (values
      (local_clock.now_bogota),
      (local_clock.now_bogota - interval '30 minutes')
    ) as relevant(instant)
  ),
  valid_settings as (
    select
      account.user_id,
      case when account.payload #>> '{settings,reminderDay}' ~ '^([1-9]|1[0-9]|2[0-8])$'
        then (account.payload #>> '{settings,reminderDay}')::int end as reminder_day,
      case when account.payload #>> '{settings,reminderTime}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        then (account.payload #>> '{settings,reminderTime}')::time end as reminder_time
    from public.saldo_data as account
    where account.payload #> '{settings,remindersEnabled}' = 'true'::jsonb
      and exists (select from public.push_subscriptions as push where push.user_id = account.user_id)
  ),
  due as (
    select
      settings.user_id,
      to_char(months.month_start, 'YYYY-MM') as reminder_month,
      (months.month_start::date + (settings.reminder_day - 1)) + settings.reminder_time as due_at,
      months.now_bogota
    from valid_settings as settings
    cross join months_in_window as months
  ),
  pending as (
    select due.user_id, due.reminder_month
    from due
    left join public.push_reminder_dispatches as dispatch
      on dispatch.user_id = due.user_id
      and dispatch.reminder_month = due.reminder_month
      and dispatch.reminder_type = 'monthly'
    where due.due_at between due.now_bogota - interval '30 minutes' and due.now_bogota
      and dispatch.completed_at is null
      and coalesce(dispatch.attempt_count, 0) < 3
      and (dispatch.claimed_at is null or dispatch.claimed_at <= statement_timestamp() - interval '4 minutes')
    order by due.due_at, due.user_id
    limit least(greatest(coalesce(p_limit, 24), 1), 48)
  )
  insert into public.push_reminder_dispatches as dispatch (user_id, reminder_month)
  select pending.user_id, pending.reminder_month from pending
  on conflict (user_id, reminder_month, reminder_type) do update
    set claimed_at = statement_timestamp(), attempt_count = dispatch.attempt_count + 1
    where dispatch.completed_at is null
      and dispatch.attempt_count < 3
      and dispatch.claimed_at <= statement_timestamp() - interval '4 minutes'
  returning dispatch.user_id, dispatch.reminder_month, dispatch.attempt_count;
$$;

revoke all on function public.saldo_claim_due_push_reminders(integer) from public, anon, authenticated;
grant execute on function public.saldo_claim_due_push_reminders(integer) to service_role;

commit;

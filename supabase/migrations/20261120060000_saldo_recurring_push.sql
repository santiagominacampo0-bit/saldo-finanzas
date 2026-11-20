begin;

create table if not exists public.push_recurring_dispatches (
  user_id uuid not null references auth.users(id) on delete cascade,
  recurring_id text not null check (length(recurring_id) between 1 and 80),
  occurrence_date date not null,
  claimed_at timestamptz not null default statement_timestamp(),
  attempt_count smallint not null default 1 check (attempt_count between 1 and 3),
  completed_at timestamptz,
  primary key (user_id, recurring_id, occurrence_date)
);
alter table public.push_recurring_dispatches enable row level security;
revoke all on table public.push_recurring_dispatches from public, anon, authenticated;
grant select, insert, update on table public.push_recurring_dispatches to service_role;

create or replace function public.saldo_claim_due_recurring_reminders(p_limit integer default 24)
returns table (user_id uuid, recurring_id text, occurrence_date date, attempt_count smallint)
language plpgsql
set search_path = ''
as $$
declare
  bogota_now timestamp := statement_timestamp() at time zone 'America/Bogota';
  reminder_day date := bogota_now::date;
begin
  -- The job has an hour for retries. It never backfills earlier days.
  if bogota_now::time < time '08:00' or bogota_now::time >= time '09:00' then
    return;
  end if;

  return query
  with rules as (
    select
      account.user_id,
      item.key as recurring_id,
      item.value ->> 'nextDue' as next_due,
      case when item.value ->> 'leadDays' ~ '^[0-7]$'
        then (item.value ->> 'leadDays')::integer end as lead_days
    from public.saldo_data as account
    cross join lateral jsonb_each(
      case when jsonb_typeof(account.payload -> 'recurring') = 'object'
        then account.payload -> 'recurring' else '{}'::jsonb end
    ) as item
    where item.value -> 'active' = 'true'::jsonb
      and item.value ->> 'id' = item.key
      and length(item.key) between 1 and 80
      and exists (select from public.push_subscriptions as push where push.user_id = account.user_id)
  ),
  due as (
    select rules.user_id, rules.recurring_id, reminder_day + rules.lead_days as occurrence_date
    from rules
    where rules.next_due = to_char(reminder_day + rules.lead_days, 'YYYY-MM-DD')
  ),
  pending as (
    select due.user_id, due.recurring_id, due.occurrence_date,
      row_number() over (partition by due.user_id order by due.occurrence_date, due.recurring_id) as account_rank
    from due
    left join public.push_recurring_dispatches as dispatch
      on dispatch.user_id = due.user_id
      and dispatch.recurring_id = due.recurring_id
      and dispatch.occurrence_date = due.occurrence_date
    where dispatch.completed_at is null
      and coalesce(dispatch.attempt_count, 0) < 3
      and (dispatch.claimed_at is null or dispatch.claimed_at <= statement_timestamp() - interval '4 minutes')
    order by account_rank, due.user_id
    limit least(greatest(coalesce(p_limit, 24), 1), 48)
  )
  insert into public.push_recurring_dispatches as dispatch (user_id, recurring_id, occurrence_date)
  select pending.user_id, pending.recurring_id, pending.occurrence_date from pending
  on conflict on constraint push_recurring_dispatches_pkey do update
    set claimed_at = statement_timestamp(), attempt_count = dispatch.attempt_count + 1
    where dispatch.completed_at is null
      and dispatch.attempt_count < 3
      and dispatch.claimed_at <= statement_timestamp() - interval '4 minutes'
  returning dispatch.user_id, dispatch.recurring_id, dispatch.occurrence_date, dispatch.attempt_count;
end;
$$;

revoke all on function public.saldo_claim_due_recurring_reminders(integer) from public, anon, authenticated;
grant execute on function public.saldo_claim_due_recurring_reminders(integer) to service_role;

notify pgrst, 'reload schema';
commit;

begin;

-- One row of counts for the latest completed run. Starting a new check keeps
-- the previous counters visible and exposes a run that never finished.
create table if not exists saldo_private.notification_check (
  singleton boolean primary key default true check (singleton),
  run_id uuid not null,
  last_started_at timestamptz not null,
  last_finished_at timestamptz,
  last_failure_at timestamptz,
  last_accepted_at timestamptz,
  monthly_claims integer not null default 0 check (monthly_claims >= 0),
  recurring_claims integer not null default 0 check (recurring_claims >= 0),
  accepted integer not null default 0 check (accepted >= 0),
  transient_failures integer not null default 0 check (transient_failures >= 0),
  timed_out integer not null default 0 check (timed_out >= 0 and timed_out <= transient_failures),
  provider_rejections integer not null default 0 check (provider_rejections >= 0),
  discarded_subscriptions integer not null default 0 check (discarded_subscriptions >= 0),
  processing_errors integer not null default 0 check (processing_errors >= 0)
);
alter table saldo_private.notification_check enable row level security;
revoke all on table saldo_private.notification_check from public, anon, authenticated;

create or replace function public.saldo_start_notification_check()
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into saldo_private.notification_check as health (run_id, last_started_at)
  values (gen_random_uuid(), statement_timestamp())
  on conflict (singleton) do update
    set run_id = excluded.run_id, last_started_at = excluded.last_started_at
  returning health.run_id;
$$;
revoke all on function public.saldo_start_notification_check() from public, anon, authenticated;
grant execute on function public.saldo_start_notification_check() to service_role;

create or replace function public.saldo_finish_notification_check(p_run_id uuid, p_counts jsonb)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with sample as (
    select * from jsonb_to_record(p_counts) as stats(
      monthly_claims integer, recurring_claims integer, accepted integer,
      transient_failures integer, timed_out integer, provider_rejections integer,
      discarded_subscriptions integer, processing_errors integer
    )
  ),
  recorded as (
    update saldo_private.notification_check as health
    set
      last_finished_at = statement_timestamp(),
      last_failure_at = case
        when sample.transient_failures + sample.provider_rejections + sample.processing_errors > 0
        then statement_timestamp() else health.last_failure_at end,
      last_accepted_at = case when sample.accepted > 0 then statement_timestamp() else health.last_accepted_at end,
      monthly_claims = sample.monthly_claims,
      recurring_claims = sample.recurring_claims,
      accepted = sample.accepted,
      transient_failures = sample.transient_failures,
      timed_out = sample.timed_out,
      provider_rejections = sample.provider_rejections,
      discarded_subscriptions = sample.discarded_subscriptions,
      processing_errors = sample.processing_errors
    from sample
    where health.singleton and health.run_id = p_run_id
      and (health.last_finished_at is null or health.last_finished_at < health.last_started_at)
    returning 1
  )
  select exists (select from recorded);
$$;
revoke all on function public.saldo_finish_notification_check(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.saldo_finish_notification_check(uuid,jsonb) to service_role;

create or replace function public.saldo_admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  access_result jsonb := public.saldo_admin_access();
begin
  if (access_result ->> 'allowed') is distinct from 'true'
    or (access_result ->> 'verified') is distinct from 'true' then
    raise exception 'Acceso restringido.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'accounts', (select count(*) from auth.users where email_confirmed_at is not null),
    'sync_accounts', (select count(*) from public.saldo_data),
    'push_devices', (select count(*) from public.push_subscriptions),
    'notification_check', (
      select jsonb_build_object(
        'last_started_at', health.last_started_at,
        'last_finished_at', health.last_finished_at,
        'last_failure_at', health.last_failure_at,
        'last_accepted_at', health.last_accepted_at,
        'monthly_claims', health.monthly_claims,
        'recurring_claims', health.recurring_claims,
        'accepted', health.accepted,
        'transient_failures', health.transient_failures,
        'timed_out', health.timed_out,
        'provider_rejections', health.provider_rejections,
        'discarded_subscriptions', health.discarded_subscriptions,
        'processing_errors', health.processing_errors
      ) from saldo_private.notification_check as health where health.singleton
    )
  );
end;
$$;
revoke all on function public.saldo_admin_summary() from public, anon, authenticated;
grant execute on function public.saldo_admin_summary() to authenticated;

notify pgrst, 'reload schema';
commit;

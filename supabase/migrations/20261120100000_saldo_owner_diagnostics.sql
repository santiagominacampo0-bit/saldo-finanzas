begin;

-- Use the database clock for ledger writes, including saves from older clients.
create or replace function saldo_private.saldo_stamp_data_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function saldo_private.saldo_stamp_data_write() from public, anon, authenticated;

drop trigger if exists saldo_stamp_data_write on public.saldo_data;
create trigger saldo_stamp_data_write before insert or update on public.saldo_data
for each row execute function saldo_private.saldo_stamp_data_write();

create or replace function public.saldo_admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  access_result jsonb := public.saldo_admin_access();
  observed_at timestamptz := statement_timestamp();
  recent_since timestamptz := observed_at - interval '7 days';
  accounts_count bigint;
  recent_confirmations bigint;
  saved_accounts_count bigint;
  recent_saves bigint;
  last_save timestamptz;
begin
  if (access_result ->> 'allowed') is distinct from 'true'
    or (access_result ->> 'verified') is distinct from 'true' then
    raise exception 'Acceso restringido.' using errcode = '42501';
  end if;

  select count(*),
    count(*) filter (where email_confirmed_at between recent_since and observed_at)
  into accounts_count, recent_confirmations
  from auth.users
  where email_confirmed_at is not null;

  select count(*),
    count(*) filter (where updated_at between recent_since and observed_at),
    max(updated_at) filter (where updated_at <= observed_at)
  into saved_accounts_count, recent_saves, last_save
  from public.saldo_data;

  return jsonb_build_object(
    'accounts', accounts_count,
    'sync_accounts', saved_accounts_count,
    'push_devices', (select count(*) from public.push_subscriptions),
    'checked_at', observed_at,
    'activity', jsonb_build_object(
      'confirmed_last_7_days', recent_confirmations,
      'saved_last_7_days', recent_saves,
      'last_saved_at', last_save
    ),
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

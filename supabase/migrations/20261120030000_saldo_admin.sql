begin;

create schema if not exists saldo_private;
revoke all on schema saldo_private from public, anon, authenticated;

create table if not exists saldo_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table saldo_private.admins enable row level security;
revoke all on table saldo_private.admins from public, anon, authenticated;

-- Membership is assigned by the project owner to an existing, confirmed account.
create or replace function public.saldo_admin_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'allowed', exists (
      select 1 from saldo_private.admins a
      join auth.users u on u.id = a.user_id
      where a.user_id = auth.uid() and u.email_confirmed_at is not null
    ),
    'verified', coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;
revoke all on function public.saldo_admin_access() from public, anon, authenticated;
grant execute on function public.saldo_admin_access() to authenticated;

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
    'push_devices', (select count(*) from public.push_subscriptions)
  );
end
$$;
revoke all on function public.saldo_admin_summary() from public, anon, authenticated;
grant execute on function public.saldo_admin_summary() to authenticated;

commit;

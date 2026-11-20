begin;

do $$
begin
  if to_regclass('public.saldo_data') is null and to_regclass('public.user_data') is not null then
    alter table public.user_data rename to saldo_data;
  end if;
end
$$;

create table if not exists public.saldo_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.saldo_data enable row level security;
revoke all on table public.saldo_data from anon;
grant select, insert, update, delete on table public.saldo_data to authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'saldo_data'
  loop
    execute format('drop policy if exists %I on public.saldo_data', existing_policy.policyname);
  end loop;
end
$$;

create policy saldo_data_select_own
  on public.saldo_data for select to authenticated
  using ((select auth.uid()) = user_id);
create policy saldo_data_insert_own
  on public.saldo_data for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy saldo_data_update_own
  on public.saldo_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy saldo_data_delete_own
  on public.saldo_data for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.push_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'push_subscriptions'
  loop
    execute format('drop policy if exists %I on public.push_subscriptions', existing_policy.policyname);
  end loop;
end
$$;

create policy push_subscriptions_select_own
  on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy push_subscriptions_update_own
  on public.push_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.push_reminder_dispatches (
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_month text not null check (reminder_month ~ '^[0-9]{4}-[0-9]{2}$'),
  reminder_type text not null default 'monthly' check (reminder_type = 'monthly'),
  claimed_at timestamptz not null default now(),
  primary key (user_id, reminder_month, reminder_type)
);

alter table public.push_reminder_dispatches enable row level security;
revoke all on table public.push_reminder_dispatches from anon, authenticated;

commit;

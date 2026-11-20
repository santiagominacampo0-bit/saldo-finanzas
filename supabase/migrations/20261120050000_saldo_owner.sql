begin;

-- Only the project owner can reserve access for a verified email address.
-- Store a salted digest and keep both the salt and digest out of the API.
create table if not exists saldo_private.owner_access (
  email_digest text primary key check (email_digest ~ '^[0-9a-f]{64}$'),
  salt text not null check (salt ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);
alter table saldo_private.owner_access enable row level security;
revoke all on table saldo_private.owner_access from public, anon, authenticated;

create or replace function public.saldo_admin_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'allowed', exists (
      select 1 from auth.users u
      where u.id = auth.uid() and u.email_confirmed_at is not null and u.email is not null
        and (
          exists (select from saldo_private.admins a where a.user_id = u.id)
          or exists (
            select from saldo_private.owner_access owner_key
            where owner_key.email_digest = encode(
              sha256(convert_to(owner_key.salt || ':' || lower(btrim(u.email)), 'UTF8')), 'hex'
            )
          )
        )
    ),
    'verified', coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;
revoke all on function public.saldo_admin_access() from public, anon, authenticated;
grant execute on function public.saldo_admin_access() to authenticated;

notify pgrst, 'reload schema';
commit;

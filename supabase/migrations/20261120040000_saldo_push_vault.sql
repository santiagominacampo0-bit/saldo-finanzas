begin;

create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

-- This value is generated in Postgres and never appears as a SQL literal or result row.
do $$
begin
  perform pg_advisory_xact_lock(17127395, 2);
  if not exists (select from vault.secrets where name = 'saldo_cron_token_v2') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'saldo_cron_token_v2',
      'Identifica las solicitudes programadas de Saldo.'
    );
  end if;
end;
$$;

create or replace function public.saldo_get_cron_token()
returns text
language sql
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets as s where s.name = 'saldo_cron_token_v2';
$$;
revoke all on function public.saldo_get_cron_token() from public, anon, authenticated;
grant execute on function public.saldo_get_cron_token() to service_role;

-- Saldo's Edge Function generates the key pair in memory. This RPC writes both keys
-- in one encrypted Vault transaction and keeps the first pair when writes race.
create or replace function public.saldo_get_or_initialize_vapid(
  p_public_key text default null,
  p_private_key text default null
)
returns table (public_key text, private_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.decrypted_secret into public_key
  from vault.decrypted_secrets as s where s.name = 'saldo_vapid_public_key_v2';

  select s.decrypted_secret into private_key
  from vault.decrypted_secrets as s where s.name = 'saldo_vapid_private_key_v2';

  if public_key is not null and private_key is not null then
    return next;
    return;
  end if;

  if p_public_key is null and p_private_key is null then
    return;
  end if;

  if p_public_key is null or p_private_key is null
    or p_public_key !~ '^B[A-Za-z0-9_-]{86}$'
    or p_private_key !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Par VAPID inválido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(17127395, 1);
  select s.decrypted_secret into public_key
  from vault.decrypted_secrets as s where s.name = 'saldo_vapid_public_key_v2';

  select s.decrypted_secret into private_key
  from vault.decrypted_secrets as s where s.name = 'saldo_vapid_private_key_v2';

  if public_key is null and private_key is null then
    perform vault.create_secret(p_public_key, 'saldo_vapid_public_key_v2', 'Clave Web Push publicable de Saldo.');
    perform vault.create_secret(p_private_key, 'saldo_vapid_private_key_v2', 'Clave de firma Web Push de Saldo.');
    public_key := p_public_key;
    private_key := p_private_key;
  end if;

  if public_key is null or private_key is null then
    raise exception 'El par VAPID de Saldo está incompleto.';
  end if;

  return next;
end;
$$;
revoke all on function public.saldo_get_or_initialize_vapid(text,text) from public, anon, authenticated;
grant execute on function public.saldo_get_or_initialize_vapid(text,text) to service_role;

notify pgrst, 'reload schema';
commit;

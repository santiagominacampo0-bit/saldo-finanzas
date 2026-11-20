-- Ejecutar después de aplicar las migraciones y publicar saldo-notify.
-- El token se generó en Vault durante la migración 20261120040000.
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'saldo_cron_token_v2') then
    raise exception 'Primero aplica la migración 20261120040000_saldo_push_vault.sql.';
  end if;
end;
$$;

-- pg_cron actualiza una tarea existente con el mismo nombre.
select cron.schedule(
  'saldo-reminders-every-5-minutes',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://odveqruhywtrdajuxcts.supabase.co/functions/v1/saldo-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-saldo-cron-secret', secret.decrypted_secret
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 90000
    ) as request_id
    from vault.decrypted_secrets as secret
    where secret.name = 'saldo_cron_token_v2';
  $$
);

commit;

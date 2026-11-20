begin;
-- Installed clients before v7 omit one-date entries when normalizing a ledger.
create or replace function saldo_private.keep_single_date_entries() returns trigger
language plpgsql set search_path = '' as $$
declare
  protected_entries jsonb;
begin
  if new.payload ->> 'schemaVersion' = '7' or jsonb_typeof(old.payload -> 'recurring') is distinct from 'object' then return new; end if;
  -- Once upgraded, retain the whole agenda against a stale client's edits or reinsertions.
  if old.payload ->> 'schemaVersion' = '7' then
    new.payload := jsonb_set(new.payload, '{recurring}', old.payload -> 'recurring') || '{"schemaVersion":7}'::jsonb;
    return new;
  end if;
  select jsonb_object_agg(key, value) into protected_entries
    from jsonb_each(old.payload -> 'recurring') where value ->> 'frequency' = 'once';
  if protected_entries is not null then
    new.payload := jsonb_set(new.payload, '{recurring}', coalesce(new.payload -> 'recurring','{}'::jsonb) || protected_entries);
  end if;
  return new;
end;
$$;
create or replace trigger saldo_keep_single_date_entries before update of payload on public.saldo_data
for each row execute function saldo_private.keep_single_date_entries();
commit;

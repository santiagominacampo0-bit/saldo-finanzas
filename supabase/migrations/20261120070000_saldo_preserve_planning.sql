begin;

-- Keep new collections when an already-open copy of the old PWA saves its snapshot.
-- A current client supplies all four keys, including explicit empty maps when clearing.
create or replace function saldo_private.saldo_keep_planning_for_legacy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field_name text;
  wallet_by_transaction jsonb;
  transactions jsonb;
begin
  if jsonb_typeof(new.payload) is distinct from 'object'
     or new.payload ?& array['wallets', 'transfers', 'recurring', 'goals'] then
    return new;
  end if;
  foreach field_name in array array['wallets', 'transfers', 'recurring', 'goals'] loop
    if old.payload ? field_name and not new.payload ? field_name then
      new.payload := new.payload || jsonb_build_object(field_name, old.payload -> field_name);
    end if;
  end loop;
  if jsonb_typeof(old.payload -> 'transactions') is distinct from 'array'
     or jsonb_typeof(new.payload -> 'transactions') is distinct from 'array' then
    return new;
  end if;
  select jsonb_object_agg(tx ->> 'id', tx -> 'walletId') into wallet_by_transaction
  from jsonb_array_elements(old.payload -> 'transactions') as item(tx)
  where jsonb_typeof(tx -> 'id') = 'string' and jsonb_typeof(tx -> 'walletId') = 'string';
  if wallet_by_transaction is null then return new; end if;

  select coalesce(jsonb_agg(
    case when jsonb_typeof(tx) = 'object' and not tx ? 'walletId'
      and wallet_by_transaction ? (tx ->> 'id')
      then tx || jsonb_build_object('walletId', wallet_by_transaction -> (tx ->> 'id'))
      else tx end
    order by position), '[]'::jsonb) into transactions
  from jsonb_array_elements(new.payload -> 'transactions') with ordinality as item(tx, position);
  new.payload := jsonb_set(new.payload, '{transactions}', transactions);
  return new;
end;
$$;

revoke all on function saldo_private.saldo_keep_planning_for_legacy() from public, anon, authenticated;
create or replace trigger saldo_keep_planning_for_legacy
before update of payload on public.saldo_data
for each row execute function saldo_private.saldo_keep_planning_for_legacy();

commit;

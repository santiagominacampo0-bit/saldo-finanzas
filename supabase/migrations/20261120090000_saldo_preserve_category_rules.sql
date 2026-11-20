begin;

-- Older installed versions may still save the owner's ledger during an update.
-- A current client supplies the categoryRules key even when the user clears it.
create or replace function saldo_private.saldo_keep_planning_for_legacy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field_name text;
  fields_by_transaction jsonb;
  transactions jsonb;
  wallet_aware boolean := new.payload ? 'wallets';
  rules_aware boolean := new.payload ? 'categoryRules';
begin
  if jsonb_typeof(new.payload) is distinct from 'object'
     or new.payload ?& array['wallets', 'transfers', 'recurring', 'goals', 'categoryRules'] then
    return new;
  end if;

  foreach field_name in array array['wallets', 'transfers', 'recurring', 'goals', 'categoryRules'] loop
    if old.payload ? field_name and not new.payload ? field_name then
      new.payload := new.payload || jsonb_build_object(field_name, old.payload -> field_name);
    end if;
  end loop;

  if jsonb_typeof(old.payload -> 'transactions') is distinct from 'array'
     or jsonb_typeof(new.payload -> 'transactions') is distinct from 'array' then
    return new;
  end if;

  select jsonb_object_agg(tx ->> 'id',
      jsonb_strip_nulls(jsonb_build_object('walletId', tx -> 'walletId', 'merchant', tx -> 'merchant')))
    into fields_by_transaction
  from jsonb_array_elements(old.payload -> 'transactions') as item(tx)
  where jsonb_typeof(tx -> 'id') = 'string'
    and (jsonb_typeof(tx -> 'walletId') = 'string' or jsonb_typeof(tx -> 'merchant') = 'string');

  if fields_by_transaction is null then return new; end if;

  select coalesce(jsonb_agg(
    case when jsonb_typeof(tx) = 'object' and fields_by_transaction ? (tx ->> 'id')
    then ((fields_by_transaction -> (tx ->> 'id'))
      - (case when wallet_aware then 'walletId' else '' end)
      - (case when rules_aware then 'merchant' else '' end)) || tx
    else tx end order by position), '[]'::jsonb) into transactions
  from jsonb_array_elements(new.payload -> 'transactions') with ordinality as item(tx, position);

  new.payload := jsonb_set(new.payload, '{transactions}', transactions);
  return new;
end;
$$;

commit;

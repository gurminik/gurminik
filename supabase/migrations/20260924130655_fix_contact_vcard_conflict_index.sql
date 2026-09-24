-- The original partial index cannot be inferred by PostgREST's
-- ON CONFLICT(owner_id, phone_normalized) used for duplicate-safe vCard imports.
-- Production already has the non-partial index; leave it untouched there.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index i
    where i.indexrelid = to_regclass('public.contacts_owner_phone_normalized_unique')
      and i.indisunique
      and i.indpred is null
  ) then
    execute 'drop index if exists public.contacts_owner_phone_normalized_unique';
    execute 'create unique index contacts_owner_phone_normalized_unique on public.contacts (owner_id, phone_normalized)';
  end if;
end;
$$;

-- Ordinary UNIQUE indexes still allow multiple NULL phone values.
comment on index public.contacts_owner_phone_normalized_unique is
  'Supports vCard upsert conflict matching on owner and normalized phone.';

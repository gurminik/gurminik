create or replace function public.import_gurminik_contacts_backup(payload jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); item jsonb; imported_count integer := 0;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  for item in select value from jsonb_array_elements(coalesce(payload->'contacts', '[]'::jsonb))
  loop
    insert into public.contacts(id, owner_id, name, phone, notes, contact_type, created_at)
    values (
      case when coalesce(item->>'id','') ~* '^[0-9a-f-]{36}$' then (item->>'id')::uuid else gen_random_uuid() end,
      uid,
      trim(coalesce(nullif(item->>'name',''), 'İsimsiz')),
      nullif(trim(item->>'phone'),''),
      nullif(trim(coalesce(item->>'note', item->>'notes')),''),
      trim(coalesce(nullif(item->>'category',''), nullif(item->>'contact_type',''), 'Diğer')),
      coalesce(nullif(item->>'createdAt','')::timestamptz, now())
    ) on conflict (id) do nothing;
    if found then imported_count := imported_count + 1; end if;
  end loop;
  return imported_count;
end;
$$;

revoke all on function public.import_gurminik_contacts_backup(jsonb) from public, anon;
grant execute on function public.import_gurminik_contacts_backup(jsonb) to authenticated;

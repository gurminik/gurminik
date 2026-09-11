create table if not exists public.contact_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique(owner_id, name)
);

alter table public.contact_categories enable row level security;
revoke all on public.contact_categories from anon;
grant select, insert, update, delete on public.contact_categories to authenticated;

create index if not exists contact_categories_owner_id_idx on public.contact_categories(owner_id);

create policy "contact_categories_select_own" on public.contact_categories for select to authenticated
using ((select auth.uid()) = owner_id);
create policy "contact_categories_insert_own" on public.contact_categories for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy "contact_categories_update_own" on public.contact_categories for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "contact_categories_delete_own" on public.contact_categories for delete to authenticated
using ((select auth.uid()) = owner_id);

alter table public.contacts drop constraint if exists contacts_contact_type_check;
update public.contacts set contact_type = 'Tedarikçi' where contact_type = 'tedarikci';

do $$
declare table_name text;
begin
  foreach table_name in array array['products','purchases','sales','expenses','expense_categories','contacts','contact_categories']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

create or replace function public.import_gurminik_contact_categories_backup(payload jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); item jsonb; inserted_count integer := 0;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;
  for item in select value from jsonb_array_elements(coalesce(payload->'contactCategories', '[]'::jsonb))
  loop
    insert into public.contact_categories(id, owner_id, name)
    values (
      case when coalesce(item->>'id','') ~* '^[0-9a-f-]{36}$' then (item->>'id')::uuid else gen_random_uuid() end,
      uid,
      trim(coalesce(nullif(item->>'name',''), 'Diğer'))
    ) on conflict do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.import_gurminik_contact_categories_backup(jsonb) from public, anon;
grant execute on function public.import_gurminik_contact_categories_backup(jsonb) to authenticated;

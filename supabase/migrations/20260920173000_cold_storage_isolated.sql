-- Separate cold-storage books. Existing business tables and rows are untouched.
alter table public.user_permissions drop constraint if exists user_permissions_module_check;
alter table public.user_permissions add constraint user_permissions_module_check
  check (module = any (array['dashboard','purchases','sales','ranking','expenses','contacts','accounts','favorites','reports','backup','cold_storage']));

create or replace function public.admin_set_gurminik_user_access(target_user_id uuid, active boolean, permission_set jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare item text; value jsonb;
begin
  perform private.require_gurminik_admin_verification();
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Kullanıcı bulunamadı'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role='admin') then raise exception 'Yönetici hesabının yetkileri değiştirilemez' using errcode='42501'; end if;
  update public.profiles set is_active=active, updated_at=now() where id=target_user_id;
  foreach item in array array['dashboard','purchases','sales','ranking','expenses','contacts','accounts','favorites','reports','backup','cold_storage'] loop
    value := coalesce(permission_set -> item, '{}'::jsonb);
    insert into public.user_permissions(user_id,module,can_view,can_create,can_update,can_delete,updated_at)
    values(target_user_id,item,
      coalesce((value->>'can_view')::boolean,false),coalesce((value->>'can_create')::boolean,false),
      coalesce((value->>'can_update')::boolean,false),coalesce((value->>'can_delete')::boolean,false),now())
    on conflict(user_id,module) do update set
      can_view=excluded.can_view,can_create=excluded.can_create,
      can_update=excluded.can_update,can_delete=excluded.can_delete,updated_at=now();
  end loop;
  return true;
end;
$$;

create table public.cold_storage_purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_name text not null check (length(btrim(product_name)) > 0),
  supplier_name text not null check (length(btrim(supplier_name)) > 0),
  vehicle_plate text not null default '',
  quantity_kg numeric(16,2) not null check (quantity_kg > 0),
  unit_buy_price numeric(16,4) not null check (unit_buy_price >= 0),
  transaction_at timestamptz not null default now(),
  notes text not null default '',
  status text not null default 'active' check (status in ('active','cancelled')),
  created_at timestamptz not null default now()
);
create table public.cold_storage_sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_name text not null check (length(btrim(product_name)) > 0),
  buyer_name text not null check (length(btrim(buyer_name)) > 0),
  quantity_kg numeric(16,2) not null check (quantity_kg > 0),
  unit_sale_price numeric(16,4) not null check (unit_sale_price >= 0),
  transaction_at timestamptz not null default now(),
  notes text not null default '',
  status text not null default 'active' check (status in ('active','cancelled')),
  created_at timestamptz not null default now()
);
create table public.cold_storage_expense_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);
create table public.cold_storage_expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  category text not null check (length(btrim(category)) > 0),
  amount numeric(16,2) not null check (amount > 0),
  transaction_at timestamptz not null default now(),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index cold_purchases_owner_product_date_idx on public.cold_storage_purchases (owner_id, product_name, transaction_at desc);
create index cold_sales_owner_product_date_idx on public.cold_storage_sales (owner_id, product_name, transaction_at desc);
create index cold_expenses_owner_date_idx on public.cold_storage_expenses (owner_id, transaction_at desc);
create unique index cold_categories_owner_name_idx on public.cold_storage_expense_categories (owner_id, lower(btrim(name)));

do $$ declare table_name text; begin
  foreach table_name in array array['cold_storage_purchases','cold_storage_sales','cold_storage_expenses','cold_storage_expense_categories'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create trigger gurminik_owner_guard before insert or update on public.%I for each row execute function private.guard_gurminik_owner()', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((owner_id = (select auth.uid()) or (select private.is_gurminik_admin())) and (select private.has_gurminik_permission(''cold_storage'',''view'')))', table_name||'_select',table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()) and (select private.has_gurminik_permission(''cold_storage'',''create'')))', table_name||'_insert',table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((owner_id = (select auth.uid()) or (select private.is_gurminik_admin())) and (select private.has_gurminik_permission(''cold_storage'',''update''))) with check ((owner_id = (select auth.uid()) or (select private.is_gurminik_admin())) and (select private.has_gurminik_permission(''cold_storage'',''update'')))', table_name||'_update',table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((owner_id = (select auth.uid()) or (select private.is_gurminik_admin())) and (select private.has_gurminik_permission(''cold_storage'',''delete'')))', table_name||'_delete',table_name);
    execute format('revoke all on public.%I from public, anon',table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated',table_name);
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end $$;

-- GURMİNİK cari hesap, favoriler ve dinamik sıralama yetkileri.
-- Mevcut işletme kayıtlarına dokunmaz; yalnızca yeni tabloları ve modül izinlerini ekler.

create table if not exists public.account_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_name text not null check (length(btrim(company_name)) > 0),
  payment_at timestamptz not null default now(),
  amount numeric(16,2) not null check (amount > 0),
  description text,
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person_name text not null check (length(btrim(person_name)) > 0),
  phone text,
  vehicle_plate text,
  last_product_id uuid references public.products(id) on delete set null,
  last_buy_price numeric(14,4) check (last_buy_price is null or last_buy_price >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_payments_payment_at_idx
  on public.account_payments (payment_at desc);
create index if not exists account_payments_company_idx
  on public.account_payments (lower(company_name));
create unique index if not exists favorites_person_name_unique_idx
  on public.favorites (lower(btrim(person_name)));
create index if not exists favorites_updated_at_idx
  on public.favorites (updated_at desc);

drop trigger if exists account_payments_guard_owner on public.account_payments;
create trigger account_payments_guard_owner
before insert or update on public.account_payments
for each row execute function private.guard_gurminik_owner();

drop trigger if exists favorites_guard_owner on public.favorites;
create trigger favorites_guard_owner
before insert or update on public.favorites
for each row execute function private.guard_gurminik_owner();

create or replace function private.sync_gurminik_favorite_from_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'cancelled' then
    update public.favorites
    set vehicle_plate = nullif(btrim(new.vehicle_plate), ''),
        last_product_id = new.product_id,
        last_buy_price = new.unit_buy_price,
        updated_at = now()
    where lower(btrim(person_name)) = lower(btrim(new.supplier_name));
  end if;
  return new;
end;
$$;

drop trigger if exists purchases_sync_favorite on public.purchases;
create trigger purchases_sync_favorite
after insert or update of supplier_name, vehicle_plate, product_id, unit_buy_price, status
on public.purchases
for each row execute function private.sync_gurminik_favorite_from_purchase();

alter table public.account_payments enable row level security;
alter table public.favorites enable row level security;

create or replace function private.can_access_gurminik_table(requested_table text, requested_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare allowed_modules text[];
declare item text;
begin
  if private.is_gurminik_admin() then return true; end if;
  allowed_modules := case requested_table
    when 'products' then case when requested_action = 'view' then array['dashboard','purchases','sales','ranking','favorites','reports','backup'] else array['dashboard','backup'] end
    when 'purchases' then case when requested_action = 'view' then array['dashboard','purchases','ranking','favorites','reports','backup'] else array['purchases','backup'] end
    when 'sales' then case when requested_action = 'view' then array['dashboard','sales','reports','backup'] else array['sales','backup'] end
    when 'expenses' then case when requested_action = 'view' then array['dashboard','expenses','reports','backup'] else array['expenses','backup'] end
    when 'expense_categories' then case when requested_action = 'view' then array['dashboard','expenses','reports','backup'] else array['expenses','backup'] end
    when 'contacts' then case when requested_action = 'view' then array['contacts','ranking','favorites','backup'] else array['contacts','backup'] end
    when 'contact_categories' then array['contacts','backup']
    when 'shipments' then array['sales','reports','backup']
    when 'account_payments' then case when requested_action = 'view' then array['accounts','reports','backup'] else array['accounts','backup'] end
    when 'favorites' then case when requested_action = 'view' then array['favorites','ranking','backup'] else array['favorites','backup'] end
    else array[]::text[]
  end;
  foreach item in array allowed_modules loop
    if private.has_gurminik_permission(item, requested_action) then return true; end if;
  end loop;
  return false;
end;
$$;

alter table public.user_permissions drop constraint if exists user_permissions_module_check;
alter table public.user_permissions add constraint user_permissions_module_check
  check (module = any (array['dashboard','purchases','sales','ranking','expenses','contacts','accounts','favorites','reports','backup']));

create or replace function public.admin_set_gurminik_user_access(target_user_id uuid, active boolean, permission_set jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare item text;
declare value jsonb;
begin
  perform private.require_gurminik_admin_verification();
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Kullanıcı bulunamadı'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role='admin') then raise exception 'Yönetici hesabının yetkileri değiştirilemez' using errcode='42501'; end if;
  update public.profiles set is_active=active, updated_at=now() where id=target_user_id;
  foreach item in array array['dashboard','purchases','sales','ranking','expenses','contacts','accounts','favorites','reports','backup'] loop
    value := coalesce(permission_set -> item, '{}'::jsonb);
    insert into public.user_permissions(user_id,module,can_view,can_create,can_update,can_delete,updated_at)
    values(target_user_id,item,
      coalesce((value->>'can_view')::boolean,false),
      coalesce((value->>'can_create')::boolean,false),
      coalesce((value->>'can_update')::boolean,false),
      coalesce((value->>'can_delete')::boolean,false),now())
    on conflict(user_id,module) do update set
      can_view=excluded.can_view, can_create=excluded.can_create,
      can_update=excluded.can_update, can_delete=excluded.can_delete, updated_at=now();
  end loop;
  return true;
end;
$$;

drop policy if exists account_payments_authorized_select on public.account_payments;
drop policy if exists account_payments_authorized_insert on public.account_payments;
drop policy if exists account_payments_authorized_update on public.account_payments;
drop policy if exists account_payments_authorized_delete on public.account_payments;
create policy account_payments_authorized_select on public.account_payments for select to authenticated
  using ((select private.can_access_gurminik_table('account_payments','view')));
create policy account_payments_authorized_insert on public.account_payments for insert to authenticated
  with check ((select private.can_access_gurminik_table('account_payments','create')));
create policy account_payments_authorized_update on public.account_payments for update to authenticated
  using ((select private.can_access_gurminik_table('account_payments','update')))
  with check ((select private.can_access_gurminik_table('account_payments','update')));
create policy account_payments_authorized_delete on public.account_payments for delete to authenticated
  using ((select private.can_access_gurminik_table('account_payments','delete')));

drop policy if exists favorites_authorized_select on public.favorites;
drop policy if exists favorites_authorized_insert on public.favorites;
drop policy if exists favorites_authorized_update on public.favorites;
drop policy if exists favorites_authorized_delete on public.favorites;
create policy favorites_authorized_select on public.favorites for select to authenticated
  using ((select private.can_access_gurminik_table('favorites','view')));
create policy favorites_authorized_insert on public.favorites for insert to authenticated
  with check ((select private.can_access_gurminik_table('favorites','create')));
create policy favorites_authorized_update on public.favorites for update to authenticated
  using ((select private.can_access_gurminik_table('favorites','update')))
  with check ((select private.can_access_gurminik_table('favorites','update')));
create policy favorites_authorized_delete on public.favorites for delete to authenticated
  using ((select private.can_access_gurminik_table('favorites','delete')));

revoke all on public.account_payments, public.favorites from anon, public;
grant select, insert, update, delete on public.account_payments, public.favorites to authenticated;
revoke all on function private.sync_gurminik_favorite_from_purchase() from public, anon, authenticated;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='account_payments') then
    alter publication supabase_realtime add table public.account_payments;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='favorites') then
    alter publication supabase_realtime add table public.favorites;
  end if;
end;
$$;

create or replace function public.import_gurminik_accounts_favorites_backup(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  resolved_product uuid;
  account_count integer := 0;
  favorite_count integer := 0;
begin
  if uid is null then raise exception 'Oturum gerekli' using errcode='42501'; end if;

  for item in select value from jsonb_array_elements(coalesce(payload->'accountPayments', '[]'::jsonb))
  loop
    insert into public.account_payments(id, owner_id, company_name, payment_at, amount, description, payment_method, created_at)
    values (
      case when coalesce(item->>'id','') ~* '^[0-9a-f-]{36}$' then (item->>'id')::uuid else gen_random_uuid() end,
      uid,
      btrim(coalesce(nullif(item->>'company',''), nullif(item->>'company_name',''), 'Bilinmeyen firma')),
      coalesce(nullif(item->>'dateTime','')::timestamptz, nullif(item->>'payment_at','')::timestamptz, now()),
      greatest(coalesce(nullif(item->>'amount','')::numeric, 0.01), 0.01),
      nullif(btrim(coalesce(item->>'description','')), ''),
      nullif(btrim(coalesce(item->>'method', item->>'payment_method','')), ''),
      coalesce(nullif(item->>'createdAt','')::timestamptz, now())
    ) on conflict do nothing;
    if found then account_count := account_count + 1; end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'favorites', '[]'::jsonb))
  loop
    resolved_product := null;
    if coalesce(item->>'lastProductId', item->>'last_product_id','') ~* '^[0-9a-f-]{36}$' then
      select id into resolved_product from public.products
      where id=coalesce(item->>'lastProductId', item->>'last_product_id')::uuid limit 1;
    end if;
    insert into public.favorites(id, owner_id, person_name, phone, vehicle_plate, last_product_id, last_buy_price, notes, created_at)
    values (
      case when coalesce(item->>'id','') ~* '^[0-9a-f-]{36}$' then (item->>'id')::uuid else gen_random_uuid() end,
      uid,
      btrim(coalesce(nullif(item->>'person',''), nullif(item->>'person_name',''), 'İsimsiz')),
      nullif(btrim(coalesce(item->>'phone','')), ''),
      nullif(upper(btrim(coalesce(item->>'plate', item->>'vehicle_plate',''))), ''),
      resolved_product,
      nullif(coalesce(item->>'lastBuyPrice', item->>'last_buy_price',''),'')::numeric,
      nullif(btrim(coalesce(item->>'notes','')), ''),
      coalesce(nullif(item->>'createdAt','')::timestamptz, now())
    ) on conflict do nothing;
    if found then favorite_count := favorite_count + 1; end if;
  end loop;

  return jsonb_build_object('accountPayments',account_count,'favorites',favorite_count);
end;
$$;

revoke all on function public.import_gurminik_accounts_favorites_backup(jsonb) from public, anon;
grant execute on function public.import_gurminik_accounts_favorites_backup(jsonb) to authenticated;

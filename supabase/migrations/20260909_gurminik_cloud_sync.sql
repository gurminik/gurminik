alter table public.products
  add column if not exists icon text not null default '●';

alter table public.purchases
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchases_status_check'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_status_check
      check (status in ('active', 'cancelled'));
  end if;
end $$;

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  category text not null check (length(trim(category)) > 0),
  amount numeric(14,2) not null check (amount > 0),
  transaction_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop index if exists public.expense_categories_owner_name_idx;
drop index if exists public.purchases_owner_transaction_idx;
create index if not exists expenses_owner_transaction_idx on public.expenses (owner_id, transaction_at desc);
create index if not exists products_owner_created_idx on public.products (owner_id, created_at);
create index if not exists contacts_owner_name_idx on public.contacts (owner_id, name);
create index if not exists purchases_supplier_contact_id_idx on public.purchases (supplier_contact_id);
create index if not exists sales_buyer_contact_id_idx on public.sales (buyer_contact_id);

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;

drop policy if exists expense_categories_select_own on public.expense_categories;
drop policy if exists expense_categories_insert_own on public.expense_categories;
drop policy if exists expense_categories_update_own on public.expense_categories;
drop policy if exists expense_categories_delete_own on public.expense_categories;
create policy expense_categories_select_own on public.expense_categories for select to authenticated using ((select auth.uid()) = owner_id);
create policy expense_categories_insert_own on public.expense_categories for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy expense_categories_update_own on public.expense_categories for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy expense_categories_delete_own on public.expense_categories for delete to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists expenses_select_own on public.expenses;
drop policy if exists expenses_insert_own on public.expenses;
drop policy if exists expenses_update_own on public.expenses;
drop policy if exists expenses_delete_own on public.expenses;
create policy expenses_select_own on public.expenses for select to authenticated using ((select auth.uid()) = owner_id);
create policy expenses_insert_own on public.expenses for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy expenses_update_own on public.expenses for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy expenses_delete_own on public.expenses for delete to authenticated using ((select auth.uid()) = owner_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.products, public.purchases, public.contacts, public.expense_categories, public.expenses to authenticated;
revoke all on public.expense_categories, public.expenses from anon;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.gurminik_pending_imports (
  email text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

alter table private.gurminik_pending_imports enable row level security;
drop policy if exists gurminik_pending_select_own on private.gurminik_pending_imports;
drop policy if exists gurminik_pending_update_own on private.gurminik_pending_imports;
create policy gurminik_pending_select_own on private.gurminik_pending_imports
  for select to authenticated using (email = lower(coalesce((select auth.jwt())->>'email','')));
create policy gurminik_pending_update_own on private.gurminik_pending_imports
  for update to authenticated using (email = lower(coalesce((select auth.jwt())->>'email','')))
  with check (email = lower(coalesce((select auth.jwt())->>'email','')));
grant usage on schema private to authenticated;
grant select, update on private.gurminik_pending_imports to authenticated;

create or replace function public.import_gurminik_backup(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  product_id uuid;
  old_product_id text;
  imported_products integer := 0;
  imported_purchases integer := 0;
  imported_expenses integer := 0;
  imported_contacts integer := 0;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  create temporary table if not exists gurminik_product_map (
    old_id text primary key,
    new_id uuid not null
  ) on commit drop;
  truncate gurminik_product_map;

  for item in select value from jsonb_array_elements(coalesce(payload->'products', '[]'::jsonb)) loop
    select id into product_id from public.products
      where owner_id = uid and lower(name) = lower(trim(item->>'name'))
      order by created_at limit 1;
    if product_id is null then
      insert into public.products (owner_id, name, icon)
      values (uid, trim(item->>'name'), coalesce(nullif(item->>'icon',''), '●'))
      returning id into product_id;
      imported_products := imported_products + 1;
    end if;
    insert into gurminik_product_map(old_id,new_id)
      values (coalesce(nullif(item->>'id',''), item->>'name'), product_id)
      on conflict (old_id) do update set new_id = excluded.new_id;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'categories', '[]'::jsonb)) loop
    insert into public.expense_categories (owner_id, name)
    values (uid, trim(coalesce(item->>'name', item #>> '{}')))
    on conflict (owner_id, name) do nothing;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'contacts', '[]'::jsonb)) loop
    insert into public.contacts (owner_id, name, phone, notes, contact_type, created_at)
    values (uid, trim(item->>'name'), nullif(trim(item->>'phone'),''), nullif(trim(coalesce(item->>'note', item->>'notes')),''), 'tedarikci', coalesce((item->>'createdAt')::timestamptz, now()));
    imported_contacts := imported_contacts + 1;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'expenses', '[]'::jsonb)) loop
    insert into public.expenses (owner_id, title, category, amount, transaction_at, created_at)
    values (
      uid, trim(item->>'title'), coalesce(nullif(trim(item->>'category'),''),'Diğer'),
      (item->>'amount')::numeric,
      case when coalesce(item->>'dateTime', item->>'date_time') ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        then coalesce(item->>'dateTime', item->>'date_time')::timestamptz
        else coalesce(item->>'dateTime', item->>'date_time')::timestamp at time zone 'Europe/Istanbul' end,
      coalesce((item->>'createdAt')::timestamptz, now())
    );
    imported_expenses := imported_expenses + 1;
  end loop;

  for item in
    select value from jsonb_array_elements(coalesce(payload->'records', payload->'purchases', '[]'::jsonb))
  loop
    old_product_id := coalesce(item->>'productId', item->>'product_id', item->>'product');
    select new_id into product_id from gurminik_product_map where old_id = old_product_id;
    if product_id is null then
      select id into product_id from public.products
      where owner_id = uid and lower(name) = lower(coalesce(item->>'productName', old_product_id))
      order by created_at limit 1;
    end if;
    if product_id is not null then
      insert into public.purchases (owner_id, product_id, supplier_name, vehicle_plate, quantity_kg, unit_buy_price, transaction_at, status, created_at)
      values (
        uid, product_id, trim(coalesce(item->>'person', item->>'supplier_name')),
        upper(trim(coalesce(item->>'plate', item->>'vehicle_plate'))),
        coalesce(item->>'kg', item->>'quantity_kg')::numeric,
        coalesce(item->>'buyPrice', item->>'unit_buy_price')::numeric,
        case when coalesce(item->>'dateTime', item->>'transaction_at') ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
          then coalesce(item->>'dateTime', item->>'transaction_at')::timestamptz
          else coalesce(item->>'dateTime', item->>'transaction_at')::timestamp at time zone 'Europe/Istanbul' end,
        case when coalesce(item->>'status','active') = 'cancelled' then 'cancelled' else 'active' end,
        coalesce((item->>'createdAt')::timestamptz, now())
      );
      imported_purchases := imported_purchases + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'products', imported_products,
    'purchases', imported_purchases,
    'expenses', imported_expenses,
    'contacts', imported_contacts
  );
end;
$$;

revoke all on function public.import_gurminik_backup(jsonb) from public, anon;
grant execute on function public.import_gurminik_backup(jsonb) to authenticated;

create or replace function public.claim_gurminik_import()
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  uid uuid := auth.uid();
  account_email text := lower(coalesce(auth.jwt()->>'email',''));
  pending_payload jsonb;
  result jsonb;
begin
  if uid is null or account_email = '' then raise exception 'Oturum gerekli'; end if;
  select payload into pending_payload
  from private.gurminik_pending_imports
  where email = account_email and claimed_at is null
  for update;
  if pending_payload is null then return jsonb_build_object('claimed', false); end if;
  result := public.import_gurminik_backup(pending_payload);
  update private.gurminik_pending_imports set claimed_at = now() where email = account_email;
  return jsonb_build_object('claimed', true, 'imported', result);
end;
$$;

revoke all on function public.claim_gurminik_import() from public, anon;
grant execute on function public.claim_gurminik_import() to authenticated;

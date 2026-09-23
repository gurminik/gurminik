-- Product-safe cold storage costs and a managed product catalogue.
-- Existing product_name snapshots remain intact for backward compatibility.

create table if not exists public.cold_storage_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cold_storage_products_owner_name_idx
  on public.cold_storage_products(owner_id, lower(btrim(name)));
create index if not exists cold_storage_products_owner_active_idx
  on public.cold_storage_products(owner_id, is_active, name);

alter table public.cold_storage_products enable row level security;
drop policy if exists cold_storage_products_select on public.cold_storage_products;
create policy cold_storage_products_select on public.cold_storage_products for select to authenticated
using (((owner_id = (select auth.uid())) or (select private.is_gurminik_admin()))
  and (select private.has_gurminik_permission('cold_storage','view')));
drop policy if exists cold_storage_products_insert on public.cold_storage_products;
create policy cold_storage_products_insert on public.cold_storage_products for insert to authenticated
with check (owner_id = (select auth.uid()) and (select private.has_gurminik_permission('cold_storage','create')));
drop policy if exists cold_storage_products_update on public.cold_storage_products;
create policy cold_storage_products_update on public.cold_storage_products for update to authenticated
using (((owner_id = (select auth.uid())) or (select private.is_gurminik_admin()))
  and (select private.has_gurminik_permission('cold_storage','update')))
with check (((owner_id = (select auth.uid())) or (select private.is_gurminik_admin()))
  and (select private.has_gurminik_permission('cold_storage','update')));
drop policy if exists cold_storage_products_delete on public.cold_storage_products;
create policy cold_storage_products_delete on public.cold_storage_products for delete to authenticated
using (((owner_id = (select auth.uid())) or (select private.is_gurminik_admin()))
  and (select private.has_gurminik_permission('cold_storage','delete')));
revoke all on public.cold_storage_products from public, anon;
grant select, insert, update, delete on public.cold_storage_products to authenticated;

alter table public.cold_storage_purchases add column if not exists product_id uuid;
alter table public.cold_storage_sales add column if not exists product_id uuid;
alter table public.cold_storage_expenses add column if not exists product_id uuid;
alter table public.cold_storage_expenses add column if not exists expense_scope text not null default 'general';

do $$ begin
  alter table public.cold_storage_purchases add constraint cold_storage_purchases_product_id_fkey
    foreign key(product_id) references public.cold_storage_products(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.cold_storage_sales add constraint cold_storage_sales_product_id_fkey
    foreign key(product_id) references public.cold_storage_products(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.cold_storage_expenses add constraint cold_storage_expenses_product_id_fkey
    foreign key(product_id) references public.cold_storage_products(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.cold_storage_expenses add constraint cold_storage_expenses_scope_check
    check (expense_scope in ('purchase','sale','general'));
exception when duplicate_object then null; end $$;

insert into public.cold_storage_products(owner_id,name)
select owner_id, btrim(product_name)
from (
  select owner_id, product_name from public.cold_storage_purchases
  union select owner_id, product_name from public.cold_storage_sales
  union select owner_id, product_name from public.cold_storage_expenses where product_name is not null
) names
where btrim(coalesce(product_name,'')) <> ''
on conflict (owner_id, lower(btrim(name))) do nothing;

update public.cold_storage_purchases r set product_id=p.id
from public.cold_storage_products p
where r.product_id is null and p.owner_id=r.owner_id and lower(btrim(p.name))=lower(btrim(r.product_name));
update public.cold_storage_sales r set product_id=p.id
from public.cold_storage_products p
where r.product_id is null and p.owner_id=r.owner_id and lower(btrim(p.name))=lower(btrim(r.product_name));
update public.cold_storage_expenses r set product_id=p.id
from public.cold_storage_products p
where r.product_id is null and p.owner_id=r.owner_id and lower(btrim(p.name))=lower(btrim(r.product_name));

create index if not exists cold_storage_purchases_owner_product_date_idx
  on public.cold_storage_purchases(owner_id,product_id,transaction_at desc) where status='active';
create index if not exists cold_storage_purchases_product_id_idx
  on public.cold_storage_purchases(product_id);
create index if not exists cold_storage_sales_owner_product_date_idx
  on public.cold_storage_sales(owner_id,product_id,transaction_at desc) where status='active';
create index if not exists cold_storage_sales_product_id_idx
  on public.cold_storage_sales(product_id);
create index if not exists cold_storage_expenses_owner_scope_product_date_idx
  on public.cold_storage_expenses(owner_id,expense_scope,product_id,transaction_at desc);
create index if not exists cold_storage_expenses_product_id_idx
  on public.cold_storage_expenses(product_id);

do $$ begin
  if to_regprocedure('private.gurminik_audit_row()') is not null then
    execute 'drop trigger if exists gurminik_audit_row on public.cold_storage_products';
    execute 'create trigger gurminik_audit_row after insert or update or delete on public.cold_storage_products for each row execute function private.gurminik_audit_row()';
  end if;
end $$;

create or replace function public.export_gurminik_backup_v4()
returns jsonb language plpgsql security invoker set search_path=''
as $$ declare result jsonb; begin
  result := public.export_gurminik_backup_v3();
  return jsonb_set(
    jsonb_set(result,'{backupVersion}','4'::jsonb,true),
    '{coldStorage,products}',
    coalesce((select jsonb_agg(to_jsonb(p)-'owner_id' order by p.name,p.id)
      from public.cold_storage_products p where p.owner_id=auth.uid()),'[]'::jsonb),true
  ) || jsonb_build_object('schemaVersion','2026-09-23.2');
end $$;

create or replace function public.restore_gurminik_backup_v4(payload jsonb, restore_mode text default 'merge')
returns jsonb language plpgsql security invoker set search_path=public,private,pg_temp
as $$
declare result jsonb; item jsonb; n_added int:=0; n_skipped int:=0; product_row public.cold_storage_products%rowtype;
begin
  result := public.restore_gurminik_backup_v3(payload,restore_mode);
  perform set_config('gurminik.audit_disabled','on',true);
  if restore_mode='replace' then delete from public.cold_storage_products where owner_id=auth.uid(); end if;
  for item in select value from jsonb_array_elements(coalesce(payload#>'{coldStorage,products}','[]'::jsonb)) loop
    select * into product_row from public.cold_storage_products
      where owner_id=auth.uid() and lower(btrim(name))=lower(btrim(item->>'name')) limit 1;
    if product_row.id is null then
      insert into public.cold_storage_products(owner_id,name,is_active,created_at)
      values(auth.uid(),btrim(item->>'name'),coalesce((item->>'is_active')::boolean,true),coalesce((item->>'created_at')::timestamptz,now()));
      n_added:=n_added+1;
    else n_skipped:=n_skipped+1; end if;
  end loop;
  insert into public.cold_storage_products(owner_id,name)
  select auth.uid(),btrim(product_name) from (
    select product_name from public.cold_storage_purchases where owner_id=auth.uid()
    union select product_name from public.cold_storage_sales where owner_id=auth.uid()
    union select product_name from public.cold_storage_expenses where owner_id=auth.uid() and product_name is not null
  ) q where btrim(coalesce(product_name,''))<>''
  on conflict(owner_id,lower(btrim(name))) do nothing;
  update public.cold_storage_purchases r set product_id=p.id from public.cold_storage_products p
    where r.owner_id=auth.uid() and r.product_id is null and p.owner_id=r.owner_id and lower(btrim(p.name))=lower(btrim(r.product_name));
  update public.cold_storage_sales r set product_id=p.id from public.cold_storage_products p
    where r.owner_id=auth.uid() and r.product_id is null and p.owner_id=r.owner_id and lower(btrim(p.name))=lower(btrim(r.product_name));
  update public.cold_storage_expenses r set product_id=p.id from public.cold_storage_products p
    where r.owner_id=auth.uid() and r.product_id is null and p.owner_id=r.owner_id and lower(btrim(p.name))=lower(btrim(r.product_name));
  perform set_config('gurminik.audit_disabled','off',true);
  return result || jsonb_build_object('coldProducts',jsonb_build_object('added',n_added,'skipped',n_skipped));
exception when others then
  perform set_config('gurminik.audit_disabled','off',true);
  raise;
end $$;

revoke all on function public.export_gurminik_backup_v4() from public,anon;
revoke all on function public.restore_gurminik_backup_v4(jsonb,text) from public,anon;
grant execute on function public.export_gurminik_backup_v4() to authenticated;
grant execute on function public.restore_gurminik_backup_v4(jsonb,text) to authenticated;

create or replace function public.reset_gurminik_application_v2(input_password text, confirmation_text text)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare result jsonb; removed bigint;
begin
  result := public.reset_gurminik_application(input_password,confirmation_text);
  if coalesce((result->>'success')::boolean,false) then
    perform set_config('gurminik.audit_disabled','on',true);
    with d as (delete from public.cold_storage_products returning 1)
      select count(*) into removed from d;
    perform set_config('gurminik.audit_disabled','off',true);
    result := jsonb_set(result,'{deleted,coldProducts}',to_jsonb(removed),true);
  end if;
  return result;
end $$;
revoke all on function public.reset_gurminik_application_v2(text,text) from public,anon;
grant execute on function public.reset_gurminik_application_v2(text,text) to authenticated;

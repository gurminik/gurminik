-- GURMİNİK işlem geçmişi ve güvenli yeni sezon sıfırlaması.
-- Bu migration hiçbir mevcut işletme kaydını silmez.

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  actor_user_id uuid,
  actor_name text not null default 'Sistem',
  module text not null,
  action_type text not null,
  entity_type text,
  entity_id text,
  person_name text,
  product_name text,
  quantity numeric(16,3),
  amount numeric(18,2),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_logs_action_type_check check (
    action_type in ('create','update','cancel','restore','delete','export','import','permission','system')
  ),
  constraint activity_logs_metadata_size_check check (pg_column_size(metadata) <= 32768)
);

create index if not exists activity_logs_business_created_idx
  on public.activity_logs (business_id, created_at desc, id desc);
create index if not exists activity_logs_business_module_created_idx
  on public.activity_logs (business_id, module, created_at desc);
create index if not exists activity_logs_actor_created_idx
  on public.activity_logs (actor_user_id, created_at desc)
  where actor_user_id is not null;

alter table public.activity_logs enable row level security;
drop policy if exists activity_logs_select_authorized on public.activity_logs;
create policy activity_logs_select_authorized on public.activity_logs
  for select to authenticated
  using (
    private.is_gurminik_admin()
    or private.has_gurminik_permission('activity_logs', 'view')
  );

revoke all on public.activity_logs from public, anon, authenticated;
grant select on public.activity_logs to authenticated;

alter table public.user_permissions drop constraint if exists user_permissions_module_check;
alter table public.user_permissions add constraint user_permissions_module_check
  check (module in (
    'dashboard','purchases','sales','ranking','expenses','contacts','accounts',
    'favorites','cold_storage','reports','backup','activity_logs'
  ));

insert into public.user_permissions(user_id,module)
select p.id,'activity_logs'
from public.profiles p
where p.role <> 'admin'
on conflict(user_id,module) do nothing;

create or replace function private.gurminik_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.role = 'admin'
  order by p.created_at, p.id
  limit 1
$$;

create or replace function private.gurminik_actor_name(actor uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.email), ''), actor::text, 'Sistem')
  from (select 1) seed
  left join public.profiles p on p.id = actor
$$;

create or replace function private.write_gurminik_activity(
  p_module text,
  p_action_type text,
  p_entity_type text,
  p_entity_id text,
  p_person_name text,
  p_product_name text,
  p_quantity numeric,
  p_amount numeric,
  p_description text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  safe_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if uid is null then return null; end if;
  if current_setting('gurminik.audit_disabled', true) = 'on' then return null; end if;
  if pg_column_size(safe_metadata) > 32768 then
    safe_metadata := jsonb_build_object('notice', 'Ayrıntı boyut sınırı nedeniyle kısaltıldı.');
  end if;
  insert into public.activity_logs(
    business_id, actor_user_id, actor_name, module, action_type,
    entity_type, entity_id, person_name, product_name, quantity, amount,
    description, metadata
  ) values (
    private.gurminik_business_id(), uid, private.gurminik_actor_name(uid),
    p_module, p_action_type, p_entity_type, p_entity_id,
    nullif(btrim(p_person_name), ''), nullif(btrim(p_product_name), ''),
    p_quantity, p_amount, p_description, safe_metadata
  ) returning id into new_id;
  return new_id;
end;
$$;

create or replace function private.gurminik_audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  old_data jsonb;
  module_name text;
  action_name text;
  entity_name text := tg_table_name;
  person_value text;
  product_value text;
  quantity_value numeric;
  amount_value numeric;
  product_id_value uuid;
  actor_label text := private.gurminik_actor_name(auth.uid());
  module_label text;
  verb_label text;
  detail jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or current_setting('gurminik.audit_disabled', true) = 'on' then
    return coalesce(new, old);
  end if;
  -- Binlerce satırlık vCard içe aktarımında ücretsiz planı şişirmemek için
  -- satır başına log yerine aşağıdaki toplu özet RPC'si kullanılır.
  if tg_table_name = 'contacts' and tg_op = 'INSERT'
     and coalesce(new.notes, '') like 'vCard aktarımı%' then
    return new;
  end if;

  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  old_data := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  module_name := case tg_table_name
    when 'purchases' then 'purchases'
    when 'sales' then 'sales'
    when 'expenses' then 'expenses'
    when 'expense_categories' then 'expenses'
    when 'contacts' then 'contacts'
    when 'contact_categories' then 'contacts'
    when 'account_payments' then 'accounts'
    when 'favorites' then 'favorites'
    when 'cold_storage_purchases' then 'cold_storage'
    when 'cold_storage_sales' then 'cold_storage'
    when 'cold_storage_expenses' then 'cold_storage'
    when 'cold_storage_expense_categories' then 'cold_storage'
    when 'shipments' then 'sales'
    when 'products' then 'dashboard'
    else 'system'
  end;
  module_label := case module_name
    when 'purchases' then 'Alış'
    when 'sales' then 'Satış'
    when 'expenses' then 'Gider'
    when 'contacts' then 'Telefon'
    when 'accounts' then 'Cari hesap'
    when 'favorites' then 'Favori'
    when 'cold_storage' then 'Soğuk Hava'
    when 'dashboard' then 'Ürün'
    else 'Sistem'
  end;

  if tg_op = 'INSERT' then
    action_name := 'create'; verb_label := 'oluşturdu';
  elsif tg_op = 'DELETE' then
    action_name := 'delete'; verb_label := 'sildi';
  elsif old_data->>'status' is distinct from row_data->>'status'
        and row_data->>'status' = 'cancelled' then
    action_name := 'cancel'; verb_label := 'iptal etti';
  elsif old_data->>'status' is distinct from row_data->>'status'
        and row_data->>'status' = 'active' then
    action_name := 'restore'; verb_label := 'yeniden etkinleştirdi';
  else
    action_name := 'update'; verb_label := 'düzenledi';
  end if;

  person_value := coalesce(
    row_data->>'supplier_name', row_data->>'buyer_name', row_data->>'company_name',
    row_data->>'person_name', row_data->>'driver_name', row_data->>'name', row_data->>'title'
  );
  product_value := nullif(row_data->>'product_name', '');
  begin product_id_value := nullif(row_data->>'product_id','')::uuid; exception when others then product_id_value := null; end;
  if product_value is null and product_id_value is not null then
    select p.name into product_value from public.products p where p.id = product_id_value;
  end if;
  begin quantity_value := coalesce(nullif(row_data->>'quantity_kg','')::numeric, nullif(row_data->>'total_weight_kg','')::numeric, nullif(row_data->>'loss_kg','')::numeric); exception when others then quantity_value := null; end;
  begin amount_value := coalesce(nullif(row_data->>'total_buy_amount','')::numeric, nullif(row_data->>'total_sale_amount','')::numeric, nullif(row_data->>'amount','')::numeric); exception when others then amount_value := null; end;
  if amount_value is null and quantity_value is not null then
    begin amount_value := quantity_value * coalesce(nullif(row_data->>'unit_buy_price','')::numeric, nullif(row_data->>'unit_sale_price','')::numeric); exception when others then amount_value := null; end;
  end if;

  if tg_op = 'UPDATE' then
    detail := jsonb_build_object(
      'old', (old_data - 'owner_id' - 'created_at' - 'updated_at'),
      'new', (row_data - 'owner_id' - 'created_at' - 'updated_at')
    );
  elsif tg_op = 'DELETE' then
    detail := jsonb_build_object('deleted', row_data - 'owner_id' - 'created_at' - 'updated_at');
  else
    detail := jsonb_build_object('status', row_data->>'status');
  end if;

  perform private.write_gurminik_activity(
    module_name, action_name, entity_name, row_data->>'id', person_value,
    product_value, quantity_value, amount_value,
    actor_label || ' · ' || module_label || ' kaydını ' || verb_label || '.', detail
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'products','purchases','sales','expenses','expense_categories',
    'contact_categories','contacts','account_payments','favorites','shipments',
    'cold_storage_purchases','cold_storage_sales','cold_storage_expenses',
    'cold_storage_expense_categories'
  ] loop
    execute format('drop trigger if exists gurminik_audit_row on public.%I', t);
    execute format(
      'create trigger gurminik_audit_row after insert or update or delete on public.%I for each row execute function private.gurminik_audit_row()',
      t
    );
  end loop;
end $$;

create or replace function public.log_gurminik_export(
  export_module text,
  report_name text,
  date_start date default null,
  date_end date default null,
  filters jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); required_module text;
begin
  if uid is null then raise exception 'Oturum gerekli' using errcode='42501'; end if;
  if export_module not in ('reports','backup','activity_logs','cold_storage') then
    raise exception 'Geçersiz dışa aktarma modülü';
  end if;
  required_module := case when export_module='cold_storage' then 'cold_storage' else export_module end;
  if not private.is_gurminik_admin() and not private.has_gurminik_permission(required_module,'view') then
    raise exception 'Bu rapor için yetkiniz yok' using errcode='42501';
  end if;
  return private.write_gurminik_activity(
    export_module, 'export', 'report', null, null, null, null, null,
    private.gurminik_actor_name(uid) || ' · ' || report_name || ' indirdi.',
    jsonb_build_object('report_name',report_name,'date_start',date_start,'date_end',date_end,'filters',coalesce(filters,'{}'::jsonb))
  );
end;
$$;

create or replace function public.log_gurminik_contact_import(added_count integer, skipped_count integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli' using errcode='42501'; end if;
  if not private.is_gurminik_admin() and not private.has_gurminik_permission('contacts','create') then
    raise exception 'Telefon ekleme yetkisi gerekli' using errcode='42501';
  end if;
  return private.write_gurminik_activity(
    'contacts','import','contacts',null,null,null,null,null,
    private.gurminik_actor_name(auth.uid())||' · Rehberden '||greatest(added_count,0)||' telefon kaydı aktardı.',
    jsonb_build_object('added',greatest(added_count,0),'skipped',greatest(skipped_count,0))
  );
end;
$$;

create or replace function public.export_gurminik_backup_v3()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare result jsonb;
begin
  result := public.export_gurminik_backup_v2();
  perform public.log_gurminik_export('backup','Tam JSON yedeği',null,null,'{}'::jsonb);
  return jsonb_set(result,'{backupVersion}','3'::jsonb,true)
    || jsonb_build_object('schemaVersion','2026-09-23.1');
end;
$$;

create or replace function public.restore_gurminik_backup_v3(payload jsonb, restore_mode text default 'merge')
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare result jsonb;
begin
  perform set_config('gurminik.audit_disabled','on',true);
  result := public.restore_gurminik_backup_v2(payload,restore_mode);
  perform set_config('gurminik.audit_disabled','off',true);
  perform private.write_gurminik_activity(
    'backup','import','backup',null,null,null,null,null,
    private.gurminik_actor_name(auth.uid()) || ' · JSON yedeğini ' || case when restore_mode='replace' then 'tam geri yükledi.' else 'mevcut verilerle birleştirdi.' end,
    jsonb_build_object('mode',restore_mode,'backup_version',payload->>'backupVersion','result',result)
  );
  return result;
exception when others then
  perform set_config('gurminik.audit_disabled','off',true);
  raise;
end;
$$;

create table if not exists private.gurminik_business_state (
  singleton boolean primary key default true check (singleton),
  reset_version bigint not null default 0,
  epoch uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
insert into private.gurminik_business_state(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists private.gurminik_reset_secret (
  singleton boolean primary key default true check (singleton),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.gurminik_reset_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_count integer not null default 0,
  first_failed_at timestamptz,
  locked_until timestamptz
);

create table if not exists private.gurminik_reset_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  actor_name text not null,
  success boolean not null,
  deleted_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists gurminik_reset_events_created_idx on private.gurminik_reset_events(created_at desc);

revoke all on private.gurminik_business_state, private.gurminik_reset_secret,
  private.gurminik_reset_attempts, private.gurminik_reset_events from public, anon, authenticated;

create or replace function public.get_gurminik_business_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null or not exists(select 1 from public.profiles p where p.id=uid and p.is_active) then
    raise exception 'Oturum gerekli' using errcode='42501';
  end if;
  select jsonb_build_object('resetVersion',s.reset_version,'epoch',s.epoch,'updatedAt',s.updated_at)
  into result from private.gurminik_business_state s where s.singleton;
  return result;
end;
$$;

create or replace function public.reset_gurminik_application(
  input_password text,
  confirmation_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  stored_hash text;
  attempt private.gurminik_reset_attempts%rowtype;
  counts jsonb := '{}'::jsonb;
  n bigint;
  next_epoch uuid;
begin
  if uid is null or not exists(
    select 1 from public.profiles p where p.id=uid and p.role='admin' and p.is_active
  ) then raise exception 'Yalnızca ana yönetici sıfırlama yapabilir' using errcode='42501'; end if;
  perform private.require_gurminik_admin_verification();
  if confirmation_text <> 'TÜM VERİLERİ SİL' then
    return jsonb_build_object('success',false,'error','Onay metni eşleşmiyor.');
  end if;
  select * into attempt from private.gurminik_reset_attempts where user_id=uid;
  if attempt.locked_until is not null and attempt.locked_until > now() then
    return jsonb_build_object('success',false,'error','Çok fazla hatalı deneme. 15 dakika sonra yeniden deneyin.');
  end if;
  select password_hash into stored_hash from private.gurminik_reset_secret where singleton;
  if stored_hash is null then raise exception 'Sıfırlama sırrı sunucuda yapılandırılmamış'; end if;
  if extensions.crypt(input_password, stored_hash) <> stored_hash then
    insert into private.gurminik_reset_attempts(user_id,failed_count,first_failed_at,locked_until)
    values(uid,1,now(),null)
    on conflict(user_id) do update set
      failed_count=case when private.gurminik_reset_attempts.first_failed_at < now()-interval '15 minutes' then 1 else private.gurminik_reset_attempts.failed_count+1 end,
      first_failed_at=case when private.gurminik_reset_attempts.first_failed_at < now()-interval '15 minutes' then now() else private.gurminik_reset_attempts.first_failed_at end,
      locked_until=case when private.gurminik_reset_attempts.failed_count+1 >= 5 then now()+interval '15 minutes' else null end;
    insert into private.gurminik_reset_events(actor_user_id,actor_name,success,deleted_counts)
    values(uid,private.gurminik_actor_name(uid),false,jsonb_build_object('reason','invalid_password'));
    return jsonb_build_object('success',false,'error','Sıfırlama şifresi hatalı.');
  end if;

  delete from private.gurminik_reset_attempts where user_id=uid;
  perform set_config('gurminik.audit_disabled','on',true);

  select count(*) into n from public.activity_logs; counts:=counts||jsonb_build_object('activityLogs',n);
  delete from public.activity_logs;
  with d as (delete from public.sales returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('sales',n);
  with d as (delete from public.purchases returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('purchases',n);
  with d as (delete from public.favorites returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('favorites',n);
  with d as (delete from public.shipments returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('shipments',n);
  with d as (delete from public.contacts returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('contacts',n);
  with d as (delete from public.account_payments returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('accountPayments',n);
  with d as (delete from public.expenses returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('expenses',n);
  with d as (delete from public.cold_storage_sales returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('coldSales',n);
  with d as (delete from public.cold_storage_purchases returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('coldPurchases',n);
  with d as (delete from public.cold_storage_expenses returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('coldExpenses',n);
  with d as (delete from public.cold_storage_expense_categories returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('coldExpenseCategories',n);
  with d as (delete from public.expense_categories returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('expenseCategories',n);
  with d as (delete from public.contact_categories returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('contactCategories',n);
  with d as (delete from public.products returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('products',n);
  with d as (delete from private.gurminik_pending_imports returning 1) select count(*) into n from d; counts:=counts||jsonb_build_object('pendingImports',n);
  counts:=counts||jsonb_build_object('storageFiles',0);

  update private.gurminik_business_state
  set reset_version=reset_version+1,epoch=gen_random_uuid(),updated_at=now()
  where singleton returning epoch into next_epoch;
  insert into private.gurminik_reset_events(actor_user_id,actor_name,success,deleted_counts)
  values(uid,private.gurminik_actor_name(uid),true,counts);
  perform set_config('gurminik.audit_disabled','off',true);
  return jsonb_build_object('success',true,'deleted',counts,'epoch',next_epoch);
exception when others then
  perform set_config('gurminik.audit_disabled','off',true);
  raise;
end;
$$;

create or replace function public.admin_set_gurminik_user_access(target_user_id uuid, active boolean, permission_set jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare item text; value jsonb; target_label text;
begin
  perform private.require_gurminik_admin_verification();
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Kullanıcı bulunamadı'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role='admin') then raise exception 'Yönetici hesabının yetkileri değiştirilemez' using errcode='42501'; end if;
  update public.profiles set is_active=active,updated_at=now() where id=target_user_id;
  foreach item in array array['dashboard','purchases','sales','ranking','expenses','contacts','accounts','favorites','reports','backup','cold_storage','activity_logs'] loop
    value:=coalesce(permission_set->item,'{}'::jsonb);
    insert into public.user_permissions(user_id,module,can_view,can_create,can_update,can_delete,updated_at)
    values(target_user_id,item,coalesce((value->>'can_view')::boolean,false),coalesce((value->>'can_create')::boolean,false),coalesce((value->>'can_update')::boolean,false),coalesce((value->>'can_delete')::boolean,false),now())
    on conflict(user_id,module) do update set can_view=excluded.can_view,can_create=excluded.can_create,can_update=excluded.can_update,can_delete=excluded.can_delete,updated_at=now();
  end loop;
  select coalesce(display_name,email,target_user_id::text) into target_label from public.profiles where id=target_user_id;
  perform private.write_gurminik_activity('activity_logs','permission','profile',target_user_id::text,target_label,null,null,null,
    private.gurminik_actor_name(auth.uid())||' · '||target_label||' kullanıcısının yetkilerini değiştirdi.',
    jsonb_build_object('active',active,'permissions',permission_set));
  return true;
end;
$$;

revoke all on function private.gurminik_business_id() from public,anon,authenticated;
revoke all on function private.gurminik_actor_name(uuid) from public,anon,authenticated;
revoke all on function private.write_gurminik_activity(text,text,text,text,text,text,numeric,numeric,text,jsonb) from public,anon,authenticated;
revoke all on function private.gurminik_audit_row() from public,anon,authenticated;
revoke all on function public.log_gurminik_export(text,text,date,date,jsonb) from public,anon;
revoke all on function public.log_gurminik_contact_import(integer,integer) from public,anon;
revoke all on function public.export_gurminik_backup_v3() from public,anon;
revoke all on function public.restore_gurminik_backup_v3(jsonb,text) from public,anon;
revoke all on function public.get_gurminik_business_state() from public,anon;
revoke all on function public.reset_gurminik_application(text,text) from public,anon;
grant execute on function public.log_gurminik_export(text,text,date,date,jsonb) to authenticated;
grant execute on function public.log_gurminik_contact_import(integer,integer) to authenticated;
grant execute on function public.export_gurminik_backup_v3() to authenticated;
grant execute on function public.restore_gurminik_backup_v3(jsonb,text) to authenticated;
grant execute on function public.get_gurminik_business_state() to authenticated;
grant execute on function public.reset_gurminik_application(text,text) to authenticated;

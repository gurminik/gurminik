-- Complete, owner-safe and transactional GURMİNİK backup/restore.
-- Existing rows are only deleted when restore_mode = 'replace'.

drop index if exists public.favorites_person_name_unique_idx;
create unique index if not exists favorites_owner_person_name_unique_idx
  on public.favorites (owner_id, lower(btrim(person_name)));

create or replace function private.gurminik_backup_time(value text)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when value is null or btrim(value) = '' then now()
    when value ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then value::timestamptz
    else value::timestamp at time zone 'Europe/Istanbul'
  end
$$;

revoke all on function private.gurminik_backup_time(text) from public, anon;
grant execute on function private.gurminik_backup_time(text) to authenticated;

create or replace function public.export_gurminik_backup_v2()
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Oturum gerekli' using errcode = '42501';
  end if;
  if not private.is_gurminik_admin()
     and not private.has_gurminik_permission('backup', 'view') then
    raise exception 'Yedekleme görüntüleme yetkisi gerekli' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'backupVersion', 2,
    'createdAt', now(),
    'appName', 'GURMİNİK',
    'userId', uid,
    'schemaVersion', '2026-09-21.2',
    'tables', jsonb_build_object(
      'products', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.created_at, x.id)
        from public.products x where x.owner_id = uid
      ), '[]'::jsonb),
      'purchases', coalesce((
        select jsonb_agg(
          (to_jsonb(x) - 'owner_id') || jsonb_build_object('product_name', p.name)
          order by x.transaction_at, x.id
        )
        from public.purchases x
        join public.products p on p.id = x.product_id
        where x.owner_id = uid
      ), '[]'::jsonb),
      'sales', coalesce((
        select jsonb_agg(
          (to_jsonb(x) - 'owner_id') || jsonb_build_object('product_name', p.name)
          order by x.transaction_at, x.id
        )
        from public.sales x
        join public.products p on p.id = x.product_id
        where x.owner_id = uid
      ), '[]'::jsonb),
      'expenses', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.transaction_at, x.id)
        from public.expenses x where x.owner_id = uid
      ), '[]'::jsonb),
      'expenseCategories', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.name, x.id)
        from public.expense_categories x where x.owner_id = uid
      ), '[]'::jsonb),
      'contactCategories', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.name, x.id)
        from public.contact_categories x where x.owner_id = uid
      ), '[]'::jsonb),
      'contacts', coalesce((
        select jsonb_agg((to_jsonb(x) - 'owner_id') - 'phone_normalized' order by x.name, x.id)
        from public.contacts x where x.owner_id = uid
      ), '[]'::jsonb),
      'accountPayments', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.payment_at, x.id)
        from public.account_payments x where x.owner_id = uid
      ), '[]'::jsonb),
      'favorites', coalesce((
        select jsonb_agg(
          (to_jsonb(x) - 'owner_id') || jsonb_build_object('product_name', p.name)
          order by x.created_at, x.id
        )
        from public.favorites x
        left join public.products p on p.id = x.last_product_id
        where x.owner_id = uid
      ), '[]'::jsonb),
      'shipments', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.shipment_at, x.id)
        from public.shipments x where x.owner_id = uid
      ), '[]'::jsonb)
    ),
    'coldStorage', jsonb_build_object(
      'purchases', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.transaction_at, x.id)
        from public.cold_storage_purchases x where x.owner_id = uid
      ), '[]'::jsonb),
      'sales', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.transaction_at, x.id)
        from public.cold_storage_sales x where x.owner_id = uid
      ), '[]'::jsonb),
      'expenses', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.transaction_at, x.id)
        from public.cold_storage_expenses x where x.owner_id = uid
      ), '[]'::jsonb),
      'expenseCategories', coalesce((
        select jsonb_agg(to_jsonb(x) - 'owner_id' order by x.name, x.id)
        from public.cold_storage_expense_categories x where x.owner_id = uid
      ), '[]'::jsonb)
    ),
    'settings', '{}'::jsonb
  );
end;
$$;

revoke all on function public.export_gurminik_backup_v2() from public, anon;
grant execute on function public.export_gurminik_backup_v2() to authenticated;

create or replace function public.restore_gurminik_backup_v2(
  payload jsonb,
  restore_mode text default 'merge'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  source_rows jsonb;
  report jsonb := '{}'::jsonb;
  section_name text := 'başlangıç';
  added_count integer := 0;
  skipped_count integer := 0;
  source_id text;
  candidate_id uuid;
  resolved_id uuid;
  resolved_product uuid;
  resolved_contact uuid;
  resolved_shipment uuid;
  item_name text;
  item_phone text;
  item_time timestamptz;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
begin
  if uid is null then
    raise exception 'Oturum gerekli' using errcode = '42501';
  end if;
  if restore_mode not in ('merge', 'replace') then
    raise exception 'Geçersiz geri yükleme modu';
  end if;
  if not private.is_gurminik_admin()
     and not private.has_gurminik_permission('backup', 'create') then
    raise exception 'Yedek geri yükleme yetkisi gerekli' using errcode = '42501';
  end if;
  if restore_mode = 'replace'
     and not private.is_gurminik_admin()
     and not private.has_gurminik_permission('backup', 'delete') then
    raise exception 'Tam geri yükleme için silme yetkisi gerekli' using errcode = '42501';
  end if;

  create temporary table if not exists gurminik_restore_product_map(
    old_id text primary key,
    new_id uuid not null
  ) on commit drop;
  create temporary table if not exists gurminik_restore_contact_map(
    old_id text primary key,
    new_id uuid not null
  ) on commit drop;
  create temporary table if not exists gurminik_restore_shipment_map(
    old_id text primary key,
    new_id uuid not null
  ) on commit drop;
  truncate gurminik_restore_product_map, gurminik_restore_contact_map, gurminik_restore_shipment_map;

  if restore_mode = 'replace' then
    section_name := 'mevcut verileri temizleme';
    delete from public.sales where owner_id = uid;
    delete from public.purchases where owner_id = uid;
    delete from public.favorites where owner_id = uid;
    delete from public.shipments where owner_id = uid;
    delete from public.contacts where owner_id = uid;
    delete from public.account_payments where owner_id = uid;
    delete from public.expenses where owner_id = uid;
    delete from public.expense_categories where owner_id = uid;
    delete from public.contact_categories where owner_id = uid;
    delete from public.cold_storage_purchases where owner_id = uid;
    delete from public.cold_storage_sales where owner_id = uid;
    delete from public.cold_storage_expenses where owner_id = uid;
    delete from public.cold_storage_expense_categories where owner_id = uid;
    delete from public.products where owner_id = uid;
  end if;

  section_name := 'ürünler';
  added_count := 0; skipped_count := 0;
  source_rows := coalesce(payload #> '{tables,products}', payload->'products', '[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    item_name := btrim(coalesce(item->>'name', ''));
    if item_name = '' then skipped_count := skipped_count + 1; continue; end if;
    source_id := coalesce(item->>'id', item_name);
    resolved_id := null;
    if source_id ~* uuid_pattern then
      select id into resolved_id from public.products where owner_id = uid and id = source_id::uuid;
    end if;
    if resolved_id is null then
      select id into resolved_id from public.products
      where owner_id = uid and lower(btrim(name)) = lower(item_name) limit 1;
    end if;
    if resolved_id is null then
      candidate_id := case when source_id ~* uuid_pattern then source_id::uuid else gen_random_uuid() end;
      if exists(select 1 from public.products where id = candidate_id) then candidate_id := gen_random_uuid(); end if;
      insert into public.products(id, owner_id, name, unit, is_active, notes, icon, created_at)
      values (candidate_id, uid, item_name,
        case when coalesce(item->>'unit','kg') in ('kg','ton','adet','kasa') then coalesce(item->>'unit','kg') else 'kg' end,
        coalesce((item->>'is_active')::boolean, (item->>'isActive')::boolean, true),
        nullif(coalesce(item->>'notes',''),''), coalesce(nullif(item->>'icon',''),'●'),
        coalesce(nullif(item->>'created_at','')::timestamptz, nullif(item->>'createdAt','')::timestamptz, now()))
      returning id into resolved_id;
      added_count := added_count + 1;
    else skipped_count := skipped_count + 1;
    end if;
    insert into gurminik_restore_product_map(old_id,new_id) values(source_id,resolved_id)
      on conflict(old_id) do update set new_id=excluded.new_id;
  end loop;
  report := report || jsonb_build_object('products',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'gider kategorileri';
  added_count := 0; skipped_count := 0;
  source_rows := coalesce(payload #> '{tables,expenseCategories}', payload->'expenseCategories', payload->'categories', '[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    item_name := btrim(coalesce(item->>'name', item #>> '{}', ''));
    if item_name = '' or exists(select 1 from public.expense_categories where owner_id=uid and lower(btrim(name))=lower(item_name))
    then skipped_count:=skipped_count+1; continue; end if;
    source_id:=coalesce(item->>'id',''); candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end;
    if exists(select 1 from public.expense_categories where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    insert into public.expense_categories(id,owner_id,name,created_at) values(candidate_id,uid,item_name,coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now()));
    added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('expenseCategories',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'rehber kategorileri';
  added_count := 0; skipped_count := 0;
  source_rows := coalesce(payload #> '{tables,contactCategories}', payload->'contactCategories', '[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    item_name:=btrim(coalesce(item->>'name',item#>>'{}',''));
    if item_name='' or exists(select 1 from public.contact_categories where owner_id=uid and lower(btrim(name))=lower(item_name))
    then skipped_count:=skipped_count+1; continue; end if;
    source_id:=coalesce(item->>'id',''); candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end;
    if exists(select 1 from public.contact_categories where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    insert into public.contact_categories(id,owner_id,name,created_at) values(candidate_id,uid,item_name,coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now()));
    added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('contactCategories',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'telefon numaraları';
  added_count := 0; skipped_count := 0;
  source_rows := coalesce(payload #> '{tables,contacts}', payload->'contacts', '[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); item_phone:=nullif(btrim(coalesce(item->>'phone','')),''); resolved_id:=null;
    if source_id~*uuid_pattern then select id into resolved_id from public.contacts where owner_id=uid and id=source_id::uuid; end if;
    if resolved_id is null and item_phone is not null then
      select id into resolved_id from public.contacts where owner_id=uid and phone_normalized=public.normalize_contact_phone(item_phone) limit 1;
    end if;
    if resolved_id is null then
      candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end;
      if exists(select 1 from public.contacts where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
      insert into public.contacts(id,owner_id,name,phone,contact_type,vehicle_plate,notes,created_at)
      values(candidate_id,uid,btrim(coalesce(nullif(item->>'name',''),'İsimsiz')),item_phone,
        coalesce(nullif(item->>'contact_type',''),nullif(item->>'category',''),'Diğer'),
        nullif(upper(btrim(coalesce(item->>'vehicle_plate',item->>'plate',''))),''),
        nullif(coalesce(item->>'notes',item->>'note',''),''),
        coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now())) returning id into resolved_id;
      added_count:=added_count+1;
    else skipped_count:=skipped_count+1; end if;
    insert into gurminik_restore_contact_map(old_id,new_id) values(source_id,resolved_id) on conflict(old_id) do update set new_id=excluded.new_id;
  end loop;
  report:=report||jsonb_build_object('contacts',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'sevkiyatlar';
  added_count := 0; skipped_count := 0;
  source_rows := coalesce(payload #> '{tables,shipments}', payload->'shipments', '[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); resolved_id:=null; item_time:=private.gurminik_backup_time(coalesce(item->>'shipment_at',item->>'shipmentAt'));
    if source_id~*uuid_pattern then select id into resolved_id from public.shipments where owner_id=uid and id=source_id::uuid; end if;
    if resolved_id is null and coalesce(item->>'shipment_no','')<>'' then select id into resolved_id from public.shipments where owner_id=uid and shipment_no=item->>'shipment_no' limit 1; end if;
    if resolved_id is null then
      candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.shipments where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
      insert into public.shipments(id,owner_id,shipment_no,destination,buyer_name,truck_plate,driver_name,driver_phone,total_weight_kg,shipment_at,status,notes,created_at)
      values(candidate_id,uid,nullif(item->>'shipment_no',''),nullif(item->>'destination',''),nullif(item->>'buyer_name',''),nullif(item->>'truck_plate',''),nullif(item->>'driver_name',''),nullif(item->>'driver_phone',''),nullif(item->>'total_weight_kg','')::numeric,item_time,
        case when coalesce(item->>'status','hazirlaniyor') in('hazirlaniyor','yolda','teslim_edildi','iptal') then coalesce(item->>'status','hazirlaniyor') else 'hazirlaniyor' end,
        nullif(item->>'notes',''),coalesce(nullif(item->>'created_at','')::timestamptz,now())) returning id into resolved_id;
      added_count:=added_count+1;
    else skipped_count:=skipped_count+1; end if;
    insert into gurminik_restore_shipment_map(old_id,new_id) values(source_id,resolved_id) on conflict(old_id) do update set new_id=excluded.new_id;
  end loop;
  report:=report||jsonb_build_object('shipments',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'alışlar';
  added_count:=0; skipped_count:=0;
  source_rows:=coalesce(payload#>'{tables,purchases}',payload->'purchases',payload->'records','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); resolved_product:=null;
    select new_id into resolved_product from gurminik_restore_product_map where old_id=coalesce(item->>'product_id',item->>'productId',item->>'product');
    if resolved_product is null then select id into resolved_product from public.products where owner_id=uid and lower(name)=lower(coalesce(item->>'product_name',item->>'productName','')) limit 1; end if;
    if resolved_product is null then raise exception 'Alış kaydı için ürün bulunamadı'; end if;
    item_time:=private.gurminik_backup_time(coalesce(item->>'transaction_at',item->>'dateTime',item->>'date_time'));
    if (source_id~*uuid_pattern and exists(select 1 from public.purchases where owner_id=uid and id=source_id::uuid)) or exists(
      select 1 from public.purchases where owner_id=uid and product_id=resolved_product and supplier_name=btrim(coalesce(item->>'supplier_name',item->>'person','')) and
      quantity_kg=coalesce(nullif(item->>'quantity_kg','')::numeric,nullif(item->>'kg','')::numeric) and unit_buy_price=coalesce(nullif(item->>'unit_buy_price','')::numeric,nullif(item->>'buyPrice','')::numeric) and transaction_at=item_time)
    then skipped_count:=skipped_count+1; continue; end if;
    candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.purchases where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    resolved_contact:=null; select new_id into resolved_contact from gurminik_restore_contact_map where old_id=coalesce(item->>'supplier_contact_id',item->>'supplierContactId','');
    insert into public.purchases(id,owner_id,product_id,supplier_contact_id,supplier_name,quantity_kg,unit_buy_price,vehicle_plate,transaction_at,notes,status,is_paid,created_at)
    values(candidate_id,uid,resolved_product,resolved_contact,btrim(coalesce(nullif(item->>'supplier_name',''),nullif(item->>'person',''),'İsimsiz')),
      coalesce(nullif(item->>'quantity_kg','')::numeric,nullif(item->>'kg','')::numeric),coalesce(nullif(item->>'unit_buy_price','')::numeric,nullif(item->>'buyPrice','')::numeric),
      upper(coalesce(item->>'vehicle_plate',item->>'plate','')),item_time,nullif(coalesce(item->>'notes',item->>'note',''),''),case when coalesce(item->>'status','active')='cancelled' then 'cancelled' else 'active' end,
      coalesce((item->>'is_paid')::boolean,(item->>'isPaid')::boolean,true),coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now()));
    added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('purchases',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'satışlar';
  added_count:=0; skipped_count:=0; source_rows:=coalesce(payload#>'{tables,sales}',payload->'sales','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); resolved_product:=null;
    select new_id into resolved_product from gurminik_restore_product_map where old_id=coalesce(item->>'product_id',item->>'productId',item->>'product');
    if resolved_product is null then select id into resolved_product from public.products where owner_id=uid and lower(name)=lower(coalesce(item->>'product_name',item->>'productName','')) limit 1; end if;
    if resolved_product is null then raise exception 'Satış kaydı için ürün bulunamadı'; end if;
    item_time:=private.gurminik_backup_time(coalesce(item->>'transaction_at',item->>'dateTime'));
    if (source_id~*uuid_pattern and exists(select 1 from public.sales where owner_id=uid and id=source_id::uuid)) or exists(
      select 1 from public.sales where owner_id=uid and product_id=resolved_product and coalesce(buyer_name,'')=coalesce(item->>'buyer_name',item->>'buyer','') and quantity_kg=coalesce(nullif(item->>'quantity_kg','')::numeric,nullif(item->>'kg','')::numeric) and unit_sale_price=coalesce(nullif(item->>'unit_sale_price','')::numeric,nullif(item->>'sellPrice','')::numeric) and transaction_at=item_time)
    then skipped_count:=skipped_count+1; continue; end if;
    candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.sales where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    resolved_contact:=null; select new_id into resolved_contact from gurminik_restore_contact_map where old_id=coalesce(item->>'buyer_contact_id',item->>'buyerContactId','');
    resolved_shipment:=null; select new_id into resolved_shipment from gurminik_restore_shipment_map where old_id=coalesce(item->>'shipment_id',item->>'shipmentId','');
    insert into public.sales(id,owner_id,product_id,shipment_id,buyer_contact_id,buyer_name,quantity_kg,unit_sale_price,transaction_at,notes,vehicle_plate,status,driver_name,created_at)
    values(candidate_id,uid,resolved_product,resolved_shipment,resolved_contact,coalesce(nullif(item->>'buyer_name',''),nullif(item->>'buyer',''),'Alıcı'),
      coalesce(nullif(item->>'quantity_kg','')::numeric,nullif(item->>'kg','')::numeric),coalesce(nullif(item->>'unit_sale_price','')::numeric,nullif(item->>'sellPrice','')::numeric,0),item_time,
      nullif(coalesce(item->>'notes',item->>'note',''),''),upper(coalesce(item->>'vehicle_plate',item->>'plate','')),case when coalesce(item->>'status','active')='cancelled' then 'cancelled' else 'active' end,
      coalesce(item->>'driver_name',item->>'driver',''),coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now()));
    added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('sales',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'giderler';
  added_count:=0; skipped_count:=0; source_rows:=coalesce(payload#>'{tables,expenses}',payload->'expenses','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); item_time:=private.gurminik_backup_time(coalesce(item->>'transaction_at',item->>'dateTime',item->>'date_time'));
    if (source_id~*uuid_pattern and exists(select 1 from public.expenses where owner_id=uid and id=source_id::uuid)) or exists(select 1 from public.expenses where owner_id=uid and title=btrim(coalesce(item->>'title','')) and category=coalesce(nullif(btrim(item->>'category'),''),'Diğer') and amount=nullif(item->>'amount','')::numeric and transaction_at=item_time)
    then skipped_count:=skipped_count+1; continue; end if;
    candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.expenses where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    insert into public.expenses(id,owner_id,title,category,amount,transaction_at,created_at) values(candidate_id,uid,btrim(item->>'title'),coalesce(nullif(btrim(item->>'category'),''),'Diğer'),nullif(item->>'amount','')::numeric,item_time,coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now())); added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('expenses',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'cari hesap';
  added_count:=0; skipped_count:=0; source_rows:=coalesce(payload#>'{tables,accountPayments}',payload->'accountPayments','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); item_time:=private.gurminik_backup_time(coalesce(item->>'payment_at',item->>'dateTime'));
    if (source_id~*uuid_pattern and exists(select 1 from public.account_payments where owner_id=uid and id=source_id::uuid)) or exists(select 1 from public.account_payments where owner_id=uid and company_name=btrim(coalesce(item->>'company_name',item->>'company','')) and amount=nullif(item->>'amount','')::numeric and payment_at=item_time)
    then skipped_count:=skipped_count+1; continue; end if;
    candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.account_payments where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    insert into public.account_payments(id,owner_id,company_name,payment_at,amount,description,payment_method,created_at) values(candidate_id,uid,btrim(coalesce(item->>'company_name',item->>'company')),item_time,nullif(item->>'amount','')::numeric,nullif(coalesce(item->>'description',''),''),nullif(coalesce(item->>'payment_method',item->>'method',''),''),coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now())); added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('accountPayments',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'favoriler';
  added_count:=0; skipped_count:=0; source_rows:=coalesce(payload#>'{tables,favorites}',payload->'favorites','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    item_name:=btrim(coalesce(item->>'person_name',item->>'person',''));
    if item_name='' or exists(select 1 from public.favorites where owner_id=uid and lower(btrim(person_name))=lower(item_name)) then skipped_count:=skipped_count+1; continue; end if;
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.favorites where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    resolved_product:=null; select new_id into resolved_product from gurminik_restore_product_map where old_id=coalesce(item->>'last_product_id',item->>'lastProductId','');
    if resolved_product is null and coalesce(item->>'product_name','')<>'' then select id into resolved_product from public.products where owner_id=uid and lower(name)=lower(item->>'product_name') limit 1; end if;
    insert into public.favorites(id,owner_id,person_name,phone,vehicle_plate,last_product_id,last_buy_price,notes,created_at) values(candidate_id,uid,item_name,nullif(btrim(coalesce(item->>'phone','')),''),nullif(upper(btrim(coalesce(item->>'vehicle_plate',item->>'plate',''))),''),resolved_product,nullif(coalesce(item->>'last_buy_price',item->>'lastBuyPrice',''),'')::numeric,nullif(coalesce(item->>'notes',''),''),coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now())); added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('favorites',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'Soğuk Hava gider kategorileri';
  added_count:=0; skipped_count:=0; source_rows:=coalesce(payload#>'{coldStorage,expenseCategories}',payload#>'{coldStorage,categories}','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    item_name:=btrim(coalesce(item->>'name',item#>>'{}',''));
    if item_name='' or exists(select 1 from public.cold_storage_expense_categories where owner_id=uid and lower(btrim(name))=lower(item_name)) then skipped_count:=skipped_count+1; continue; end if;
    source_id:=coalesce(item->>'id',''); candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.cold_storage_expense_categories where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    insert into public.cold_storage_expense_categories(id,owner_id,name,created_at) values(candidate_id,uid,item_name,coalesce(nullif(item->>'created_at','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now())); added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('coldExpenseCategories',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'Soğuk Hava alışları';
  added_count:=0; skipped_count:=0; source_rows:=coalesce(payload#>'{coldStorage,purchases}','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); item_time:=private.gurminik_backup_time(coalesce(item->>'transaction_at',item->>'dateTime'));
    if (source_id~*uuid_pattern and exists(select 1 from public.cold_storage_purchases where owner_id=uid and id=source_id::uuid)) or exists(select 1 from public.cold_storage_purchases where owner_id=uid and lower(product_name)=lower(coalesce(item->>'product_name',item->>'product','')) and supplier_name=coalesce(item->>'supplier_name',item->>'person','') and quantity_kg=coalesce(nullif(item->>'quantity_kg','')::numeric,nullif(item->>'kg','')::numeric) and unit_buy_price=coalesce(nullif(item->>'unit_buy_price','')::numeric,nullif(item->>'price','')::numeric) and transaction_at=item_time) then skipped_count:=skipped_count+1; continue; end if;
    candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.cold_storage_purchases where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    insert into public.cold_storage_purchases(id,owner_id,product_name,supplier_name,vehicle_plate,quantity_kg,unit_buy_price,transaction_at,notes,status,created_at) values(candidate_id,uid,btrim(coalesce(item->>'product_name',item->>'product')),btrim(coalesce(item->>'supplier_name',item->>'person')),upper(coalesce(item->>'vehicle_plate',item->>'plate','')),coalesce(nullif(item->>'quantity_kg','')::numeric,nullif(item->>'kg','')::numeric),coalesce(nullif(item->>'unit_buy_price','')::numeric,nullif(item->>'price','')::numeric),item_time,coalesce(item->>'notes',item->>'note',''),case when coalesce(item->>'status','active')='cancelled' then 'cancelled' else 'active' end,coalesce(nullif(item->>'created_at','')::timestamptz,now())); added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('coldPurchases',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'Soğuk Hava satışları';
  added_count:=0; skipped_count:=0; source_rows:=coalesce(payload#>'{coldStorage,sales}','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); item_time:=private.gurminik_backup_time(coalesce(item->>'transaction_at',item->>'dateTime'));
    if (source_id~*uuid_pattern and exists(select 1 from public.cold_storage_sales where owner_id=uid and id=source_id::uuid)) or exists(select 1 from public.cold_storage_sales where owner_id=uid and lower(product_name)=lower(coalesce(item->>'product_name',item->>'product','')) and buyer_name=coalesce(item->>'buyer_name',item->>'buyer','') and quantity_kg=coalesce(nullif(item->>'quantity_kg','')::numeric,nullif(item->>'kg','')::numeric) and unit_sale_price=coalesce(nullif(item->>'unit_sale_price','')::numeric,nullif(item->>'price','')::numeric) and transaction_at=item_time) then skipped_count:=skipped_count+1; continue; end if;
    candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.cold_storage_sales where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    insert into public.cold_storage_sales(id,owner_id,product_name,buyer_name,quantity_kg,unit_sale_price,transaction_at,notes,status,created_at) values(candidate_id,uid,btrim(coalesce(item->>'product_name',item->>'product')),btrim(coalesce(item->>'buyer_name',item->>'buyer')),coalesce(nullif(item->>'quantity_kg','')::numeric,nullif(item->>'kg','')::numeric),coalesce(nullif(item->>'unit_sale_price','')::numeric,nullif(item->>'price','')::numeric),item_time,coalesce(item->>'notes',item->>'note',''),case when coalesce(item->>'status','active')='cancelled' then 'cancelled' else 'active' end,coalesce(nullif(item->>'created_at','')::timestamptz,now())); added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('coldSales',jsonb_build_object('added',added_count,'skipped',skipped_count));

  section_name := 'Soğuk Hava giderleri ve Fire';
  added_count:=0; skipped_count:=0; source_rows:=coalesce(payload#>'{coldStorage,expenses}','[]'::jsonb);
  for item in select value from jsonb_array_elements(source_rows) loop
    source_id:=coalesce(item->>'id',gen_random_uuid()::text); item_time:=private.gurminik_backup_time(coalesce(item->>'transaction_at',item->>'dateTime'));
    if (source_id~*uuid_pattern and exists(select 1 from public.cold_storage_expenses where owner_id=uid and id=source_id::uuid)) or exists(select 1 from public.cold_storage_expenses where owner_id=uid and title=coalesce(item->>'title','') and category=coalesce(item->>'category','') and amount=coalesce(nullif(item->>'amount','')::numeric,0) and transaction_at=item_time and coalesce(loss_kg,0)=coalesce(nullif(coalesce(item->>'loss_kg',item->>'lossKg',''),'')::numeric,0)) then skipped_count:=skipped_count+1; continue; end if;
    candidate_id:=case when source_id~*uuid_pattern then source_id::uuid else gen_random_uuid() end; if exists(select 1 from public.cold_storage_expenses where id=candidate_id) then candidate_id:=gen_random_uuid(); end if;
    insert into public.cold_storage_expenses(id,owner_id,title,category,amount,product_name,loss_kg,transaction_at,notes,created_at) values(candidate_id,uid,btrim(coalesce(nullif(item->>'title',''),'Gider')),btrim(coalesce(nullif(item->>'category',''),'Diğer')),coalesce(nullif(item->>'amount','')::numeric,0),nullif(btrim(coalesce(item->>'product_name',item->>'product','')),''),nullif(coalesce(item->>'loss_kg',item->>'lossKg',''),'')::numeric,item_time,coalesce(item->>'notes',item->>'note',''),coalesce(nullif(item->>'created_at','')::timestamptz,now())); added_count:=added_count+1;
  end loop;
  report:=report||jsonb_build_object('coldExpenses',jsonb_build_object('added',added_count,'skipped',skipped_count));

  return jsonb_build_object('success',true,'mode',restore_mode,'sections',report);
exception when others then
  raise exception 'Geri yükleme başarısız (%): %', section_name, sqlerrm;
end;
$$;

revoke all on function public.restore_gurminik_backup_v2(jsonb,text) from public, anon;
grant execute on function public.restore_gurminik_backup_v2(jsonb,text) to authenticated;

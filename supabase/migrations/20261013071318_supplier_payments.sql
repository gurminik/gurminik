-- Existing is_paid values are deliberately untouched. No backfill or purchase deletion.
alter table public.purchases alter column is_paid set default false;
alter table public.user_permissions drop constraint user_permissions_module_check;
alter table public.user_permissions add constraint user_permissions_module_check check (
  module = any(array['dashboard','purchases','sales','ranking','expenses','contacts','accounts',
    'favorites','cold_storage','crates','reports','backup','activity_logs','payments']::text[])
);

-- This application has one existing shared business (profiles), not arbitrary auth users.
-- Keep its shared normal / own mobile-worker scope. No anonymous access is introduced.
create or replace function private.can_view_gurminik_payment(p_owner uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and private.has_gurminik_permission('payments','view')
    and exists(select 1 from public.profiles p where p.id=p_owner)
    and (not private.is_gurminik_mobile_worker() or p_owner=auth.uid())
$$;
revoke all on function private.can_view_gurminik_payment(uuid) from public, anon;
grant execute on function private.can_view_gurminik_payment(uuid) to authenticated;

create policy purchases_payments_select on public.purchases
for select to authenticated using (private.can_view_gurminik_payment(owner_id));

CREATE OR REPLACE FUNCTION private.can_access_gurminik_table(requested_table text, requested_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  allowed_modules text[];
  item text;
  mobile_worker boolean := private.is_gurminik_mobile_worker();
begin
  if private.is_gurminik_full_access() then return true; end if;

  if mobile_worker then
    allowed_modules := case requested_table
      when 'products' then
        case when requested_action = 'view'
          then array['purchases','sales','favorites','ranking','payments'] else array[]::text[] end
      when 'purchases' then array['purchases']
      when 'sales' then array['sales']
      when 'expenses' then array['expenses']
      when 'expense_categories' then array['expenses']
      when 'contacts' then array['contacts']
      when 'contact_categories' then array['contacts']
      when 'favorites' then array['favorites']
      else array[]::text[]
    end;
  else
    allowed_modules := case requested_table
      when 'products' then case when requested_action = 'view' then array['dashboard','purchases','sales','ranking','favorites','reports','backup','payments'] else array['dashboard','backup'] end
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
  end if;

  foreach item in array allowed_modules loop
    if private.has_gurminik_permission(item, requested_action) then return true; end if;
    if mobile_worker and requested_action = 'view'
       and private.has_gurminik_permission(item, 'create') then return true; end if;
  end loop;
  return false;
end;
$function$;

create index purchases_payment_active_date_idx
on public.purchases(is_paid,transaction_at desc,id desc) where status='active';

create or replace function private.gurminik_payment_search_key(p_text text)
returns text language sql immutable set search_path='' as $$
  select lower(translate(regexp_replace(btrim(coalesce(p_text,'')),'\s+',' ','g'),'Iİ','ıi'))
$$;
revoke all on function private.gurminik_payment_search_key(text) from public, anon;
grant execute on function private.gurminik_payment_search_key(text) to authenticated;

-- RLS applies to the read RPC. One snapshot / filtered set serves BOTH summary and page.
create or replace function public.get_gurminik_payments_page(
  p_search text default '', p_start timestamptz default null, p_end timestamptz default null,
  p_status text default 'all', p_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; search_key text := private.gurminik_payment_search_key(p_search);
begin
  if auth.uid() is null or not private.has_gurminik_permission('payments','view') then
    raise exception 'Ödemeler görüntüleme yetkiniz yok.' using errcode='42501';
  end if;
  if p_status is null or p_status not in ('all','paid','unpaid') then
    raise exception 'Geçersiz ödeme filtresi.' using errcode='22023';
  end if;
  if length(coalesce(p_search,'')) > 200 then
    raise exception 'Arama metni çok uzun.' using errcode='22023';
  end if;
  with filtered as materialized (
    select r.id,r.supplier_name,p.name as product_name,r.vehicle_plate,r.quantity_kg,
      r.unit_buy_price,r.total_buy_amount,r.transaction_at,r.is_paid,
      coalesce('contact:'||r.supplier_contact_id::text,
        'name:'||private.gurminik_payment_search_key(r.supplier_name)) as person_key
    from public.purchases r join public.products p on p.id=r.product_id
    where r.status='active'
      and private.can_view_gurminik_payment(r.owner_id)
      and (p_start is null or r.transaction_at>=p_start)
      and (p_end is null or r.transaction_at<p_end)
      and (p_status='all' or r.is_paid=(p_status='paid'))
      and (search_key='' or
        strpos(private.gurminik_payment_search_key(r.supplier_name),search_key)>0 or
        strpos(private.gurminik_payment_search_key(p.name),search_key)>0 or
        strpos(replace(private.gurminik_payment_search_key(r.vehicle_plate),' ',''),
          replace(search_key,' ',''))>0)
  ), summary as (
    select count(*) as n,
      jsonb_build_object('people',count(distinct person_key),'kg',coalesce(sum(quantity_kg),0),
        'amount',coalesce(sum(total_buy_amount),0)) as total,
      jsonb_build_object('people',count(distinct person_key) filter(where is_paid),
        'kg',coalesce(sum(quantity_kg) filter(where is_paid),0),
        'amount',coalesce(sum(total_buy_amount) filter(where is_paid),0)) as paid,
      jsonb_build_object('people',count(distinct person_key) filter(where not is_paid),
        'kg',coalesce(sum(quantity_kg) filter(where not is_paid),0),
        'amount',coalesce(sum(total_buy_amount) filter(where not is_paid),0)) as unpaid
    from filtered
  ), paging as (
    select s.*,least(greatest(coalesce(p_page,1),1),greatest(1,ceil(n/10.0)::integer)) as page
    from summary s
  )
  select jsonb_build_object('count',n,'page',page,'total',total,'paid',paid,'unpaid',unpaid,
    'rows',coalesce((select jsonb_agg(to_jsonb(t)-'person_key' order by t.transaction_at desc,t.id desc)
      from (select * from filtered order by transaction_at desc,id desc
        limit 10 offset ((paging.page-1)*10)) t),'[]'::jsonb))
  into result from paging;
  return result;
end $$;
revoke all on function public.get_gurminik_payments_page(text,timestamptz,timestamptz,text,integer) from public, anon;
grant execute on function public.get_gurminik_payments_page(text,timestamptz,timestamptz,text,integer) to authenticated;

create or replace function public.get_gurminik_payment_detail(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.has_gurminik_permission('payments','view') then
    raise exception 'Ödemeler görüntüleme yetkiniz yok.' using errcode='42501';
  end if;
  select jsonb_build_object('id',r.id,'supplier_name',r.supplier_name,'product_name',p.name,
    'vehicle_plate',r.vehicle_plate,'quantity_kg',r.quantity_kg,'unit_buy_price',r.unit_buy_price,
    'total_buy_amount',r.total_buy_amount,'transaction_at',r.transaction_at,'is_paid',r.is_paid)
  into result from public.purchases r join public.products p on p.id=r.product_id
  where r.id=p_id and r.status='active' and private.can_view_gurminik_payment(r.owner_id);
  return result;
end $$;
revoke all on function public.get_gurminik_payment_detail(uuid) from public, anon;
grant execute on function public.get_gurminik_payment_detail(uuid) to authenticated;

-- Only payment status can be written by the payment-only RPC; never kg, price or owner.
create or replace function private.set_gurminik_purchase_payment(p_id uuid,p_paid boolean,p_expected_paid boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare record public.purchases%rowtype;
begin
  if auth.uid() is null or not private.has_gurminik_permission('payments','update') then
    raise exception 'Ödeme durumunu değiştirme yetkiniz yok.' using errcode='42501';
  end if;
  if p_paid is null or p_expected_paid is null then
    raise exception 'Ödeme durumu gerekli.' using errcode='22023';
  end if;
  select * into record from public.purchases where id=p_id for update;
  if not found or record.status<>'active' or not private.can_view_gurminik_payment(record.owner_id) then
    raise exception 'Alış kaydı bulunamadı veya erişiminiz yok.' using errcode='42501';
  end if;
  if record.is_paid is not distinct from p_paid then return true; end if;
  if record.is_paid is distinct from p_expected_paid then
    raise exception 'Ödeme durumu başka bir kullanıcı tarafından değiştirildi. Listeyi yenileyin.' using errcode='40001';
  end if;
  update public.purchases set is_paid=p_paid,updated_at=now() where id=p_id;
  return true;
end $$;
revoke all on function private.set_gurminik_purchase_payment(uuid,boolean,boolean) from public, anon;
grant execute on function private.set_gurminik_purchase_payment(uuid,boolean,boolean) to authenticated;
create or replace function public.set_gurminik_purchase_payment(p_id uuid,p_paid boolean,p_expected_paid boolean)
returns boolean language sql security invoker set search_path='' as $$
  select private.set_gurminik_purchase_payment(p_id,p_paid,p_expected_paid)
$$;
revoke all on function public.set_gurminik_purchase_payment(uuid,boolean,boolean) from public, anon;
grant execute on function public.set_gurminik_purchase_payment(uuid,boolean,boolean) to authenticated;

-- Prevent bypass through the existing general purchase UPDATE path.
create or replace function private.guard_gurminik_payment_update()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and old.is_paid is distinct from new.is_paid
    and not private.has_gurminik_permission('payments','update')
    and not (private.has_gurminik_permission('backup','create') and
      current_setting('gurminik.audit_disabled',true)='on') then
    raise exception 'Ödeme durumunu değiştirme yetkiniz yok.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_gurminik_payment_update() from public, anon, authenticated;
create trigger gurminik_payment_update_guard before update of is_paid on public.purchases
for each row execute function private.guard_gurminik_payment_update();

CREATE OR REPLACE FUNCTION public.admin_set_gurminik_user_access_v2(target_user_id uuid, active boolean, permission_set jsonb, mobile_enabled boolean, full_enabled boolean, activity_all boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  item text;
  value jsonb;
  target_label text;
begin
  perform private.require_gurminik_admin_verification();
  if not exists(select 1 from public.profiles where id=target_user_id) then
    raise exception 'Kullanıcı bulunamadı';
  end if;
  if exists(select 1 from public.profiles where id=target_user_id and role='admin') then
    raise exception 'Yönetici hesabının yetkileri değiştirilemez' using errcode='42501';
  end if;

  update public.profiles
  set is_active=active,
      mobile_mode=coalesce(mobile_enabled,false) and not coalesce(full_enabled,false),
      full_access=coalesce(full_enabled,false),
      activity_scope_all=coalesce(activity_all,false),
      updated_at=now()
  where id=target_user_id;

  foreach item in array array[
    'dashboard','purchases','sales','ranking','expenses','contacts','accounts',
    'favorites','reports','backup','cold_storage','activity_logs','payments'
  ] loop
    value:=coalesce(permission_set->item,'{}'::jsonb);
    insert into public.user_permissions(
      user_id,module,can_view,can_create,can_update,can_delete,updated_at
    ) values (
      target_user_id,item,
      coalesce((value->>'can_view')::boolean,false),
      coalesce((value->>'can_create')::boolean,false),
      coalesce((value->>'can_update')::boolean,false),
      coalesce((value->>'can_delete')::boolean,false),now()
    )
    on conflict(user_id,module) do update set
      can_view=excluded.can_view,can_create=excluded.can_create,
      can_update=excluded.can_update,can_delete=excluded.can_delete,
      updated_at=now();
  end loop;

  select coalesce(display_name,email,target_user_id::text)
    into target_label from public.profiles where id=target_user_id;
  perform private.write_gurminik_activity(
    'activity_logs','permission','profile',target_user_id::text,target_label,
    null,null,null,
    private.gurminik_actor_name(auth.uid())||' · '||target_label||' kullanıcısının yetkilerini ve kullanım modunu değiştirdi.',
    jsonb_build_object(
      'active',active,'mobile_mode',mobile_enabled and not full_enabled,
      'full_access',full_enabled,'activity_scope_all',activity_all,
      'permissions',permission_set
    )
  );
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION private.gurminik_audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if tg_table_name = 'purchases' then
    if tg_op = 'INSERT' then
      verb_label := verb_label || ' · Ödeme durumu: ' || case when new.is_paid then 'Ödendi' else 'Ödenmedi' end;
      detail := detail || jsonb_build_object('is_paid',new.is_paid);
    elsif tg_op = 'UPDATE' and old.is_paid is distinct from new.is_paid then
      if (to_jsonb(old)-'is_paid'-'updated_at') = (to_jsonb(new)-'is_paid'-'updated_at') then
        module_name := 'payments'; module_label := 'Ödeme durumu';
        detail := jsonb_build_object('old_is_paid',old.is_paid,'new_is_paid',new.is_paid);
      end if;
      verb_label := 'Ödeme durumunu ' || case when old.is_paid then 'Ödendi' else 'Ödenmedi' end ||
        ' → ' || case when new.is_paid then 'Ödendi' else 'Ödenmedi' end || ' olarak değiştirdi';
    end if;
  end if;
  perform private.write_gurminik_activity(
    module_name, action_name, entity_name, row_data->>'id', person_value,
    product_value, quantity_value, amount_value,
    case
      when module_name='payments' then actor_label || ' · ' || coalesce(person_value,'') || ' kişisine ait ' ||
        coalesce(product_value,'') || ' alışının ödeme durumunu ' || case when old.is_paid then 'Ödendi' else 'Ödenmedi' end ||
        ' → ' || case when new.is_paid then 'Ödendi' else 'Ödenmedi' end || ' olarak değiştirdi.'
      when tg_table_name='purchases' and tg_op='INSERT' then actor_label || ' · ' || coalesce(person_value,'') ||
        ' kişisinden ' || coalesce(quantity_value::text,'') || ' kg ' || coalesce(product_value,'') ||
        ' alış kaydı oluşturdu. Ödeme durumu: ' || case when new.is_paid then 'Ödendi' else 'Ödenmedi' end || '.'
      else actor_label || ' · ' || module_label || ' kaydını ' || verb_label || '.'
    end, detail
  );
  return coalesce(new, old);
end;
$function$;



create or replace function private.sync_purchase_crates() returns trigger language plpgsql security definer set search_path = '' as $$
declare old_quantity integer:=0; new_quantity integer:=0; account public.crate_accounts%rowtype;
begin
  -- Payment-only updates never change the crate ledger or require crate permission.
  if tg_op='UPDATE' and old.is_paid is distinct from new.is_paid
    and (to_jsonb(old)-'is_paid'-'updated_at') = (to_jsonb(new)-'is_paid'-'updated_at') then
    return new;
  end if;
  if tg_op <> 'INSERT' and old.status <> 'cancelled' then old_quantity:=old.returned_crates; end if;
  if tg_op <> 'DELETE' and new.status <> 'cancelled' then new_quantity:=new.returned_crates; end if;
  if old_quantity=0 and new_quantity=0 then return coalesce(new,old); end if;
  if auth.uid() is not null and not private.has_gurminik_permission('crates','update')
     and not private.has_gurminik_permission('crates','create') then
    raise exception 'Kasa iadesi için Kasa yetkisi gerekli.' using errcode='42501';
  end if;
  if old_quantity>0 and (new_quantity=0 or old.crate_account_id is distinct from new.crate_account_id) then
    perform private.apply_crate_movement(old.crate_account_id,old_quantity,'purchase_reversal',gen_random_uuid(),old.id);
    old_quantity:=0;
  end if;
  if new_quantity>0 then
    select * into account from public.crate_accounts where id=new.crate_account_id and business_id=private.gurminik_business_id();
    if not found or lower(btrim(account.person_name)) <> lower(btrim(new.supplier_name)) then
      raise exception 'Alış kişisi ile kasa hesabı eşleşmiyor.' using errcode='22023';
    end if;
    if new_quantity <> old_quantity then
      perform private.apply_crate_movement(new.crate_account_id,old_quantity-new_quantity,
        case when old_quantity=0 then 'purchase_return' else 'purchase_adjustment' end,gen_random_uuid(),new.id);
    end if;
  end if;
  return coalesce(new,old);
end;
$$;

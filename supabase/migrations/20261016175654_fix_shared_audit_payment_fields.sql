-- Shared audit triggers also run on tables without is_paid.
-- Read payment keys from the existing JSON row snapshots, never the generic NEW/OLD records.
-- No business data, table structure or permissions are changed.
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
      verb_label := verb_label || ' · Ödeme durumu: ' || case when (row_data->>'is_paid')::boolean then 'Ödendi' else 'Ödenmedi' end;
      detail := detail || jsonb_build_object('is_paid',(row_data->>'is_paid')::boolean);
    elsif tg_op = 'UPDATE' and (old_data->>'is_paid')::boolean is distinct from (row_data->>'is_paid')::boolean then
      if (to_jsonb(old)-'is_paid'-'updated_at') = (to_jsonb(new)-'is_paid'-'updated_at') then
        module_name := 'payments'; module_label := 'Ödeme durumu';
        detail := jsonb_build_object('old_is_paid',(old_data->>'is_paid')::boolean,'new_is_paid',(row_data->>'is_paid')::boolean);
      end if;
      verb_label := 'Ödeme durumunu ' || case when (old_data->>'is_paid')::boolean then 'Ödendi' else 'Ödenmedi' end ||
        ' → ' || case when (row_data->>'is_paid')::boolean then 'Ödendi' else 'Ödenmedi' end || ' olarak değiştirdi';
    end if;
  end if;
  perform private.write_gurminik_activity(
    module_name, action_name, entity_name, row_data->>'id', person_value,
    product_value, quantity_value, amount_value,
    case
      when module_name='payments' then actor_label || ' · ' || coalesce(person_value,'') || ' kişisine ait ' ||
        coalesce(product_value,'') || ' alışının ödeme durumunu ' || case when (old_data->>'is_paid')::boolean then 'Ödendi' else 'Ödenmedi' end ||
        ' → ' || case when (row_data->>'is_paid')::boolean then 'Ödendi' else 'Ödenmedi' end || ' olarak değiştirdi.'
      when tg_table_name='purchases' and tg_op='INSERT' then actor_label || ' · ' || coalesce(person_value,'') ||
        ' kişisinden ' || coalesce(quantity_value::text,'') || ' kg ' || coalesce(product_value,'') ||
        ' alış kaydı oluşturdu. Ödeme durumu: ' || case when (row_data->>'is_paid')::boolean then 'Ödendi' else 'Ödenmedi' end || '.'
      else actor_label || ' · ' || module_label || ' kaydını ' || verb_label || '.'
    end, detail
  );
  return coalesce(new, old);
end;
$function$;


-- Existing purchases and inserts from older clients are considered paid.
-- Authorization and ownership policies remain unchanged.
alter table public.purchases
  add column if not exists is_paid boolean not null default true;

-- Preserve payment status when restoring JSON backups made by the updated app.
-- Older backups have no isPaid key and retain the paid default.
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
      insert into public.purchases (owner_id, product_id, supplier_name, vehicle_plate, quantity_kg, unit_buy_price, transaction_at, status, created_at, is_paid)
      values (
        uid, product_id, trim(coalesce(item->>'person', item->>'supplier_name')),
        upper(trim(coalesce(item->>'plate', item->>'vehicle_plate'))),
        coalesce(item->>'kg', item->>'quantity_kg')::numeric,
        coalesce(item->>'buyPrice', item->>'unit_buy_price')::numeric,
        case when coalesce(item->>'dateTime', item->>'transaction_at') ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
          then coalesce(item->>'dateTime', item->>'transaction_at')::timestamptz
          else coalesce(item->>'dateTime', item->>'transaction_at')::timestamp at time zone 'Europe/Istanbul' end,
        case when coalesce(item->>'status','active') = 'cancelled' then 'cancelled' else 'active' end,
        coalesce((item->>'createdAt')::timestamptz, now()),
        case when jsonb_typeof(coalesce(item->'isPaid', item->'is_paid')) = 'boolean'
          then (coalesce(item->>'isPaid', item->>'is_paid'))::boolean
          else true end
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

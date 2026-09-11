alter table public.sales add column if not exists vehicle_plate text not null default '';
alter table public.sales add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.sales'::regclass and conname = 'sales_status_check'
  ) then
    alter table public.sales add constraint sales_status_check check (status in ('active','cancelled'));
  end if;
end;
$$;

create or replace function public.import_gurminik_sales_backup(payload jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  resolved_product uuid;
  sale_id uuid;
  inserted_count integer := 0;
begin
  if uid is null then raise exception 'Oturum gerekli'; end if;

  for item in select value from jsonb_array_elements(coalesce(payload->'sales', '[]'::jsonb))
  loop
    resolved_product := null;
    if coalesce(item->>'productId', item->>'product_id', '') ~* '^[0-9a-f-]{36}$' then
      select id into resolved_product from public.products
      where owner_id = uid and id = coalesce(item->>'productId', item->>'product_id')::uuid limit 1;
    end if;
    if resolved_product is null and coalesce(item->>'productName', '') <> '' then
      select id into resolved_product from public.products
      where owner_id = uid and lower(name) = lower(item->>'productName') limit 1;
    end if;
    if resolved_product is null then continue; end if;

    sale_id := case when coalesce(item->>'id', '') ~* '^[0-9a-f-]{36}$'
      then (item->>'id')::uuid else gen_random_uuid() end;
    insert into public.sales(id, owner_id, product_id, buyer_name, vehicle_plate, quantity_kg, unit_sale_price, transaction_at, status)
    values (
      sale_id, uid, resolved_product,
      coalesce(nullif(item->>'buyer', ''), nullif(item->>'buyer_name', ''), 'Alıcı'),
      upper(coalesce(item->>'plate', item->>'vehicle_plate', '')),
      greatest(coalesce(nullif(item->>'kg', '')::numeric, nullif(item->>'quantity_kg', '')::numeric, 0.01), 0.01),
      greatest(coalesce(nullif(item->>'sellPrice', '')::numeric, nullif(item->>'unit_sale_price', '')::numeric, 0), 0),
      coalesce(nullif(item->>'dateTime', '')::timestamptz, nullif(item->>'transaction_at', '')::timestamptz, now()),
      case when coalesce(item->>'status', 'active') = 'cancelled' then 'cancelled' else 'active' end
    ) on conflict (id) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.import_gurminik_sales_backup(jsonb) from public, anon;
grant execute on function public.import_gurminik_sales_backup(jsonb) to authenticated;

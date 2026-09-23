-- Sade mobil çalışanlar için finansal alan içermeyen Sıralamalar veri yüzeyi.
-- Doğrudan purchases SELECT politikası genişletilmez; böylece birim alış
-- fiyatı ve ödeme bilgisi mobil çalışanın API yanıtına girmez.

create or replace function private.can_access_gurminik_table(
  requested_table text,
  requested_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
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
          then array['purchases','sales','favorites','ranking'] else array[]::text[] end
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
  end if;

  foreach item in array allowed_modules loop
    if private.has_gurminik_permission(item, requested_action) then return true; end if;
    if mobile_worker and requested_action = 'view'
       and private.has_gurminik_permission(item, 'create') then return true; end if;
  end loop;
  return false;
end;
$$;

create or replace function public.get_mobile_ranking_rows()
returns table (
  id uuid,
  product_id uuid,
  supplier_name text,
  vehicle_plate text,
  quantity_kg numeric,
  transaction_at timestamptz,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not private.is_gurminik_mobile_worker()
     or not private.has_gurminik_permission('ranking', 'view') then
    raise exception 'Sıralamalar erişimi reddedildi.' using errcode = '42501';
  end if;

  return query
  select p.id, p.product_id, p.supplier_name, p.vehicle_plate,
         p.quantity_kg, p.transaction_at, p.status, p.created_at
  from public.purchases p
  where coalesce(p.status, 'active') <> 'cancelled'
  order by p.transaction_at desc, p.id;
end;
$$;

revoke all on function public.get_mobile_ranking_rows() from public, anon;
grant execute on function public.get_mobile_ranking_rows() to authenticated;

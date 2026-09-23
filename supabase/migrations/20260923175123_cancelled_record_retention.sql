-- Seven-day grace period for records that support Cancel / Restore.
-- The database clock is authoritative; clients never choose cancelled_at.

create extension if not exists pg_cron;

alter table public.purchases add column if not exists cancelled_at timestamptz;
alter table public.sales add column if not exists cancelled_at timestamptz;
alter table public.cold_storage_purchases add column if not exists cancelled_at timestamptz;
alter table public.cold_storage_sales add column if not exists cancelled_at timestamptz;

-- Existing cancelled records receive a fresh seven-day grace period instead of
-- being unexpectedly deleted as soon as this migration is installed.
update public.purchases set cancelled_at = clock_timestamp()
where status = 'cancelled' and cancelled_at is null;
update public.sales set cancelled_at = clock_timestamp()
where status = 'cancelled' and cancelled_at is null;
update public.cold_storage_purchases set cancelled_at = clock_timestamp()
where status = 'cancelled' and cancelled_at is null;
update public.cold_storage_sales set cancelled_at = clock_timestamp()
where status = 'cancelled' and cancelled_at is null;

create or replace function private.set_gurminik_cancelled_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'cancelled' then
    if tg_op = 'INSERT' then
      new.cancelled_at := clock_timestamp();
    elsif old.status is distinct from 'cancelled' or old.cancelled_at is null then
      new.cancelled_at := clock_timestamp();
    else
      -- Do not let a browser extend or shorten an already running grace period.
      new.cancelled_at := old.cancelled_at;
    end if;
  else
    if tg_op = 'UPDATE'
       and old.status = 'cancelled'
       and old.cancelled_at <= clock_timestamp() - interval '7 days' then
      raise exception using
        errcode = 'P0001',
        message = 'GURMINIK_CANCELLATION_EXPIRED',
        detail = 'Yedi günlük geri alma süresi dolmuştur.';
    end if;
    new.cancelled_at := null;
  end if;
  return new;
end;
$$;

create or replace function private.reject_purged_gurminik_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A deliberate JSON restore runs with audit_disabled=on and is allowed to
  -- restore a historical row. Normal offline replays are rejected forever by
  -- the compact auto_delete activity record.
  if coalesce(current_setting('gurminik.audit_disabled', true), 'off') <> 'on'
     and exists (
       select 1
       from public.activity_logs l
       where l.entity_type = tg_table_name
         and l.entity_id = new.id::text
         and l.action_type = 'auto_delete'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'GURMINIK_PURGED_RECORD',
      detail = 'Bu kayıt yedi günlük iptal süresi sonunda kalıcı olarak silinmiştir.';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_purged_gurminik_record() from public, anon, authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['purchases','sales','cold_storage_purchases','cold_storage_sales'] loop
    execute format('drop trigger if exists gurminik_cancelled_at_guard on public.%I', table_name);
    execute format(
      'create trigger gurminik_cancelled_at_guard before insert or update of status, cancelled_at on public.%I for each row execute function private.set_gurminik_cancelled_at()',
      table_name
    );
    execute format('drop trigger if exists gurminik_purged_insert_guard on public.%I', table_name);
    execute format(
      'create trigger gurminik_purged_insert_guard before insert on public.%I for each row execute function private.reject_purged_gurminik_record()',
      table_name
    );
  end loop;
end;
$$;

create index if not exists purchases_cancelled_at_idx
  on public.purchases(cancelled_at) where status = 'cancelled';
create index if not exists sales_cancelled_at_idx
  on public.sales(cancelled_at) where status = 'cancelled';
create index if not exists cold_storage_purchases_cancelled_at_idx
  on public.cold_storage_purchases(cancelled_at) where status = 'cancelled';
create index if not exists cold_storage_sales_cancelled_at_idx
  on public.cold_storage_sales(cancelled_at) where status = 'cancelled';

create or replace function private.purge_expired_gurminik_cancellations(
  p_reference_time timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_uuid uuid := private.gurminik_business_id();
  purchase_count integer := 0;
  sale_count integer := 0;
  cold_purchase_count integer := 0;
  cold_sale_count integer := 0;
begin
  with expired as materialized (
    select r.id, r.owner_id, r.supplier_name as person_name, p.name as product_name,
      r.quantity_kg, r.total_buy_amount as amount, r.cancelled_at
    from public.purchases r
    left join public.products p on p.id = r.product_id
    where r.status = 'cancelled'
      and r.cancelled_at <= p_reference_time - interval '7 days'
  ), logged as (
    insert into public.activity_logs(
      business_id, actor_user_id, actor_name, module, action_type,
      entity_type, entity_id, person_name, product_name, quantity, amount,
      description, metadata
    )
    select business_uuid, null, 'Sistem', 'purchases', 'auto_delete',
      'purchases', id::text, person_name, product_name, quantity_kg, amount,
      'Sistem, 7 günlük iptal süresi dolan alış kaydını kalıcı olarak sildi.',
      jsonb_build_object('cancelled_at',cancelled_at,'retention_days',7)
    from expired
    returning 1
  ), removed as (
    delete from public.purchases r using expired e where r.id = e.id returning 1
  )
  select count(*) into purchase_count from removed;

  with expired as materialized (
    select r.id, r.owner_id, coalesce(r.buyer_name,'Alıcı') as person_name,
      p.name as product_name, r.quantity_kg, r.total_sale_amount as amount, r.cancelled_at
    from public.sales r
    left join public.products p on p.id = r.product_id
    where r.status = 'cancelled'
      and r.cancelled_at <= p_reference_time - interval '7 days'
  ), logged as (
    insert into public.activity_logs(
      business_id, actor_user_id, actor_name, module, action_type,
      entity_type, entity_id, person_name, product_name, quantity, amount,
      description, metadata
    )
    select business_uuid, null, 'Sistem', 'sales', 'auto_delete',
      'sales', id::text, person_name, product_name, quantity_kg, amount,
      'Sistem, 7 günlük iptal süresi dolan satış kaydını kalıcı olarak sildi.',
      jsonb_build_object('cancelled_at',cancelled_at,'retention_days',7)
    from expired
    returning 1
  ), removed as (
    delete from public.sales r using expired e where r.id = e.id returning 1
  )
  select count(*) into sale_count from removed;

  with expired as materialized (
    select id, owner_id, supplier_name as person_name, product_name,
      quantity_kg, quantity_kg * unit_buy_price as amount, cancelled_at
    from public.cold_storage_purchases
    where status = 'cancelled'
      and cancelled_at <= p_reference_time - interval '7 days'
  ), logged as (
    insert into public.activity_logs(
      business_id, actor_user_id, actor_name, module, action_type,
      entity_type, entity_id, person_name, product_name, quantity, amount,
      description, metadata
    )
    select business_uuid, null, 'Sistem', 'cold_storage', 'auto_delete',
      'cold_storage_purchases', id::text, person_name, product_name, quantity_kg, amount,
      'Sistem, 7 günlük iptal süresi dolan Soğuk Hava alış kaydını kalıcı olarak sildi.',
      jsonb_build_object('cancelled_at',cancelled_at,'retention_days',7)
    from expired
    returning 1
  ), removed as (
    delete from public.cold_storage_purchases r using expired e where r.id = e.id returning 1
  )
  select count(*) into cold_purchase_count from removed;

  with expired as materialized (
    select id, owner_id, buyer_name as person_name, product_name,
      quantity_kg, quantity_kg * unit_sale_price as amount, cancelled_at
    from public.cold_storage_sales
    where status = 'cancelled'
      and cancelled_at <= p_reference_time - interval '7 days'
  ), logged as (
    insert into public.activity_logs(
      business_id, actor_user_id, actor_name, module, action_type,
      entity_type, entity_id, person_name, product_name, quantity, amount,
      description, metadata
    )
    select business_uuid, null, 'Sistem', 'cold_storage', 'auto_delete',
      'cold_storage_sales', id::text, person_name, product_name, quantity_kg, amount,
      'Sistem, 7 günlük iptal süresi dolan Soğuk Hava satış kaydını kalıcı olarak sildi.',
      jsonb_build_object('cancelled_at',cancelled_at,'retention_days',7)
    from expired
    returning 1
  ), removed as (
    delete from public.cold_storage_sales r using expired e where r.id = e.id returning 1
  )
  select count(*) into cold_sale_count from removed;

  return jsonb_build_object(
    'purchases', purchase_count,
    'sales', sale_count,
    'coldPurchases', cold_purchase_count,
    'coldSales', cold_sale_count,
    'executedAt', p_reference_time
  );
end;
$$;

revoke all on function private.purge_expired_gurminik_cancellations(timestamptz)
  from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'gurminik-purge-cancelled-daily') then
    perform cron.schedule(
      'gurminik-purge-cancelled-daily',
      '17 2 * * *',
      'select private.purge_expired_gurminik_cancellations();'
    );
  end if;
end;
$$;

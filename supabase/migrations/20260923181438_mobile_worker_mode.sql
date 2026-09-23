-- User-level mobile worker mode. Existing users and permissions are preserved.
alter table public.profiles
  add column if not exists mobile_mode boolean not null default false,
  add column if not exists full_access boolean not null default false,
  add column if not exists activity_scope_all boolean not null default false;

create or replace function private.is_gurminik_full_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and (p.role = 'admin' or p.full_access)
  )
$$;

create or replace function private.is_gurminik_mobile_worker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role <> 'admin'
      and p.mobile_mode
      and not p.full_access
  )
$$;

create or replace function private.has_gurminik_permission(
  requested_module text,
  requested_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_gurminik_full_access() or exists (
    select 1
    from public.profiles p
    join public.user_permissions up on up.user_id = p.id
    where p.id = (select auth.uid())
      and p.is_active
      and up.module = requested_module
      and case requested_action
        when 'view' then up.can_view
        when 'create' then up.can_create
        when 'update' then up.can_update
        when 'delete' then up.can_delete
        else false
      end
  )
$$;

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
          then array['purchases','sales','favorites'] else array[]::text[] end
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
    -- A mobile worker needs safe reference data and their own recent rows to
    -- complete a form even when the module is create-only.
    if mobile_worker and requested_action = 'view'
       and private.has_gurminik_permission(item, 'create') then return true; end if;
  end loop;
  return false;
end;
$$;

-- Mobile workers may only read their own operational rows. INSERT/UPDATE/DELETE
-- continue to use the existing granular permission policies.
drop policy if exists purchases_authorized_select on public.purchases;
create policy purchases_authorized_select on public.purchases
for select to authenticated
using (
  (select private.can_access_gurminik_table('purchases','view'))
  and (
    not (select private.is_gurminik_mobile_worker())
    or owner_id = (select auth.uid())
  )
);
drop policy if exists purchases_authorized_update on public.purchases;
create policy purchases_authorized_update on public.purchases
for update to authenticated
using (
  (select private.can_access_gurminik_table('purchases','update'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
)
with check (
  (select private.can_access_gurminik_table('purchases','update'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
);
drop policy if exists purchases_authorized_delete on public.purchases;
create policy purchases_authorized_delete on public.purchases
for delete to authenticated
using (
  (select private.can_access_gurminik_table('purchases','delete'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
);

drop policy if exists sales_authorized_select on public.sales;
create policy sales_authorized_select on public.sales
for select to authenticated
using (
  (select private.can_access_gurminik_table('sales','view'))
  and (
    not (select private.is_gurminik_mobile_worker())
    or owner_id = (select auth.uid())
  )
);
drop policy if exists sales_authorized_update on public.sales;
create policy sales_authorized_update on public.sales
for update to authenticated
using (
  (select private.can_access_gurminik_table('sales','update'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
)
with check (
  (select private.can_access_gurminik_table('sales','update'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
);
drop policy if exists sales_authorized_delete on public.sales;
create policy sales_authorized_delete on public.sales
for delete to authenticated
using (
  (select private.can_access_gurminik_table('sales','delete'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
);

drop policy if exists expenses_authorized_select on public.expenses;
create policy expenses_authorized_select on public.expenses
for select to authenticated
using (
  (select private.can_access_gurminik_table('expenses','view'))
  and (
    not (select private.is_gurminik_mobile_worker())
    or owner_id = (select auth.uid())
  )
);
drop policy if exists expenses_authorized_update on public.expenses;
create policy expenses_authorized_update on public.expenses
for update to authenticated
using (
  (select private.can_access_gurminik_table('expenses','update'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
)
with check (
  (select private.can_access_gurminik_table('expenses','update'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
);
drop policy if exists expenses_authorized_delete on public.expenses;
create policy expenses_authorized_delete on public.expenses
for delete to authenticated
using (
  (select private.can_access_gurminik_table('expenses','delete'))
  and (not (select private.is_gurminik_mobile_worker()) or owner_id = (select auth.uid()))
);

drop policy if exists activity_logs_select_authorized on public.activity_logs;
create policy activity_logs_select_authorized on public.activity_logs
for select to authenticated
using (
  private.is_gurminik_full_access()
  or (
    private.has_gurminik_permission('activity_logs','view')
    and (
      not private.is_gurminik_mobile_worker()
      or actor_user_id = (select auth.uid())
      or exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and p.activity_scope_all
      )
    )
  )
);

create or replace function public.get_my_gurminik_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  result jsonb;
begin
  if uid is null then raise exception 'Oturum gerekli' using errcode='42501'; end if;
  select jsonb_build_object(
    'user_id', p.id,
    'email', p.email,
    'display_name', p.display_name,
    'role', p.role,
    'is_active', p.is_active,
    'mobile_mode', p.mobile_mode,
    'full_access', p.full_access,
    'activity_scope_all', p.activity_scope_all,
    'effective_mobile_mode', p.mobile_mode and p.role <> 'admin' and not p.full_access,
    'permissions', coalesce((
      select jsonb_object_agg(up.module, jsonb_build_object(
        'can_view', case when p.role='admin' or p.full_access then true else up.can_view end,
        'can_create', case when p.role='admin' or p.full_access then true else up.can_create end,
        'can_update', case when p.role='admin' or p.full_access then true else up.can_update end,
        'can_delete', case when p.role='admin' or p.full_access then true else up.can_delete end
      )) from public.user_permissions up where up.user_id=p.id
    ), '{}'::jsonb)
  ) into result
  from public.profiles p where p.id=uid;
  return coalesce(result, jsonb_build_object(
    'user_id',uid,'role','user','is_active',false,'mobile_mode',false,
    'full_access',false,'activity_scope_all',false,
    'effective_mobile_mode',false,'permissions','{}'::jsonb
  ));
end;
$$;

create or replace function public.admin_list_gurminik_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  perform private.require_gurminik_admin_verification();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'email', p.email, 'display_name', p.display_name,
    'role', p.role, 'is_active', p.is_active, 'created_at', p.created_at,
    'mobile_mode', p.mobile_mode, 'full_access', p.full_access,
    'activity_scope_all', p.activity_scope_all,
    'permissions', coalesce((select jsonb_object_agg(up.module, jsonb_build_object(
      'can_view', up.can_view, 'can_create', up.can_create,
      'can_update', up.can_update, 'can_delete', up.can_delete
    )) from public.user_permissions up where up.user_id=p.id), '{}'::jsonb)
  ) order by p.created_at), '[]'::jsonb) into result
  from public.profiles p;
  return result;
end;
$$;

create or replace function public.admin_set_gurminik_user_access_v2(
  target_user_id uuid,
  active boolean,
  permission_set jsonb,
  mobile_enabled boolean,
  full_enabled boolean,
  activity_all boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
    'favorites','reports','backup','cold_storage','activity_logs'
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
$$;

-- Mark operational audit entries with the mode, without duplicating records.
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
  if private.is_gurminik_mobile_worker() then
    safe_metadata := safe_metadata || jsonb_build_object('source','mobile_worker');
  end if;
  if pg_column_size(safe_metadata) > 32768 then
    safe_metadata := jsonb_build_object('notice','Ayrıntı boyut sınırı nedeniyle kısaltıldı.');
  end if;
  insert into public.activity_logs(
    business_id, actor_user_id, actor_name, module, action_type,
    entity_type, entity_id, person_name, product_name, quantity, amount,
    description, metadata
  ) values (
    private.gurminik_business_id(), uid, private.gurminik_actor_name(uid),
    p_module, p_action_type, p_entity_type, p_entity_id,
    nullif(btrim(p_person_name),''), nullif(btrim(p_product_name),''),
    p_quantity, p_amount, p_description, safe_metadata
  ) returning id into new_id;
  return new_id;
end;
$$;

revoke all on function private.is_gurminik_full_access() from public,anon;
revoke all on function private.is_gurminik_mobile_worker() from public,anon;
grant execute on function private.is_gurminik_full_access() to authenticated;
grant execute on function private.is_gurminik_mobile_worker() to authenticated;
revoke all on function public.admin_set_gurminik_user_access_v2(uuid,boolean,jsonb,boolean,boolean,boolean) from public,anon;
grant execute on function public.admin_set_gurminik_user_access_v2(uuid,boolean,jsonb,boolean,boolean,boolean) to authenticated;

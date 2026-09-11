-- GURMINIK shared-business authorization model.
-- New users are inactive only when explicitly disabled, but start with zero permissions.

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'user' check (role in ('admin', 'user')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module text not null check (module in ('dashboard','purchases','sales','ranking','expenses','contacts','reports','backup')),
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, module)
);

create index if not exists user_permissions_user_id_idx on public.user_permissions(user_id);
create index if not exists profiles_role_active_idx on public.profiles(role, is_active);

create table if not exists private.gurminik_admin_settings (
  singleton boolean primary key default true check (singleton),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.gurminik_admin_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  verified_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.gurminik_admin_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null default now(),
  failures integer not null default 0,
  locked_until timestamptz
);

-- The bcrypt value is provisioned directly in the private schema during deployment.
-- No administrator secret or reusable verifier is kept in the repository.

create or replace function private.handle_gurminik_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, email, display_name, role, is_active, created_at, updated_at)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ''),
    'user',
    true,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_gurminik_profile on auth.users;
create trigger on_auth_user_gurminik_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function private.handle_gurminik_user();

insert into public.profiles(id, email, display_name, role, is_active, created_at, updated_at)
select u.id, coalesce(u.email, ''),
       nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''), ''),
       case when lower(coalesce(u.email, '')) = 'hakdag414@gmail.com' then 'admin' else 'user' end,
       true, u.created_at, now()
from auth.users u
on conflict (id) do update
set email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    role = case when lower(excluded.email) = 'hakdag414@gmail.com' then 'admin' else public.profiles.role end,
    updated_at = now();

insert into public.user_permissions(user_id, module)
select p.id, m.module
from public.profiles p
cross join unnest(array['dashboard','purchases','sales','ranking','expenses','contacts','reports','backup']) as m(module)
on conflict (user_id, module) do nothing;

create or replace function private.is_gurminik_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.is_active
  );
$$;

create or replace function private.has_gurminik_permission(requested_module text, requested_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_gurminik_admin() or exists (
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
  );
$$;

create or replace function private.can_access_gurminik_table(requested_table text, requested_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare allowed_modules text[];
declare item text;
begin
  if private.is_gurminik_admin() then return true; end if;
  allowed_modules := case requested_table
    when 'products' then case when requested_action = 'view' then array['dashboard','purchases','sales','ranking','reports','backup'] else array['dashboard','backup'] end
    when 'purchases' then case when requested_action = 'view' then array['dashboard','purchases','ranking','reports','backup'] else array['purchases','backup'] end
    when 'sales' then case when requested_action = 'view' then array['dashboard','sales','reports','backup'] else array['sales','backup'] end
    when 'expenses' then case when requested_action = 'view' then array['dashboard','expenses','reports','backup'] else array['expenses','backup'] end
    when 'expense_categories' then case when requested_action = 'view' then array['dashboard','expenses','reports','backup'] else array['expenses','backup'] end
    when 'contacts' then array['contacts','backup']
    when 'contact_categories' then array['contacts','backup']
    when 'shipments' then array['sales','reports','backup']
    else array[]::text[]
  end;
  foreach item in array allowed_modules loop
    if private.has_gurminik_permission(item, requested_action) then return true; end if;
  end loop;
  return false;
end;
$$;

create or replace function private.guard_gurminik_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if tg_op = 'INSERT' then
      new.owner_id := (select auth.uid());
    elsif new.owner_id is distinct from old.owner_id then
      raise exception 'Kaydın sahibi değiştirilemez' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
declare p record;
begin
  foreach t in array array['products','purchases','sales','expenses','expense_categories','contacts','contact_categories','shipments'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists gurminik_owner_guard on public.%I', t);
    execute format('create trigger gurminik_owner_guard before insert or update on public.%I for each row execute function private.guard_gurminik_owner()', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_access_gurminik_table(%L, %L)))', t||'_authorized_select', t, t, 'view');
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.can_access_gurminik_table(%L, %L)))', t||'_authorized_insert', t, t, 'create');
    execute format('create policy %I on public.%I for update to authenticated using ((select private.can_access_gurminik_table(%L, %L))) with check ((select private.can_access_gurminik_table(%L, %L)))', t||'_authorized_update', t, t, 'update', t, 'update');
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.can_access_gurminik_table(%L, %L)))', t||'_authorized_delete', t, t, 'delete');
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select private.is_gurminik_admin()));

drop policy if exists permissions_select_self_or_admin on public.user_permissions;
create policy permissions_select_self_or_admin on public.user_permissions
for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_gurminik_admin()));

create or replace function public.get_my_gurminik_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
declare result jsonb;
begin
  if uid is null then raise exception 'Oturum gerekli' using errcode='42501'; end if;
  select jsonb_build_object(
    'user_id', p.id,
    'email', p.email,
    'display_name', p.display_name,
    'role', p.role,
    'is_active', p.is_active,
    'permissions', coalesce((
      select jsonb_object_agg(up.module, jsonb_build_object(
        'can_view', case when p.role='admin' then true else up.can_view end,
        'can_create', case when p.role='admin' then true else up.can_create end,
        'can_update', case when p.role='admin' then true else up.can_update end,
        'can_delete', case when p.role='admin' then true else up.can_delete end
      )) from public.user_permissions up where up.user_id=p.id
    ), '{}'::jsonb)
  ) into result
  from public.profiles p where p.id=uid;
  return coalesce(result, jsonb_build_object('user_id',uid,'role','user','is_active',false,'permissions','{}'::jsonb));
end;
$$;

create or replace function public.verify_gurminik_admin_password(input_password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
declare attempt private.gurminik_admin_attempts%rowtype;
declare stored_hash text;
declare valid boolean := false;
begin
  if uid is null or not private.is_gurminik_admin() then return false; end if;
  select * into attempt from private.gurminik_admin_attempts where user_id=uid for update;
  if attempt.locked_until is not null and attempt.locked_until > now() then return false; end if;
  if attempt.window_started is null or attempt.window_started < now() - interval '10 minutes' then
    insert into private.gurminik_admin_attempts(user_id, window_started, failures, locked_until)
    values(uid, now(), 0, null)
    on conflict(user_id) do update set window_started=now(), failures=0, locked_until=null;
  end if;
  select password_hash into stored_hash from private.gurminik_admin_settings where singleton;
  valid := extensions.crypt(coalesce(input_password,''), stored_hash) = stored_hash;
  if valid then
    insert into private.gurminik_admin_sessions(user_id, verified_until, updated_at)
    values(uid, now()+interval '15 minutes', now())
    on conflict(user_id) do update set verified_until=excluded.verified_until, updated_at=now();
    update private.gurminik_admin_attempts set failures=0, locked_until=null, window_started=now() where user_id=uid;
    return true;
  end if;
  insert into private.gurminik_admin_attempts(user_id, window_started, failures, locked_until)
  values(uid, now(), 1, null)
  on conflict(user_id) do update
  set failures=private.gurminik_admin_attempts.failures+1,
      locked_until=case when private.gurminik_admin_attempts.failures+1 >= 5 then now()+interval '15 minutes' else null end;
  return false;
end;
$$;

create or replace function private.require_gurminik_admin_verification()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_gurminik_admin() or not exists(
    select 1 from private.gurminik_admin_sessions s
    where s.user_id=(select auth.uid()) and s.verified_until > now()
  ) then
    raise exception 'Yönetici doğrulaması gerekli' using errcode='42501';
  end if;
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
    'permissions', coalesce((select jsonb_object_agg(up.module, jsonb_build_object(
      'can_view', up.can_view, 'can_create', up.can_create,
      'can_update', up.can_update, 'can_delete', up.can_delete
    )) from public.user_permissions up where up.user_id=p.id), '{}'::jsonb)
  ) order by p.created_at), '[]'::jsonb) into result
  from public.profiles p;
  return result;
end;
$$;

create or replace function public.admin_set_gurminik_user_access(target_user_id uuid, active boolean, permission_set jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare item text;
declare value jsonb;
begin
  perform private.require_gurminik_admin_verification();
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Kullanıcı bulunamadı'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role='admin') then raise exception 'Yönetici hesabının yetkileri değiştirilemez' using errcode='42501'; end if;
  update public.profiles set is_active=active, updated_at=now() where id=target_user_id;
  foreach item in array array['dashboard','purchases','sales','ranking','expenses','contacts','reports','backup'] loop
    value := coalesce(permission_set -> item, '{}'::jsonb);
    insert into public.user_permissions(user_id,module,can_view,can_create,can_update,can_delete,updated_at)
    values(target_user_id,item,
      coalesce((value->>'can_view')::boolean,false),
      coalesce((value->>'can_create')::boolean,false),
      coalesce((value->>'can_update')::boolean,false),
      coalesce((value->>'can_delete')::boolean,false),now())
    on conflict(user_id,module) do update set
      can_view=excluded.can_view, can_create=excluded.can_create,
      can_update=excluded.can_update, can_delete=excluded.can_delete, updated_at=now();
  end loop;
  return true;
end;
$$;

-- Pending pre-account imports are claimable only by the administrator.
create or replace function public.claim_gurminik_import()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := (select auth.uid());
declare account_email text := lower(coalesce(auth.jwt()->>'email',''));
declare pending_payload jsonb;
declare result jsonb;
begin
  if uid is null or not private.is_gurminik_admin() then raise exception 'Yönetici oturumu gerekli' using errcode='42501'; end if;
  select payload into pending_payload from private.gurminik_pending_imports
  where email=account_email and claimed_at is null for update;
  if pending_payload is null then return jsonb_build_object('claimed',false); end if;
  result := public.import_gurminik_backup(pending_payload);
  update private.gurminik_pending_imports set claimed_at=now() where email=account_email and claimed_at is null;
  return jsonb_build_object('claimed',true,'imported',result);
end;
$$;

revoke all on public.profiles, public.user_permissions from anon;
revoke all on public.profiles, public.user_permissions from public;
grant select on public.profiles, public.user_permissions to authenticated;
revoke all on function public.get_my_gurminik_access() from public, anon;
revoke all on function public.verify_gurminik_admin_password(text) from public, anon;
revoke all on function public.admin_list_gurminik_users() from public, anon;
revoke all on function public.admin_set_gurminik_user_access(uuid,boolean,jsonb) from public, anon;
grant execute on function public.get_my_gurminik_access() to authenticated;
grant execute on function public.verify_gurminik_admin_password(text) to authenticated;
grant execute on function public.admin_list_gurminik_users() to authenticated;
grant execute on function public.admin_set_gurminik_user_access(uuid,boolean,jsonb) to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_gurminik_admin() to authenticated;
grant execute on function private.has_gurminik_permission(text,text) to authenticated;
grant execute on function private.can_access_gurminik_table(text,text) to authenticated;
revoke all on all tables in schema private from anon, authenticated, public;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_permissions') then
    alter publication supabase_realtime add table public.user_permissions;
  end if;
end;
$$;

-- Shared crate ledger. No existing business records are changed.
alter table public.user_permissions drop constraint if exists user_permissions_module_check;
alter table public.user_permissions add constraint user_permissions_module_check check (module in (
  'dashboard','purchases','sales','ranking','expenses','contacts','accounts',
  'favorites','cold_storage','crates','reports','backup','activity_logs'
));
insert into public.user_permissions(user_id,module)
select id,'crates' from public.profiles where role <> 'admin'
on conflict(user_id,module) do nothing;

create table public.crate_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  identity_key text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  person_name text not null check (length(btrim(person_name)) between 1 and 200),
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  unique(business_id,identity_key)
);
create index crate_accounts_business_balance_idx on public.crate_accounts(business_id,balance desc,updated_at desc);
create table public.crate_movements (
  id uuid primary key,
  business_id uuid not null,
  account_id uuid not null references public.crate_accounts(id),
  movement_type text not null check (movement_type in ('given','returned','completed','purchase_return','purchase_reversal','purchase_adjustment')),
  delta integer not null check (delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  purchase_id uuid,
  actor_user_id uuid,
  actor_name text not null,
  created_at timestamptz not null default now()
);
create index crate_movements_account_date_idx on public.crate_movements(account_id,created_at desc);

alter table public.purchases add column returned_crates integer not null default 0 check (returned_crates >= 0);
alter table public.purchases add column crate_account_id uuid references public.crate_accounts(id);
alter table public.purchases add constraint purchases_crate_account_required check (returned_crates = 0 or crate_account_id is not null);

alter table public.crate_accounts enable row level security;
alter table public.crate_movements enable row level security;
revoke all on public.crate_accounts, public.crate_movements from public, anon, authenticated;
grant select on public.crate_accounts, public.crate_movements to authenticated;
create policy crate_accounts_read on public.crate_accounts for select to authenticated
using ((select private.has_gurminik_permission('crates','view')));
create policy crate_movements_read on public.crate_movements for select to authenticated
using ((select private.has_gurminik_permission('crates','view')));

-- Internal writer serializes every movement on the account row. Only callers
-- with an already checked permission may invoke it through the functions below.
create function private.apply_crate_movement(p_account uuid,p_delta integer,p_type text,p_id uuid,p_purchase uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare a public.crate_accounts%rowtype; after_balance integer;
begin
  if p_delta = 0 then return null; end if;
  select * into a from public.crate_accounts where id=p_account for update;
  if not found or a.business_id is distinct from private.gurminik_business_id() then
    raise exception 'Kasa hesabı bulunamadı.' using errcode='22023';
  end if;
  after_balance := a.balance + p_delta;
  if after_balance < 0 then
    raise exception '% kişisinin yalnızca % açık kasası bulunuyor.', a.person_name, a.balance using errcode='22023';
  end if;
  update public.crate_accounts set balance=after_balance,updated_at=now() where id=a.id;
  insert into public.crate_movements(id,business_id,account_id,movement_type,delta,balance_after,purchase_id,actor_user_id,actor_name)
  values(p_id,a.business_id,a.id,p_type,p_delta,after_balance,p_purchase,auth.uid(),private.gurminik_actor_name(auth.uid()));
  perform private.write_gurminik_activity('crates',case when p_type='completed' then 'update' else 'create' end,
    'crate_accounts',a.id::text,a.person_name,null,abs(p_delta),null,
    private.gurminik_actor_name(auth.uid()) || ' · ' || a.person_name || ' · ' ||
    case when p_delta > 0 then p_delta::text || ' kasa verdi.' else abs(p_delta)::text || ' kasa geri aldı.' end ||
    ' Açık kasa: ' || after_balance::text || '.',
    jsonb_build_object('movement_id',p_id,'purchase_id',p_purchase,'balance',after_balance));
  return after_balance;
end;
$$;

-- Idempotent manual operations for the existing offline queue. The same UUID
-- cannot apply twice, including when a successful response was lost.
create function private.record_crate_change(p_id uuid,p_account uuid,p_person text,p_contact uuid,p_quantity integer,p_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare account_id uuid; identity text; existing public.crate_movements%rowtype; amount integer;
begin
  if auth.uid() is null or not private.has_gurminik_permission('crates',case when p_kind='given' then 'create' when p_kind='completed' then 'delete' else 'update' end) then
    raise exception 'Kasa işlemine yetkiniz yok.' using errcode='42501';
  end if;
  if p_id is null or p_kind not in ('given','returned','completed') then raise exception 'Geçersiz kasa işlemi.' using errcode='22023'; end if;
  select * into existing from public.crate_movements where id=p_id;
  if found then
    return existing.account_id;
  end if;
  if p_kind='given' and (p_account is null or not exists(select 1 from public.crate_accounts where id=p_account)) then
    if length(btrim(coalesce(p_person,''))) not between 1 and 200 then raise exception 'Kişi adı gerekli.' using errcode='22023'; end if;
    if p_contact is not null and not exists(select 1 from public.contacts c where c.id=p_contact and c.name=btrim(p_person)) then
      raise exception 'Kişi rehberde bulunamadı.' using errcode='22023';
    end if;
    identity := case when p_contact is null then 'name:'||lower(btrim(p_person)) else 'contact:'||p_contact::text end;
    insert into public.crate_accounts(id,business_id,identity_key,contact_id,person_name)
    values(coalesce(p_account,gen_random_uuid()),private.gurminik_business_id(),identity,p_contact,btrim(p_person))
    on conflict(business_id,identity_key) do update set person_name=excluded.person_name
    returning id into account_id;
  else
    account_id := p_account;
  end if;
  if account_id is null or not exists(select 1 from public.crate_accounts where id=account_id) then
    identity := case when p_contact is null then 'name:'||lower(btrim(p_person)) else 'contact:'||p_contact::text end;
    select id into account_id from public.crate_accounts where business_id=private.gurminik_business_id() and identity_key=identity;
  end if;
  if account_id is null then raise exception 'Kasa hesabı seçin.' using errcode='22023'; end if;
  if p_kind='completed' then
    select balance into amount from public.crate_accounts where id=account_id and business_id=private.gurminik_business_id() for update;
    if not found then raise exception 'Kasa hesabı bulunamadı.' using errcode='22023'; end if;
    if amount=0 then return account_id; end if;
    perform private.apply_crate_movement(account_id,-amount,'completed',p_id,null);
  else
    if p_quantity is null or p_quantity <= 0 then raise exception 'Pozitif tam kasa adedi girin.' using errcode='22023'; end if;
    perform private.apply_crate_movement(account_id,case when p_kind='given' then p_quantity else -p_quantity end,p_kind,p_id,null);
  end if;
  return account_id;
end;
$$;
revoke all on function private.record_crate_change(uuid,uuid,text,uuid,integer,text) from public,anon;
grant execute on function private.record_crate_change(uuid,uuid,text,uuid,integer,text) to authenticated;
create function public.record_crate_change(p_id uuid,p_account uuid,p_person text,p_contact uuid,p_quantity integer,p_kind text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.record_crate_change(p_id,p_account,p_person,p_contact,p_quantity,p_kind)
$$;
revoke all on function public.record_crate_change(uuid,uuid,text,uuid,integer,text) from public,anon;
grant execute on function public.record_crate_change(uuid,uuid,text,uuid,integer,text) to authenticated;

create function private.sync_purchase_crates() returns trigger language plpgsql security definer set search_path = '' as $$
declare old_quantity integer:=0; new_quantity integer:=0; account public.crate_accounts%rowtype;
begin
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
create trigger sync_purchase_crates after insert or update or delete on public.purchases
for each row execute function private.sync_purchase_crates();

-- Backend mapping for permission checks, without broadening purchase read access.
create or replace function public.admin_set_gurminik_user_access(target_user_id uuid, active boolean, permission_set jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare item text; value jsonb; target_label text;
begin
  perform private.require_gurminik_admin_verification();
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Kullanıcı bulunamadı'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role='admin') then raise exception 'Yönetici hesabının yetkileri değiştirilemez' using errcode='42501'; end if;
  update public.profiles set is_active=active,updated_at=now() where id=target_user_id;
  foreach item in array array['dashboard','purchases','sales','ranking','expenses','contacts','accounts','favorites','reports','backup','cold_storage','crates','activity_logs'] loop
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

-- The existing authenticated reset rotates the epoch after clearing purchases.
-- At that point delete the crate ledger in the same reset transaction.
create function private.reset_crates_with_epoch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.epoch is distinct from old.epoch then
    if current_setting('gurminik.audit_disabled',true) <> 'on' then raise exception 'Kasa sıfırlama yalnızca yönetici sıfırlamasıyla yapılabilir.' using errcode='42501'; end if;
    delete from public.crate_movements;
    delete from public.crate_accounts;
  end if;
  return new;
end;
$$;
create trigger reset_crates_with_epoch after update of epoch on private.gurminik_business_state
for each row execute function private.reset_crates_with_epoch();
revoke all on function private.apply_crate_movement(uuid,integer,text,uuid,uuid) from public,anon,authenticated;
revoke all on function private.sync_purchase_crates() from public,anon,authenticated;
revoke all on function private.reset_crates_with_epoch() from public,anon,authenticated;

-- vCard içe aktarımını tek özet log olarak tutarak audit tablosunu küçük tut.
create or replace function public.log_gurminik_contact_import(added_count integer, skipped_count integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Oturum gerekli' using errcode='42501'; end if;
  if not private.is_gurminik_admin() and not private.has_gurminik_permission('contacts','create') then
    raise exception 'Telefon ekleme yetkisi gerekli' using errcode='42501';
  end if;
  return private.write_gurminik_activity(
    'contacts','import','contacts',null,null,null,null,null,
    private.gurminik_actor_name(auth.uid())||' · Rehberden '||greatest(added_count,0)||' telefon kaydı aktardı.',
    jsonb_build_object('added',greatest(added_count,0),'skipped',greatest(skipped_count,0))
  );
end;
$$;
revoke all on function public.log_gurminik_contact_import(integer,integer) from public,anon;
grant execute on function public.log_gurminik_contact_import(integer,integer) to authenticated;

-- Ana trigger fonksiyonundaki erken dönüş, sadece vCard notuyla oluşturulan
-- kişilerde satır logunu atlar; normal kişi CRUD işlemleri aynen loglanır.
create or replace function private.gurminik_skip_vcard_audit(row_notes text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$ select coalesce(row_notes,'') like 'vCard aktarımı%' $$;
revoke all on function private.gurminik_skip_vcard_audit(text) from public,anon,authenticated;

drop trigger if exists gurminik_audit_row on public.contacts;
drop trigger if exists gurminik_audit_contact_insert on public.contacts;
drop trigger if exists gurminik_audit_contact_change on public.contacts;
create trigger gurminik_audit_contact_insert
  after insert on public.contacts
  for each row
  when (not private.gurminik_skip_vcard_audit(new.notes))
  execute function private.gurminik_audit_row();
create trigger gurminik_audit_contact_change
  after update or delete on public.contacts
  for each row execute function private.gurminik_audit_row();

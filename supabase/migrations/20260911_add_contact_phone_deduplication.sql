create or replace function public.normalize_contact_phone(input_phone text)
returns text
language sql
immutable
parallel safe
returns null on null input
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(input_phone, '[^0-9]', '', 'g') as digits
  )
  select case
    when digits ~ '^0090[0-9]{10}$' then substr(digits, 3)
    when digits ~ '^90[0-9]{10}$' then digits
    when digits ~ '^0[0-9]{10}$' then '90' || substr(digits, 2)
    when digits ~ '^[0-9]{10}$' then '90' || digits
    when digits ~ '^[0-9]{7,15}$' then digits
    else null
  end
  from cleaned;
$$;

alter table public.contacts
  add column if not exists phone_normalized text
  generated always as (public.normalize_contact_phone(phone)) stored;

create unique index if not exists contacts_owner_phone_normalized_unique
  on public.contacts (owner_id, phone_normalized)
  where phone_normalized is not null;

comment on column public.contacts.phone_normalized is
  'Telefon numaralarını kullanıcı bazında mükerrer kayıtlardan koruyan oluşturulmuş standart değer.';

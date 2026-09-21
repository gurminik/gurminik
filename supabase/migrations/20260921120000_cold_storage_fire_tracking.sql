-- Adds manually entered cold-storage loss data without changing existing rows.
alter table public.cold_storage_expenses
  add column if not exists product_name text,
  add column if not exists loss_kg numeric(16,2);

alter table public.cold_storage_expenses
  alter column amount set default 0;

alter table public.cold_storage_expenses
  drop constraint if exists cold_storage_expenses_amount_check;

alter table public.cold_storage_expenses
  add constraint cold_storage_expenses_amount_check check (amount >= 0),
  add constraint cold_storage_expenses_loss_kg_check check (loss_kg is null or loss_kg >= 0),
  add constraint cold_storage_expenses_fire_fields_check check (
    lower(btrim(category)) <> 'fire'
    or (loss_kg is not null and loss_kg > 0 and length(btrim(coalesce(product_name,''))) > 0)
  ) not valid;

create index if not exists cold_expenses_owner_category_date_idx
  on public.cold_storage_expenses (owner_id, category, transaction_at desc);

-- Existing owner/module RLS policies remain in force for the new columns.

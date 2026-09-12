-- Yeni cari hesap ve favori tablolarındaki foreign key erişimlerini hızlandırır.
create index if not exists account_payments_owner_id_idx
  on public.account_payments (owner_id);

create index if not exists favorites_owner_id_idx
  on public.favorites (owner_id);

create index if not exists favorites_last_product_id_idx
  on public.favorites (last_product_id)
  where last_product_id is not null;

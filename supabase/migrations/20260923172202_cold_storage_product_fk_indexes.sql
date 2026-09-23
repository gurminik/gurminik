-- Cover the nullable product foreign keys for efficient relationship checks and
-- remove unnecessary elevated execution from the v2 reset wrapper. The v1 reset
-- function still performs the owner/admin and server-side password validation.
create index if not exists cold_storage_purchases_product_id_idx
  on public.cold_storage_purchases(product_id);
create index if not exists cold_storage_sales_product_id_idx
  on public.cold_storage_sales(product_id);
create index if not exists cold_storage_expenses_product_id_idx
  on public.cold_storage_expenses(product_id);

create or replace function public.reset_gurminik_application_v2(input_password text, confirmation_text text)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare result jsonb; removed bigint;
begin
  result := public.reset_gurminik_application(input_password,confirmation_text);
  if coalesce((result->>'success')::boolean,false) then
    perform set_config('gurminik.audit_disabled','on',true);
    with d as (delete from public.cold_storage_products returning 1)
      select count(*) into removed from d;
    perform set_config('gurminik.audit_disabled','off',true);
    result := jsonb_set(result,'{deleted,coldProducts}',to_jsonb(removed),true);
  end if;
  return result;
end $$;

revoke all on function public.reset_gurminik_application_v2(text,text) from public,anon;
grant execute on function public.reset_gurminik_application_v2(text,text) to authenticated;

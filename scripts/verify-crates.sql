-- Run in one session. This transaction is rolled back; no production rows survive.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and is_active limit 1),true);
set local role authenticated;
do $$
declare
  operation_id uuid:=gen_random_uuid();
  v_account uuid:=gen_random_uuid();
  purchase_id uuid:=gen_random_uuid();
  product_id uuid;
  actual integer;
  rows_before integer;
  person text:='Kasa Entegrasyon Testi '||gen_random_uuid()::text;
begin
  select id into product_id from public.products where is_active limit 1;
  if product_id is null then raise exception 'Test için aktif ürün yok'; end if;
  perform public.record_crate_change(operation_id,v_account,person,null,100,'given');
  perform public.record_crate_change(operation_id,v_account,person,null,100,'given');
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>100 then raise exception 'İdempotent ilk kayıt: %',actual; end if;
  perform public.record_crate_change(gen_random_uuid(),v_account,person,null,200,'given');
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>300 then raise exception 'İkinci verme: %',actual; end if;
  select count(*) into actual from public.crate_accounts where person_name=person;
  if actual<>1 then raise exception 'Tek kişi hesabı: %',actual; end if;
  insert into public.purchases(id,product_id,supplier_name,vehicle_plate,quantity_kg,unit_buy_price,returned_crates,crate_account_id)
  values(purchase_id,product_id,person,'TEST',3250,10,200,v_account);
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>100 then raise exception 'Alışta kasa dönüşü: %',actual; end if;
  update public.purchases set returned_crates=150 where id=purchase_id;
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>150 then raise exception 'Alış düzeltmesi: %',actual; end if;
  update public.purchases set status='cancelled' where id=purchase_id;
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>300 then raise exception 'İptal: %',actual; end if;
  update public.purchases set status='active' where id=purchase_id;
  update public.purchases set status='active' where id=purchase_id;
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>150 then raise exception 'Tek etkinleştirme: %',actual; end if;
  begin
    update public.purchases set returned_crates=500 where id=purchase_id;
    raise exception 'Açık bakiyeden fazla kasa kabul edildi';
  exception when sqlstate '22023' then null; end;
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>150 then raise exception 'Hatalı alış bakiyeyi değiştirdi: %',actual; end if;
  update public.purchases set returned_crates=0,crate_account_id=null where id=purchase_id;
  perform public.record_crate_change(gen_random_uuid(),v_account,person,null,100,'returned');
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>200 then raise exception 'Manuel geri alma: %',actual; end if;
  select count(*) into rows_before from public.crate_movements where account_id=v_account;
  perform public.record_crate_change(gen_random_uuid(),v_account,person,null,0,'completed');
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>0 then raise exception 'Bitir: %',actual; end if;
  select count(*) into actual from public.crate_movements where account_id=v_account;
  if actual<>rows_before+1 then raise exception 'Bitir geçmişi değiştirdi: %',actual; end if;
  perform public.record_crate_change(gen_random_uuid(),v_account,person,null,50,'given');
  select balance into actual from public.crate_accounts where id=v_account;
  if actual<>50 then raise exception 'Tekrar açılma: %',actual; end if;
  select count(*) into actual from public.activity_logs where module='crates' and person_name=person;
  if actual<8 then raise exception 'Kasa işlem geçmişi eksik: %',actual; end if;
  raise notice 'Kasa akışı: 16 doğrulama başarılı (geri alınacak).';
end;
$$;
rollback;

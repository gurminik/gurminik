// Actual PostgreSQL execution in an isolated in-memory PGlite database.
// This script never connects to Supabase or production.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { paymentDateBounds } from "../lib/payments.ts";

const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const admin=id(1), editor=id(2), viewer=id(3), worker=id(4), outsider=id(5), full=id(6), product=id(20);
function sourceFunction(path, name) {
  const source=readFileSync(path,"utf8");
  const start=source.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start,-1,name);
  return source.slice(start,source.indexOf("\n$$;",start)+4);
}
const mobile="supabase/migrations/20260923181438_mobile_worker_mode.sql";
const audit="supabase/migrations/20260923120000_activity_log_and_safe_reset.sql";
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(id uuid primary key,email text,display_name text,role text,is_active boolean,
      mobile_mode boolean default false,full_access boolean default false,activity_scope_all boolean default false,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.user_permissions(user_id uuid references public.profiles(id),module text,
      can_view boolean default false,can_create boolean default false,can_update boolean default false,can_delete boolean default false,
      updated_at timestamptz default now(),primary key(user_id,module),constraint user_permissions_module_check check(module in ('purchases','sales','backup','crates')));
    create table public.products(id uuid primary key,owner_id uuid,name text);
    create table public.purchases(id uuid primary key default gen_random_uuid(),owner_id uuid default auth.uid(),product_id uuid,
      supplier_contact_id uuid,supplier_name text,vehicle_plate text,quantity_kg numeric,unit_buy_price numeric,
      total_buy_amount numeric generated always as (round(quantity_kg*unit_buy_price,2)) stored,
      transaction_at timestamptz,notes text,status text default 'active',is_paid boolean not null default true,
      cancelled_at timestamptz,returned_crates integer default 0,crate_account_id uuid,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.crate_accounts(id uuid primary key,business_id uuid,person_name text,balance integer);
    create function private.apply_crate_movement(uuid,integer,text,uuid,uuid) returns integer language plpgsql as $$ begin raise exception 'unexpected crate movement'; end $$;
    create table public.activity_logs(id uuid primary key default gen_random_uuid(),business_id uuid,actor_user_id uuid,
      actor_name text,module text,action_type text,entity_type text,entity_id text,person_name text,product_name text,
      quantity numeric,amount numeric,description text,metadata jsonb,created_at timestamptz default now());
    create function private.require_gurminik_admin_verification() returns void language plpgsql as $$ begin return; end $$;
  `);
  for (const name of ["is_gurminik_full_access","is_gurminik_mobile_worker","has_gurminik_permission"])
    await db.exec(sourceFunction(mobile,`private.${name}`));
  for (const name of ["gurminik_business_id","gurminik_actor_name","write_gurminik_activity"])
    await db.exec(sourceFunction(audit,`private.${name}`));
  await db.exec(`
    insert into profiles(id,email,display_name,role,is_active,mobile_mode,full_access) values
      ('${admin}','admin@example.invalid','Murat Yönetici','admin',true,false,false),
      ('${editor}','editor@example.invalid','Düzenleyen','user',true,false,false),
      ('${viewer}','viewer@example.invalid','Görüntüleyen','user',true,false,false),
      ('${worker}','worker@example.invalid','Mobil','user',true,true,false),
      ('${full}','full@example.invalid','Tam Yetki','user',true,false,true);
    insert into products values ('${product}','${admin}','Mandalina'),('${id(21)}','${admin}','Portakal');
    insert into user_permissions(user_id,module,can_view,can_create,can_update) values
      ('${editor}','purchases',true,true,true),('${viewer}','purchases',true,true,true),('${worker}','purchases',true,true,true);
  `);
  async function insert(n,{person="Murat",kg=100,price=8,paid=false,date="2026-10-13T09:30:00+03:00",owner=admin,plate="01 ABC 123",prod=product,contact=null,status="active"}={}) {
    await db.query("insert into purchases(id,owner_id,product_id,supplier_name,quantity_kg,unit_buy_price,is_paid,transaction_at,vehicle_plate,supplier_contact_id,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [id(n),owner,prod,person,kg,price,paid,date,plate,contact,status]);
  }
  for(let n=100;n<112;n++) await insert(n,{paid:n<105,person:n%2 ? " MURAT " : "Murat"});
  await insert(120,{person:"Hasan",kg:4000,plate:"01 DEF 456"});
  await insert(121,{person:"Hasan",kg:3000,price:10,prod:id(21),paid:true});
  await insert(130,{person:"Alias A",contact:id(90),paid:true});
  await insert(131,{person:"Alias B",contact:id(90),paid:true});
  await insert(140,{date:"2026-10-01T00:00:00+03:00",person:"Sınır"});
  await insert(141,{date:"2026-10-31T23:59:59.999+03:00",person:"Sınır"});
  await insert(142,{date:"2026-11-01T00:00:00+03:00",person:"Sınır"});
  await insert(150,{person:"İptal",status:"cancelled"});
  await insert(160,{person:"Mobil Kayıt",owner:worker});
  await insert(170,{person:"Başka hesap",owner:outsider});
  await insert(175,{person:"Kasa İadeli"});
  await db.exec("insert into crate_accounts values ('"+id(95)+"','"+admin+"','Kasa İadeli',100); update purchases set returned_crates=10,crate_account_id='"+id(95)+"' where id='"+id(175)+"'");
  const before=(await db.query("select * from purchases order by id")).rows;
  await db.exec(readFileSync("supabase/migrations/20261013071318_supplier_payments.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/20261016175654_fix_shared_audit_payment_fields.sql","utf8"));
  assert.deepEqual((await db.query("select * from purchases order by id")).rows,before,"migration must not mutate historical purchases");
  await db.exec(`
    create trigger sync_purchase_crates after insert or update or delete on purchases for each row execute function private.sync_purchase_crates();
    create trigger gurminik_audit_row after insert or update or delete on purchases for each row execute function private.gurminik_audit_row();
    alter table purchases enable row level security; alter table products enable row level security;
    create policy products_authorized_select on products for select to authenticated using(private.can_access_gurminik_table('products','view'));
    create policy purchases_authorized_select on purchases for select to authenticated using(private.can_access_gurminik_table('purchases','view') and (not private.is_gurminik_mobile_worker() or owner_id=auth.uid()));
    create policy purchases_authorized_insert on purchases for insert to authenticated with check(private.can_access_gurminik_table('purchases','create') and owner_id=auth.uid());
    create policy purchases_authorized_update on purchases for update to authenticated using(private.can_access_gurminik_table('purchases','update') and (not private.is_gurminik_mobile_worker() or owner_id=auth.uid())) with check(private.can_access_gurminik_table('purchases','update') and (not private.is_gurminik_mobile_worker() or owner_id=auth.uid()));
    grant usage on schema auth,private,public to authenticated,anon;
    grant select,insert,update on purchases to authenticated; grant select on products to authenticated;
    insert into user_permissions(user_id,module,can_view,can_update) values
      ('${editor}','payments',true,true),('${viewer}','payments',true,false),('${worker}','payments',true,true);
  `);
  async function as(user,sql,args=[]) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||""]);
    await db.exec("set role authenticated");
    try { return await db.query(sql,args); } finally { await db.exec("reset role"); }
  }
  async function page({user=editor,search="",status="all",page=1,start=null,end=null}={}) {
    return (await as(user,"select public.get_gurminik_payments_page($1,$2,$3,$4,$5) as data",[search,start,end,status,page])).rows[0].data;
  }
  const murat=await page({search:"murat"});
  assert.equal(murat.count,12); assert.equal(murat.rows.length,10); assert.equal(murat.total.people,1);
  assert.deepEqual(murat.total,{people:1,kg:1200,amount:9600});
  assert.deepEqual(murat.paid,{people:1,kg:500,amount:4000});
  assert.deepEqual(murat.unpaid,{people:1,kg:700,amount:5600});
  const second=await page({search:"MURAT",page:2});
  assert.equal(second.rows.length,2); assert.deepEqual(second.total,murat.total);
  assert.equal(new Set([...murat.rows,...second.rows].map(r=>r.id)).size,12,"no duplicate pagination rows");
  assert.equal((await page({search:"Murat",page:99})).page,2);
  const paid=await page({search:"murat",status:"paid"}),unpaid=await page({search:"murat",status:"unpaid"});
  assert.equal(paid.count,5); assert.ok(paid.rows.every(r=>r.is_paid)); assert.equal(paid.unpaid.amount,0);
  assert.equal(unpaid.count,7); assert.ok(unpaid.rows.every(r=>!r.is_paid)); assert.equal(unpaid.paid.amount,0);
  assert.equal((await page({search:"01abc123"})).count,20,"plate spacing is optional");
  assert.ok((await page({search:"PORTAKAL"})).rows.every(r=>r.product_name==="Portakal"));
  assert.equal((await page({search:"Alias"})).total.people,1,"contact id takes priority over name");
  const bounds=paymentDateBounds({start:"2026-10-01",end:"2026-10-31"});
  const dates=await page({search:"Sınır",...bounds});
  assert.equal(dates.count,2,"both Turkey day boundaries included, next day excluded");
  assert.equal((await page({search:"İptal"})).count,0);
  assert.equal((await page({search:"Başka hesap"})).count,0,"owners outside existing business profiles are excluded");
  assert.equal((await page({user:worker})).count,1,"mobile worker sees only own records");
  await assert.rejects(page({user:outsider}),/yetkiniz yok/);
  await assert.rejects(page({user:null}),/yetkiniz yok/);
  await assert.rejects(page({status:"unknown"}),/Geçersiz/);
  assert.ok((await page({user:full})).count>10,"full access works without module rows");
  await assert.rejects(as(viewer,"select public.set_gurminik_purchase_payment($1,true,false)",[id(105)]),/yetkiniz yok/);
  await assert.rejects(as(viewer,"update purchases set is_paid=true where id=$1",[id(105)]),/yetkiniz yok/,"raw purchase update cannot bypass payment permission");
  await as(viewer,"update purchases set vehicle_plate='01 TEST 1' where id=$1",[id(105)]);
  await assert.rejects(as(worker,"select public.set_gurminik_purchase_payment($1,true,false)",[id(105)]),/erişiminiz yok/);
  await as(editor,"select public.set_gurminik_purchase_payment($1,true,false)",[id(175)]);
  assert.equal((await db.query("select balance from crate_accounts where id=$1",[id(95)])).rows[0].balance,100,"payment-only update leaves crate ledger unchanged without crate permission");
  const original=(await db.query("select * from purchases where id=$1",[id(106)])).rows[0];
  await as(editor,"select public.set_gurminik_purchase_payment($1,true,false)",[id(106)]);
  const changed=(await db.query("select * from purchases where id=$1",[id(106)])).rows[0];
  for(const key of Object.keys(original).filter(k=>!["is_paid","updated_at"].includes(k))) assert.deepEqual(changed[key],original[key],`payment RPC preserved ${key}`);
  const after=await page({search:"murat"}); assert.equal(after.paid.amount,4800); assert.equal(after.unpaid.amount,4800);
  const log=(await db.query("select * from activity_logs where module='payments' order by created_at desc limit 1")).rows[0];
  assert.equal(log.actor_user_id,editor); assert.equal(log.actor_name,"Düzenleyen");
  assert.equal(log.entity_id,id(106)); assert.deepEqual(log.metadata,{old_is_paid:false,new_is_paid:true});
  assert.match(log.description,/Ödenmedi → Ödendi/); assert.ok(log.created_at);
  const auditCount=(await db.query("select count(*)::int as n from activity_logs where module='payments'")).rows[0].n;
  await as(editor,"select public.set_gurminik_purchase_payment($1,true,false)",[id(106)]);
  assert.equal((await db.query("select count(*)::int as n from activity_logs where module='payments'")).rows[0].n,auditCount,"retry is idempotent");
  await assert.rejects(as(editor,"select public.set_gurminik_purchase_payment($1,false,false)",[id(106)]),/başka bir kullanıcı/);
  await as(worker,"select public.set_gurminik_purchase_payment($1,true,false)",[id(160)]);
  await as(editor,"insert into purchases(id,owner_id,product_id,supplier_name,quantity_kg,unit_buy_price,transaction_at) values($1,$2,$3,'Yeni',4000,8,now())",[id(180),editor,product]);
  assert.equal((await db.query("select is_paid,total_buy_amount from purchases where id=$1",[id(180)])).rows[0].is_paid,false,"DB default is unpaid");
  const newLog=(await db.query("select * from activity_logs where entity_id=$1",[id(180)])).rows[0];
  assert.match(newLog.description,/Ödeme durumu: Ödenmedi/); assert.equal(newLog.actor_user_id,editor);
  await as(editor,"insert into purchases(id,owner_id,product_id,supplier_name,quantity_kg,unit_buy_price,is_paid,transaction_at) values($1,$2,$3,'Peşin',3000,10,true,now())",[id(181),editor,product]);
  assert.equal((await db.query("select is_paid from purchases where id=$1",[id(181)])).rows[0].is_paid,true);
  await assert.rejects(as(worker,"select public.get_gurminik_payment_detail($1) as data",[id(120)]).then(r=>{assert.equal(r.rows[0].data,null);throw new Error("not-accessible");}),/not-accessible/);
  const empty=await page({search:"bulunamayan"}); assert.equal(empty.count,0); assert.equal(empty.page,1); assert.equal(empty.total.amount,0);
  await db.exec("set role anon");
  await assert.rejects(db.query("select public.get_gurminik_payments_page()"),/permission denied/);
  await db.exec("reset role");
  console.log("Payments PostgreSQL: historical preservation, default/paid persistence, aggregate/search/date/tab/pagination, RLS, payment-only updates, mobile scope, concurrency and compact actor audit passed.");
} catch (error) { console.error(error.message, error.code || "", error.where || ""); process.exitCode=1; } finally { await db.close(); }

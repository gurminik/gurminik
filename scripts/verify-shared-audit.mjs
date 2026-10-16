// Regression for a generic trigger accessing a purchases-only record field.
// Real PostgreSQL in memory; no connection to Supabase or production data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const user = "00000000-0000-0000-0000-000000000001";
const product = "00000000-0000-0000-0000-000000000020";
const migration = "supabase/migrations/20261016175654_fix_shared_audit_payment_fields.sql";
const read = (file) => readFileSync(file,"utf8");
function extractFunction(source, name) {
  const escaped=name.replaceAll(".","\\.");
  const match=source.match(new RegExp(`create or replace function ${escaped}\\([\\s\\S]*?\\n(?:\\$\\$|\\$function\\$);`,"i"));
  assert.ok(match, name); return match[0];
}
function createTables(file) {
  return [...read(file).matchAll(/create table (?:if not exists )?public\.cold_storage_\w+ \([\s\S]*?\n\);/gi)].map(m=>m[0]).join("\n");
}
const fixtures = [
  ["cold_storage_purchases",{product_name:"Nar",supplier_name:"Tedarikçi",quantity_kg:1000,unit_buy_price:12}],
  ["cold_storage_sales",{product_name:"Nar",buyer_name:"Alıcı",quantity_kg:250,unit_sale_price:20}],
  ["cold_storage_expenses",{title:"Elektrik",category:"Elektrik",amount:1500}],
  ["cold_storage_expense_categories",{name:"Test gideri"}],
  ["cold_storage_products",{name:"Test ürünü"}],
  ["sales",{product_id:product,buyer_name:"Alıcı",quantity_kg:300,unit_sale_price:20}],
  ["expenses",{title:"Nakliye",category:"Nakliye",amount:500}],
  ["expense_categories",{name:"Test kategori"}],
  ["contacts",{name:"Test kişi",phone:"05000000000"}],
  ["contact_categories",{name:"Test rehber kategorisi"}],
  ["account_payments",{company_name:"Test firma",amount:600}],
  ["favorites",{person_name:"Test favori"}],
  ["products",{name:"Test ürün"}],
];
async function insert(table, payload) {
  const keys=Object.keys(payload);
  return (await db.query(`insert into public.${table}(${keys.join(",")}) values(${keys.map((_,i)=>`$${i+1}`).join(",")}) returning id`,Object.values(payload))).rows[0].id;
}
try {
  await db.exec(`
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key,display_name text,email text,role text,created_at timestamptz default now());
    create table public.products(id uuid primary key default gen_random_uuid(),owner_id uuid default auth.uid(),name text,notes text default '');
    create table public.purchases(id uuid primary key default gen_random_uuid(),owner_id uuid default auth.uid(),supplier_name text,product_id uuid,
      quantity_kg numeric,unit_buy_price numeric,total_buy_amount numeric generated always as (round(quantity_kg*unit_buy_price,2)) stored,
      is_paid boolean default false,status text default 'active',notes text default '',updated_at timestamptz default now());
    insert into auth.users values('${user}');
    insert into public.profiles(id,display_name,email,role) values('${user}','Test Yönetici','test@example.invalid','admin');
    insert into public.products(id,name) values('${product}','Nar');
  `);
  const original=read("supabase/migrations/20260923120000_activity_log_and_safe_reset.sql");
  await db.exec(original.match(/create table if not exists public\.activity_logs \([\s\S]*?\n\);/)[0]);
  for(const name of ["gurminik_business_id","gurminik_actor_name","write_gurminik_activity"])
    await db.exec(extractFunction(original,`private.${name}`));
  await db.exec(createTables("supabase/migrations/20260920173000_cold_storage_isolated.sql"));
  await db.exec(createTables("supabase/migrations/20260923140000_cold_storage_product_cost_tracking.sql"));
  await db.exec(read("supabase/migrations/20260921120000_cold_storage_fire_tracking.sql"));
  await db.exec(`
    create table public.sales(like public.cold_storage_sales including all);
    alter table public.sales drop column product_name; alter table public.sales add column product_id uuid;
    create table public.expenses(like public.cold_storage_expenses including all);
    create table public.expense_categories(like public.cold_storage_expense_categories including all);
    create table public.contacts(id uuid primary key default gen_random_uuid(),owner_id uuid default auth.uid(),name text,phone text,notes text default '');
    create table public.contact_categories(like public.cold_storage_expense_categories including all);
    create table public.account_payments(id uuid primary key default gen_random_uuid(),owner_id uuid default auth.uid(),company_name text,amount numeric,notes text default '');
    create table public.favorites(id uuid primary key default gen_random_uuid(),owner_id uuid default auth.uid(),person_name text,notes text default '');
  `);
  await db.exec(extractFunction(read("supabase/migrations/20261013071318_supplier_payments.sql"),"private.gurminik_audit_row"));
  for(const table of [...fixtures.map(([table])=>table),"purchases"])
    await db.exec(`create trigger gurminik_audit_row after insert or update or delete on public.${table} for each row execute function private.gurminik_audit_row()`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  // First reproduce the production failure, including all five cold-storage tables.
  for(const [table,payload] of fixtures)
    await assert.rejects(insert(table,payload), /record "(?:old|new)" has no field "is_paid"/, `${table}: previous trigger must reproduce the bug`);
  assert.equal((await db.query("select count(*)::int as n from public.activity_logs")).rows[0].n,0);
  await db.exec(read(migration));
  for(const [table,payload] of fixtures) {
    const rowId=await insert(table,payload);
    let logs=(await db.query("select * from public.activity_logs where entity_type=$1 and entity_id=$2 order by created_at,id",[table,rowId])).rows;
    assert.equal(logs.length,1,table);assert.equal(logs[0].action_type,"create");
    await db.query(`update public.${table} set ${Object.hasOwn(payload,"name")?"name=name||' güncel'":"notes='güncellendi'"} where id=$1`,[rowId]);
    await db.query(`delete from public.${table} where id=$1`,[rowId]);
    logs=(await db.query("select * from public.activity_logs where entity_type=$1 and entity_id=$2",[table,rowId])).rows;
    assert.deepEqual(logs.map(r=>r.action_type).sort(),["create","delete","update"],table);
    assert.ok(logs.every(r=>r.actor_user_id===user && r.actor_name==="Test Yönetici" && r.created_at),table);
    assert.ok(logs.every(r=>!Object.hasOwn(r.metadata,"old_is_paid")&&!Object.hasOwn(r.metadata,"new_is_paid")),table);
  }
  const purchase=await insert("purchases",{supplier_name:"Tedarikçi",product_id:product,quantity_kg:1000,unit_buy_price:12,is_paid:false});
  await db.query("update purchases set is_paid=true where id=$1",[purchase]);
  const paymentLog=(await db.query("select * from activity_logs where entity_id=$1 and module='payments'",[purchase])).rows[0];
  assert.deepEqual(paymentLog.metadata,{old_is_paid:false,new_is_paid:true});
  assert.match(paymentLog.description,/Ödenmedi → Ödendi/);
  await db.query("update purchases set status='cancelled' where id=$1",[purchase]);
  await db.query("update purchases set status='active' where id=$1",[purchase]);
  await db.query("delete from purchases where id=$1",[purchase]);
  assert.deepEqual((await db.query("select action_type from activity_logs where entity_id=$1",[purchase])).rows.map(r=>r.action_type).sort(),["cancel","create","delete","restore","update"]);
  // Fire permits zero monetary expense, but must still audit its lost kg.
  const fire=await insert("cold_storage_expenses",{title:"Fire",category:"Fire",amount:0,product_name:"Nar",loss_kg:25});
  const fireLog=(await db.query("select * from activity_logs where entity_id=$1",[fire])).rows[0];
  assert.equal(Number(fireLog.quantity),25);assert.equal(Number(fireLog.amount),0);
  const cold=await insert("cold_storage_purchases",fixtures[0][1]);
  await db.query("update cold_storage_purchases set status='cancelled' where id=$1",[cold]);
  await db.query("update cold_storage_purchases set status='active' where id=$1",[cold]);
  assert.deepEqual((await db.query("select action_type from activity_logs where entity_id=$1",[cold])).rows.map(r=>r.action_type).sort(),["cancel","create","restore"]);
  console.log(`Shared audit PostgreSQL: reproduced the previous missing-field failure, then INSERT/UPDATE/DELETE passed for ${fixtures.length} non-payment table shapes; payment audit, cancellation/restore and zero-cost cold-storage fire passed.`);
} catch(error) { console.error(error.message,error.code||"",error.where||"");process.exitCode=1; }
finally { await db.close(); }

// Exercise the real Payments React component with an isolated RPC transport.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,unlinkSync} from "node:fs";
import ts from "typescript";
import {Window} from "happy-dom";
const target="components/.payments-panel-test.mjs",support="components/.payments-support-test.mjs";
const source=readFileSync("components/payments.tsx","utf8").replace(/from "@\/(?:components\/[^"]+|lib\/(?:supabase|date-range))"/g,'from "./.payments-support-test.mjs"').replace('from "@/lib/payments"','from "../lib/payments.ts"');
writeFileSync(target,ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
writeFileSync(support,`import React,{useState} from 'react';
export const Input=({onChange,...props})=>React.createElement('input',{...props,onInput:onChange});
export const Button=(props)=>React.createElement('button',props);
export const Dialog=({open,children})=>open?React.createElement('div',{role:'dialog'},children):null;
export const DialogContent=({children})=>React.createElement('div',{},children);
export const DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;
export const DateRangeFilter=()=>null;
export const useRememberedDateRange=()=>{const [range,setRange]=useState({start:'',end:''});return {range,setRange};};
export const calls=[],records=Array.from({length:12},(_,i)=>({id:String(i),supplier_name:'Murat',product_name:'Mandalina',vehicle_plate:'01 ABC 123',quantity_kg:100,unit_buy_price:8,total_buy_amount:800,transaction_at:'2026-10-13T06:30:00Z',is_paid:i<5}));
const totals=rows=>({people:rows.length?1:0,kg:rows.length*100,amount:rows.length*800});
export const supabase={channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:async()=>{},
rpc:async(name,args)=>{calls.push({name,args});if(name==='set_gurminik_purchase_payment'){records.find(r=>r.id===args.p_id).is_paid=args.p_paid;return {data:true,error:null};}
if(name==='get_gurminik_payment_detail')return {data:records.find(r=>r.id===args.p_id),error:null};
const q=args.p_search.toLocaleLowerCase('tr-TR');const rows=records.filter(r=>(args.p_status==='all'||r.is_paid===(args.p_status==='paid'))&&(!q||(r.supplier_name+' '+r.product_name+' '+r.vehicle_plate).toLocaleLowerCase('tr-TR').includes(q))).slice().reverse();
const page=Math.min(args.p_page,Math.max(1,Math.ceil(rows.length/10)));return {error:null,data:{count:rows.length,page,rows:rows.slice((page-1)*10,page*10),total:totals(rows),paid:totals(rows.filter(r=>r.is_paid)),unpaid:totals(rows.filter(r=>!r.is_paid))}};}};`);
const window=new Window({url:"http://localhost/"});
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,Event:window.Event,
  MutationObserver:window.MutationObserver,localStorage:window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,"navigator",{value:window.navigator,configurable:true});
try {
  const React=await import("react"),{createRoot}=await import("react-dom/client");
  const {Payments}=await import("../components/.payments-panel-test.mjs"),{calls}=await import("../components/.payments-support-test.mjs");
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const flush=()=>React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
  const click=async(label)=>{await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label).click());await flush();};
  let changed;
  await React.act(async()=>root.render(React.createElement(Payments,{userId:"test",canUpdate:true,onChanged:(id,paid)=>{changed={id,paid};}})));
  await flush();assert.equal(document.querySelectorAll('tbody tr').length,10);
  assert.match(host.textContent,/9.600/);assert.match(host.textContent,/1–10 \/ 12/);
  await click("Sonraki");assert.equal(document.querySelectorAll('tbody tr').length,2);assert.match(host.textContent,/9.600/);
  await click("Ödenenler");assert.equal(document.querySelectorAll('tbody tr').length,5);assert.match(host.textContent,/4.000/);
  assert.equal(localStorage.getItem('gurminik_payment_tab_v1:test'),'paid');
  await click("Ödenmeyenler");assert.equal(document.querySelectorAll('tbody tr').length,7);assert.match(host.textContent,/5.600/);
  await React.act(async()=>{const select=document.querySelector('tbody select');select.value='true';select.dispatchEvent(new Event('change',{bubbles:true}));});await flush();
  assert.equal(changed.paid,true);assert.equal(document.querySelectorAll('tbody tr').length,6);assert.match(host.textContent,/4.800/);
  assert.equal(calls.find(c=>c.name==='set_gurminik_purchase_payment').args.p_expected_paid,false);
  await click("Aç");assert.ok(document.querySelector('[role=dialog]'));assert.match(host.textContent,/Alış kaydı/);
  await React.act(async()=>{const input=document.querySelector('input');input.value='bulunamayan';input.dispatchEvent(new Event('input',{bubbles:true}));});await flush();
  assert.equal(document.querySelectorAll('tbody tr').length,0);assert.match(host.textContent,/0 kayıt/);
  await React.act(async()=>root.unmount());window.happyDOM.abort();
  console.log("Payments panel DOM: server-page rendering, whole-result summaries, tabs, remembered tab, status RPC/refresh, detail and search-empty pagination passed (mock transport).");
} finally {unlinkSync(target);unlinkSync(support);}

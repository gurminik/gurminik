import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import ts from "typescript";
import { Window } from "happy-dom";
import { paymentDateBounds, purchasePaymentValue } from "../lib/payments.ts";

const page=readFileSync("app/page.tsx","utf8");
const extract=(name,next)=>page.slice(page.indexOf(`function ${name}(`),page.indexOf(`function ${next}(`));
const target="./components/.payment-forms-test.mjs";
const source=`import React,{useState,useRef} from 'react';
import {MobileNumberInput} from './.payment-keypad-test.mjs';
const Input=(props)=>React.createElement('input',props);
const Button=(props)=>React.createElement('button',props);
const CrateReturnField=()=>null;
const Save=()=>null,PhoneCall=()=>null;
const norm=(v)=>v.trim().toLocaleLowerCase('tr-TR');
const localNow=()=> '2026-10-13T10:00';
const mobileLastProductKey=(u,k)=>u+':'+k;
${extract("PaymentStatusField","PurchaseTable")}
${extract("QuickFavoritePurchase","Expenses")}
${extract("PurchaseEntryForm","SaleEntryForm")}
export {PaymentStatusField,QuickFavoritePurchase,PurchaseEntryForm};`;
const compile=(s)=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const keypad="./components/.payment-keypad-test.mjs";
writeFileSync(target,compile(source)); writeFileSync(keypad,compile(readFileSync("components/mobile-number-input.tsx","utf8")));
const window=new Window({url:"http://localhost/"});
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,
  Event:window.Event,FormData:window.FormData,PointerEvent:window.PointerEvent,TouchEvent:window.TouchEvent,
  MutationObserver:window.MutationObserver,localStorage:window.localStorage,requestAnimationFrame:window.requestAnimationFrame.bind(window),
  cancelAnimationFrame:window.cancelAnimationFrame.bind(window),matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
  IS_REACT_ACT_ENVIRONMENT:true});
try {
  const React=await import("react"),{createRoot}=await import("react-dom/client");
  const {PaymentStatusField,QuickFavoritePurchase,PurchaseEntryForm}=await import("../components/.payment-forms-test.mjs");
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const state={products:[{id:"mandalina",name:"Mandalina",isActive:true}],purchases:[{
    id:"old",productId:"mandalina",person:"Hasan",plate:"01 ABC 123",kg:100,buyPrice:8,status:"active",isPaid:true,
  }],crateAccounts:[]};
  let payload;
  for(const compactMobile of [false,true]) {
    for(const paid of [false,true]) {
      await React.act(async()=>root.render(React.createElement(PurchaseEntryForm,{key:`${compactMobile}:${paid}`,state,productId:"mandalina",userId:"user",compactMobile,saving:false,
        submit:(e)=>{e.preventDefault();payload=Object.fromEntries(new FormData(e.currentTarget));}})));
      const form=document.querySelector("form");
      assert.equal(form.querySelector('[name=isPaid][value=false]').checked,true,"normal and mobile default unpaid");
      if(paid) await React.act(async()=>form.querySelector('[name=isPaid][value=true]').click());
      assert.equal(form.querySelectorAll('[name=isPaid]:checked').length,1,"mutually exclusive selection");
      await React.act(async()=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
      assert.equal(payload.isPaid,String(paid));
      assert.equal(purchasePaymentValue(payload.isPaid),paid);
    }
    for(const paid of [false,true]) {
      payload=null;
      await React.act(async()=>root.render(React.createElement(QuickFavoritePurchase,{key:`quick:${compactMobile}:${paid}`,state,
        favorite:{id:"fav",person:"Hasan",plate:"01 ABC 123",lastProductId:"mandalina"},userId:"user",compactMobile,
        onSaved:()=>{},mutate:async(action,data)=>{assert.equal(action,"addPurchase");payload=data;}})));
      const form=document.querySelector("form");
      assert.equal(form.querySelector('[name=isPaid][value=false]').checked,true,"favorite default unpaid");
      if(paid) await React.act(async()=>form.querySelector('[name=isPaid][value=true]').click());
      await React.act(async()=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
      assert.equal(payload.isPaid,String(paid));
      assert.equal(payload.person,"Hasan");assert.equal(payload.productId,"mandalina");
    }
  }
  await React.act(async()=>root.render(React.createElement("form",{},React.createElement(PaymentStatusField,{defaultPaid:true,disabled:true}))));
  assert.equal(new FormData(document.querySelector("form")).get("isPaid"),"true","unauthorized edit retains historical status");
  assert.equal(document.querySelectorAll('[type=radio]:disabled').length,2);
  assert.equal(purchasePaymentValue(false),false);assert.equal(purchasePaymentValue(undefined),false);assert.equal(purchasePaymentValue(true),true);
  assert.deepEqual(paymentDateBounds({start:"2026-10-01",end:"2026-10-31"}),{
    start:"2026-09-30T21:00:00.000Z",end:"2026-10-31T21:00:00.000Z",
  });
  assert.deepEqual(paymentDateBounds({start:"2026-10-31",end:"2026-10-01"}),paymentDateBounds({start:"2026-10-01",end:"2026-10-31"}));
  await React.act(async()=>root.unmount());window.happyDOM.abort();
  console.log("Payments DOM: normal/mobile/favorite defaults, paid/unpaid payloads, exclusive selection, locked edit preservation, offline boolean parsing and Turkey date bounds passed.");
} finally {unlinkSync(target);unlinkSync(keypad);}

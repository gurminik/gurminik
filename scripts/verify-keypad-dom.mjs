import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';
const source = readFileSync('./components/mobile-number-input.tsx','utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const target = './components/.keypad-test.mjs';
writeFileSync(target,compiled);
try {
  const window = new Window({url:'http://localhost/'});
  Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,Event:window.Event,FormData:window.FormData,PointerEvent:window.PointerEvent,TouchEvent:window.TouchEvent,MutationObserver:window.MutationObserver,matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),IS_REACT_ACT_ENVIRONMENT:true});
  const React = await import('react');
  const {createRoot} = await import('react-dom/client');
  const {MobileNumberInput}=await import('../components/.keypad-test.mjs');
  let submitCount=0, controlled='';
  function App(){const [value,setValue]=React.useState('');controlled=value;return React.createElement('form',{onSubmit:e=>{e.preventDefault();submitCount++}},
    React.createElement('label',{},'Alış KG',React.createElement(MobileNumberInput,{name:'kg',value,onChange:e=>setValue(e.target.value)})),
    React.createElement('label',{},'Alış Fiyatı',React.createElement(MobileNumberInput,{name:'buyPrice'})),
    React.createElement('label',{},'Satış KG',React.createElement(MobileNumberInput,{name:'saleKg'})),
    React.createElement('label',{},'Satış Fiyatı',React.createElement(MobileNumberInput,{name:'sellPrice'})),
    React.createElement('label',{},'Tarih',React.createElement('input',{name:'date',type:'datetime-local',onFocus:()=>{throw new Error('Takvim odaklandı')}})),
    React.createElement('button',{type:'submit'},'Kaydet'))}
  const host=document.createElement('div'); document.body.append(host);const root=createRoot(host);
  await React.act(async()=>root.render(React.createElement(App)));
  const input=document.querySelector('[name=kg]');
  await React.act(async()=>input.focus());
  assert.equal(document.querySelectorAll('.gurminik-number-pad').length,1);
  for(const digit of ['1','2','3']) {
    const button=[...document.querySelectorAll('.gurminik-number-pad-grid button')].find(x=>x.textContent===digit);
    await React.act(async()=>{
      button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      button.dispatchEvent(new TouchEvent('touchstart',{bubbles:true}));
      button.dispatchEvent(new TouchEvent('touchend',{bubbles:true}));
      button.click();
    });
  }
  assert.equal(input.value,'123'); assert.equal(controlled,'123');assert.equal(submitCount,0);
  await React.act(async()=>document.querySelector('.gurminik-number-pad-done').click());
  assert.equal(document.querySelector('.gurminik-number-pad'),null);
  assert.equal(input.value,'123');assert.equal(submitCount,0);
  for(const name of ['buyPrice','saleKg','sellPrice']) {
    const field=document.querySelector(`[name=${name}]`);
    await React.act(async()=>field.focus());
    for(const digit of ['6','Virgül','5']) {
      const button=[...document.querySelectorAll('.gurminik-number-pad-grid button')].find(x=>x.textContent===digit);
      await React.act(async()=>button.click());
    }
    assert.equal(field.value,'6.5');
    await React.act(async()=>document.querySelector('.gurminik-number-pad-done').click());
    assert.equal(field.value,'6.5');assert.equal(submitCount,0);
  }
  assert.equal(new FormData(document.querySelector('form')).get('kg'),'123');
  assert.equal(new FormData(document.querySelector('form')).get('saleKg'),'6.5');
  assert.equal(new FormData(document.querySelector('form')).get('buyPrice'),'6.5');
  assert.equal(new FormData(document.querySelector('form')).get('sellPrice'),'6.5');
  await React.act(async()=>document.querySelector('[type=submit]').click());
  assert.equal(submitCount,1);
  await React.act(async()=>root.unmount());window.happyDOM.abort();
  console.log('DOM: pointer/touch/click, kontrollü ve serbest alanlar, Tamam, tarih odağı, yalnız Kaydet submit: başarılı');
} finally {unlinkSync(target)}

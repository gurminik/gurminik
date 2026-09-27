"use client";

import { FormEvent, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MobileNumberInput } from "@/components/mobile-number-input";

export type CrateAccount = { id:string; name:string; contactId:string|null; balance:number; updatedAt:string };
export type CrateMovement = { id:string; accountId:string; type:string; delta:number; balanceAfter:number; actor:string; createdAt:string; purchaseId:string|null };
type Contact = {id:string;name:string;phone:string};
const same = (a:string,b:string) => a.trim().toLocaleLowerCase("tr-TR")===b.trim().toLocaleLowerCase("tr-TR");
const integer = (value:string) => /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value));

export function CrateReturnField({accounts,person,initialAccountId,initialQuantity=0,compact=false}:{accounts:CrateAccount[];person:string;initialAccountId?:string|null;initialQuantity?:number;compact?:boolean}) {
  const matches=accounts.filter(a=>same(a.name,person));
  const [choice,setChoice]=useState(initialAccountId||"");
  const [quantity,setQuantity]=useState(initialQuantity ? String(initialQuantity) : "");
  const account=matches.find(a=>a.id===choice)|| (matches.length===1?matches[0]:null);
  return <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-zinc-900">
    <label className="grid gap-1 font-semibold">Getirilen Kasa
      <MobileNumberInput name="returnedCrates" forceKeypad={compact} step="1" min="0" value={quantity} onChange={e=>setQuantity(e.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-base" />
    </label>
    {matches.length>1 && <label className="grid gap-1">Kasa hesabı
      <select value={choice} onChange={e=>setChoice(e.target.value)} className="h-10 rounded-md border bg-white px-2" required={Number(quantity)>0}>
        <option value="">Kişiyi seçin</option>{matches.map(a=><option key={a.id} value={a.id}>{a.name} · {a.balance} kasa {a.contactId?"(rehber)":""}</option>)}
      </select>
    </label>}
    <input type="hidden" name="crateAccountId" value={account?.id||""} />
    <span className="text-zinc-600">Açık Kasa: <strong>{account?.balance ?? 0}</strong>{matches.length>1&&!account?" · Aynı isimde birden çok hesap var.":""}</span>
    {quantity && (!integer(quantity) || Number(quantity)>(account?.balance||0)+(initialAccountId===account?.id?initialQuantity:0)) && <span role="alert" className="text-red-700">Geçerli tam sayı girin; açık kasa miktarını aşamazsınız.</span>}
  </div>;
}

export function CrateTracking({accounts,movements,contacts,permission,mutate,compact=false}:{accounts:CrateAccount[];movements:CrateMovement[];contacts:Contact[];permission:{can_create:boolean;can_update:boolean;can_delete:boolean};mutate:(action:string,data:Record<string,unknown>)=>Promise<void>;compact?:boolean}) {
  const [search,setSearch]=useState("");
  const [choice,setChoice]=useState("");
  const [person,setPerson]=useState("");
  const [quantity,setQuantity]=useState("");
  const [mode,setMode]=useState<"given"|"returned">("given");
  const [editing,setEditing]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const displayed=useMemo(()=>accounts.filter(a=>a.name.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR"))).sort((a,b)=>Number(b.balance>0)-Number(a.balance>0)||Date.parse(b.updatedAt)-Date.parse(a.updatedAt)),[accounts,search]);
  const openCount=accounts.filter(a=>a.balance>0).length;
  const total=accounts.reduce((sum,a)=>sum+a.balance,0);
  const account=accounts.find(a=>a.id===choice);
  const contact=contacts.find(c=>`contact:${c.id}`===choice);
  const chosenName=account?.name||contact?.name||person.trim();
  const nameMatches=!choice?accounts.filter(a=>same(a.name,person)):[];
  const accountId=account?.id || (contact && accounts.find(a=>a.contactId===contact.id)?.id) || (nameMatches.length===1?nameMatches[0].id:null);
  function open(account?:CrateAccount) {setChoice(account?.id||"");setPerson("");setQuantity("");setMode("given");setError("");setEditing(true);}
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(saving)return;
    if(!chosenName || !integer(quantity) || Number(quantity)<=0) {setError("Kişi ve pozitif tam kasa adedi girin.");return;}
    if(nameMatches.length>1) {setError("Aynı isimde birden fazla kişi var. Listeden doğru hesabı seçin.");return;}
    setSaving(true);setError("");
    try {await mutate("crateChange",{id:crypto.randomUUID(),accountId:accountId || crypto.randomUUID(),contactId:contact?.id||account?.contactId||null,person:chosenName,quantity:Number(quantity),kind:mode});setEditing(false);}
    catch(e){setError(e instanceof Error?e.message:"Kasa kaydedilemedi.");}finally{setSaving(false);}
  }
  async function finish(account:CrateAccount) {
    if(!window.confirm("Bu kişinin tüm kasaları geri geldi olarak işaretlenecek. Devam edilsin mi?"))return;
    try {await mutate("crateChange",{id:crypto.randomUUID(),accountId:account.id,person:account.name,quantity:0,kind:"completed"});}
    catch(e){setError(e instanceof Error?e.message:"Kasa tamamlanamadı.");}
  }
  const movementLabels:Record<string,string>={given:"Kasa verildi",returned:"Kasa geri geldi",completed:"Hesap tamamlandı",purchase_return:"Alışta kasa iadesi",purchase_reversal:"Alış iptali / iade geri alındı",purchase_adjustment:"Alış düzeltmesi"};
  return <div className="grid gap-4 text-zinc-900">
    <header className="gurminik-panel grid gap-3 p-4 sm:grid-cols-2">
      <div><small>Açık Kasa Olan Kişi</small><strong className="block text-2xl">{openCount}</strong></div>
      <div><small>Toplam Açık Kasa</small><strong className="block text-2xl">{total.toLocaleString("tr-TR")}</strong></div>
    </header>
    <div className="flex flex-wrap items-center gap-2">
      {permission.can_create && <Button type="button" onClick={()=>open()}>+ Kasa Girişi Yap</Button>}
      <Input aria-label="Kişi ara" placeholder="Kişi ara…" value={search} onChange={e=>setSearch(e.target.value)} className="min-w-0 flex-1 bg-white" />
    </div>
    {error&&!editing&&<p role="alert" className="text-red-700">{error}</p>}
    {editing&&<form onSubmit={save} className="gurminik-panel grid gap-3 p-4">
      <h3 className="font-bold">Kasa Girişi Yap</h3>
      <label className="grid gap-1">Kişi
        <select aria-label="Kişi seç" value={choice} onChange={e=>setChoice(e.target.value)} className="h-11 rounded-md border bg-white px-2">
          <option value="">Yeni kişi adı yaz</option>
          {accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.balance} kasa</option>)}
          {contacts.filter(c=>!accounts.some(a=>a.contactId===c.id)).map(c=><option key={c.id} value={`contact:${c.id}`}>{c.name} · {c.phone||"Rehber"}</option>)}
        </select>
        {!choice&&<Input aria-label="Yeni kişi adı" value={person} onChange={e=>setPerson(e.target.value)} placeholder="Kişi adı" required />}
      </label>
      {account&&<span className="text-sm">Açık Kasa: {account.balance}</span>}
      {(permission.can_update&&account)&&<div className="flex gap-2"><button type="button" onClick={()=>setMode("given")} className={`rounded-lg border px-3 py-2 ${mode==="given"?"bg-zinc-900 text-white":"bg-white"}`}>Kasa ver</button><button type="button" onClick={()=>setMode("returned")} className={`rounded-lg border px-3 py-2 ${mode==="returned"?"bg-zinc-900 text-white":"bg-white"}`}>Geri al</button></div>}
      <label className="grid gap-1">{mode==="given"?"Verilen kasa adedi":"Geri alınan kasa adedi"}
        <MobileNumberInput forceKeypad={compact} step="1" min="1" value={quantity} onChange={e=>setQuantity(e.target.value)} required className="h-11 w-full rounded-md border bg-white px-3 text-base" />
      </label>
      {error&&<p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving?"Kaydediliyor…":"Kaydet"}</Button><Button type="button" variant="outline" onClick={()=>setEditing(false)}>Vazgeç</Button></div>
    </form>}
    <div className={compact?"grid gap-2":"grid gap-3"}>
      {displayed.map(a=><article key={a.id} className={`gurminik-panel flex flex-wrap items-center gap-3 ${compact?"p-3":"p-4"} ${a.balance===0?"opacity-70":""}`}>
        <div className="min-w-0 flex-1"><strong className="block truncate">{a.name}</strong><small>{new Date(a.updatedAt).toLocaleString("tr-TR")}</small></div>
        <strong className="whitespace-nowrap">{a.balance} kasa</strong>
        {permission.can_update&&<button type="button" onClick={()=>open(a)} className="rounded-lg border px-2 py-1">Düzenle</button>}
        {permission.can_delete&&a.balance>0&&<button type="button" onClick={()=>void finish(a)} className="rounded-lg border px-2 py-1">Bitir</button>}
        <button type="button" onClick={()=>setSelected(selected===a.id?null:a.id)} className="text-sm underline">Geçmiş</button>
        {selected===a.id&&<div className="w-full border-t pt-2 text-sm">{movements.filter(m=>m.accountId===a.id).map(m=><div key={m.id} className="flex justify-between gap-2 py-1"><span>{movementLabels[m.type]||m.type} · {m.actor}</span><span>{m.delta>0?"+":""}{m.delta} · kalan {m.balanceAfter} · {new Date(m.createdAt).toLocaleString("tr-TR")}</span></div>)}</div>}
      </article>)}
      {!displayed.length&&<div className="gurminik-panel p-4">Kasa kaydı bulunamadı.</div>}
    </div>
  </div>;
}

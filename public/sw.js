// Bump the shell cache when the deployed application changes.
// Offline records live in localStorage and are never cleared by this worker.
const CACHE_NAME="gurminik-shell-v9";
const APP_SHELL=["/manifest.webmanifest","/favicon.svg","/icon-192.png","/icon-512.png"];

async function cacheApplicationShell(){
  const cache=await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
  const response=await fetch("/",{credentials:"include",cache:"reload"});
  if(!response.ok)return;
  await cache.put("/",response.clone());
  const html=await response.text();
  const assetUrls=[...html.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g)].map(match=>match[1]);
  await Promise.all([...new Set(assetUrls)].map(url=>cache.add(url).catch(()=>undefined)));
}

self.addEventListener("install",event=>{
  event.waitUntil(cacheApplicationShell().then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener("fetch",event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin)return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request,{cache:"no-store"}).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));return response}).catch(()=>caches.match(request).then(found=>found||caches.match("/"))));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok&&url.pathname.startsWith("/_next/static/")){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}return response})));
});

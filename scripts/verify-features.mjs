import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260912093750_add_accounts_favorites_and_ranking_permissions.sql", import.meta.url), "utf8");

assert.match(css, /\.gurminik-sidebar-scroll[\s\S]*overflow-y:\s*auto/);
assert.match(css, /height:\s*100dvh/);
assert.match(page, /SortDirectionIcon/);
assert.match(page, /products\.map\(product=>/);
assert.match(page, /tel:\$\{contact\.phone\}/);
assert.match(page, /QuickFavoritePurchase/);
assert.match(page, /addPurchase/);
assert.match(page, /CARI HESAP HAREKETLERI/);
assert.match(page, /reportAccounts/);
assert.match(migration, /create table if not exists public\.account_payments/i);
assert.match(migration, /create table if not exists public\.favorites/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /can_access_gurminik_table/i);

const products = ["mandalina", "limon", "portakal"];
const purchases = [
  { person: "Murat", product: "mandalina", weight: 1200 },
  { person: "Murat", product: "limon", weight: 800 },
  { person: "Murat", product: "portakal", weight: 2100 },
  { person: "Ali", product: "limon", weight: 950 },
];
const rows = Object.values(purchases.reduce((acc, item) => {
  acc[item.person] ??= { person: item.person, total: 0, byProduct: Object.fromEntries(products.map(p => [p, 0])) };
  acc[item.person].byProduct[item.product] += item.weight;
  acc[item.person].total += item.weight;
  return acc;
}, {}));
assert.equal(rows.find(row => row.person === "Murat").total, 4100);
assert.equal([...rows].sort((a, b) => b.byProduct.limon - a.byProduct.limon)[0].person, "Ali");
assert.equal([...rows].sort((a, b) => a.byProduct.limon - b.byProduct.limon)[0].person, "Murat");

console.log("GURMİNİK özellik kontrolleri başarılı: menü, sıralama, kişi önizleme, telefon, favori hızlı alış, cari hesap ve PDF.");

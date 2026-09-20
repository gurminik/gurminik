import assert from "node:assert/strict";
import { buildPriceHistory, driverMatches, findRecentDuplicate, latestSalePrice, summarizeTransactions } from "../lib/business.ts";
import { fetchAllRows } from "../lib/pagination.ts";

const date = "2026-09-20T10:00:00.000Z";
const purchases = [
  { id: "p1", productId: "limon", person: "Murat", plate: "33 ABC 123", kg: 1000, buyPrice: 8, dateTime: date, status: "active" },
  { id: "p2", productId: "limon", person: "Murat", plate: "33 ABC 123", kg: 3000, buyPrice: 10, dateTime: "2026-09-21T10:00:00.000Z", status: "active" },
  { id: "p3", productId: "limon", person: "Murat", plate: "33 ABC 123", kg: 10000, buyPrice: 50, dateTime: date, status: "cancelled" },
];
const sales = [
  { id: "s1", productId: "limon", buyer: "GETA", driver: "Ahmet", plate: "33 ABC 123", kg: 1000, sellPrice: 18, dateTime: date, status: "active" },
  { id: "s2", productId: "limon", buyer: "GETA", driver: "Ahmet", plate: "33 XYZ 789", kg: 3000, sellPrice: 20, dateTime: "2026-09-21T10:00:00.000Z", status: "active" },
  { id: "s3", productId: "limon", buyer: "Başka", driver: "Mehmet", plate: "01 A 1", kg: 2000, sellPrice: 19, dateTime: "2026-09-22T10:00:00.000Z", status: "active" },
  { id: "s4", productId: "limon", buyer: "GETA", driver: "Ahmet", plate: "33 XYZ 789", kg: 100, sellPrice: 99, dateTime: "2026-09-23T10:00:00.000Z", status: "cancelled" },
];

const buying = summarizeTransactions(purchases, row => row.buyPrice);
assert.deepEqual(buying, { count: 2, totalKg: 4000, totalAmount: 38000, average: 9.5 });
const ahmet = summarizeTransactions(sales.filter(row => row.driver === "Ahmet"), row => row.sellPrice);
assert.deepEqual(ahmet, { count: 2, totalKg: 4000, totalAmount: 78000, average: 19.5 });
assert.equal(latestSalePrice(sales, "limon", "GETA"), 20);
assert.equal(latestSalePrice(sales, "limon", "YENİ"), 19);
assert.deepEqual(driverMatches(sales, "ahm"), [{ name: "Ahmet", plate: "33 XYZ 789" }]);
assert.equal(findRecentDuplicate(purchases, { ...purchases[0], id: "p5", person: " MURAT ", plate: "33ABC123", dateTime: "2026-09-20T10:03:00.000Z" }, "purchase")?.id, "p1");
assert.equal(findRecentDuplicate(sales, { ...sales[0], id: "s5", buyer: "geta", driver: "ahmet", dateTime: "2026-09-20T10:02:00.000Z" }, "sale")?.id, "s1");
assert.equal(findRecentDuplicate(sales, { ...sales[0], id: "s6", dateTime: "2026-09-20T10:10:00.000Z" }, "sale"), undefined);
assert.equal(findRecentDuplicate(sales, { ...sales[0], id: "s7", kg: 1500 }, "sale"), undefined);

const history = buildPriceHistory([...purchases, { ...purchases[1], id: "p4", kg: 500, dateTime: "2026-09-22T12:00:00.000Z" }], sales, "limon");
assert.equal(history.length, 3);
assert.deepEqual(history.at(-1), { dateTime: "2026-09-22T10:00:00.000Z", buyPrice: 10, sellPrice: 19, purchaseKg: 4000, saleKg: 6000 });
assert.equal(history[0].buyPrice, 8);
assert.equal(history[0].purchaseKg, 1000);

const largeDirectory = Array.from({ length: 6001 }, (_, id) => ({ id }));
const pages = await fetchAllRows(async (from, to) => ({ data: largeDirectory.slice(from, to + 1), error: null }));
assert.equal(pages.data.length, 6001);
assert.equal(pages.data.at(-1)?.id, 6000);

console.log("İşlem kontrolleri geçti: ağırlıklı ortalama, filtre, son fiyat, kamyoncu plakası, çift kayıt ve fiyat geçmişi.");

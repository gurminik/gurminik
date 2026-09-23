import assert from "node:assert/strict";
import { dateRangeBounds, inRememberedDateRange } from "../lib/date-range.ts";
import { coldSummary } from "../lib/cold-storage.ts";
import { createColdPdf } from "../lib/cold-pdf.ts";

const range = { start: "2026-09-01", end: "2026-09-30" };
const bounds = dateRangeBounds(range);
assert.equal(inRememberedDateRange("2026-09-01T00:00:00", range), true);
assert.equal(inRememberedDateRange("2026-09-30T23:59:59", range), true);
assert.equal(inRememberedDateRange("2026-10-01T00:00:00", range), false);

const state = {
  purchases: [
    {
      id: "p1",
      product: "Limon",
      person: "Murat",
      plate: "01 ABC 123",
      kg: 10000,
      price: 12,
      dateTime: "2026-09-05T10:00:00",
      note: "",
      status: "active",
    },
    {
      id: "p2",
      product: "Limon",
      person: "Murat",
      plate: "01 ABC 123",
      kg: 999,
      price: 12,
      dateTime: "2026-09-06T10:00:00",
      note: "",
      status: "cancelled",
    },
  ],
  sales: [
    {
      id: "s1",
      product: "Limon",
      buyer: "GETA",
      kg: 8000,
      price: 18,
      dateTime: "2026-09-10T10:00:00",
      note: "",
      status: "active",
    },
  ],
  expenses: [
    {
      id: "e1",
      title: "Fire",
      category: "Fire",
      amount: 1000,
      product: "Limon",
      lossKg: 350,
      dateTime: "2026-09-12T10:00:00",
      note: "Ezilme",
    },
    {
      id: "e2",
      title: "Elektrik",
      category: "Elektrik",
      amount: 2000,
      product: "",
      lossKg: 0,
      dateTime: "2026-09-15T10:00:00",
      note: "",
    },
    {
      id: "e3",
      title: "Fire",
      category: "Fire",
      amount: 500,
      product: "Siyah Erik",
      lossKg: 200,
      dateTime: "2026-09-20T10:00:00",
      note: "",
    },
    {
      id: "e4",
      title: "Elektrik",
      category: "Elektrik",
      amount: 9999,
      product: "",
      lossKg: 0,
      dateTime: "2026-10-02T10:00:00",
      note: "",
    },
  ],
  categories: [],
};

const summary = coldSummary(state, bounds.start, bounds.end, "Limon");
assert.equal(summary.buyKg, 10000);
assert.equal(summary.buyCost, 120000);
assert.equal(summary.saleKg, 8000);
assert.equal(summary.revenue, 144000);
assert.equal(summary.averageBuy, 12);
assert.equal(summary.averageSale, 18);
assert.equal(summary.fireKg, 350);
assert.equal(summary.expenses, 3000);
assert.equal(summary.costOfGoods, 96000);
assert.equal(summary.profit, 45000);
assert.equal(summary.profitPerKg, 5.625);

const all = coldSummary(state, bounds.start, bounds.end);
assert.equal(all.fireKg, 550);

const costState = {
  products: [{id:"cp1",name:"Limon",isActive:true},{id:"cp2",name:"Nar",isActive:true}],
  categories: [],
  purchases: [
    {id:"p1",productId:"cp1",product:"Limon",person:"M",plate:"",kg:10000,price:10,dateTime:"2026-09-01T08:00:00",note:"",status:"active"},
    {id:"p2",productId:"cp2",product:"Nar",person:"A",plate:"",kg:5000,price:20,dateTime:"2026-09-01T09:00:00",note:"",status:"active"},
  ],
  sales: [
    {id:"s1",productId:"cp1",product:"Limon",buyer:"G",kg:8000,price:18,dateTime:"2026-09-10T08:00:00",note:"",status:"active"},
    {id:"s2",productId:"cp2",product:"Nar",buyer:"G",kg:2000,price:30,dateTime:"2026-09-10T09:00:00",note:"",status:"active"},
  ],
  expenses: [
    {id:"e1",productId:"cp1",title:"Nakliye",category:"Nakliye",amount:8000,product:"Limon",lossKg:0,scope:"purchase",dateTime:"2026-09-02T08:00:00",note:""},
    {id:"e2",productId:"cp1",title:"Sevkiyat",category:"Nakliye",amount:4000,product:"Limon",lossKg:0,scope:"sale",dateTime:"2026-09-11T08:00:00",note:""},
    {id:"e3",productId:"",title:"Elektrik",category:"Elektrik",amount:5000,product:"",lossKg:0,scope:"general",dateTime:"2026-09-15T08:00:00",note:""},
  ],
};
const lemonCost=coldSummary(costState,bounds.start,bounds.end,"Limon");
const pomegranateCost=coldSummary(costState,bounds.start,bounds.end,"Nar");
const totalCost=coldSummary(costState,bounds.start,bounds.end);
assert.equal(lemonCost.realAverageBuy,10.8);
assert.equal(lemonCost.saleExpensePerKg,0.5);
assert.ok(Math.abs(lemonCost.generalExpenses-(5000*18000/25000))<0.001);
assert.ok(Math.abs(lemonCost.generalExpenses+pomegranateCost.generalExpenses-totalCost.generalExpenses)<0.001);
const categoryTotals = [1500, 2000];
const total = categoryTotals.reduce((a, b) => a + b, 0);
const percentSum = categoryTotals.reduce(
  (sum, value) => sum + (value / total) * 100,
  0,
);
assert.ok(Math.abs(percentSum - 100) < 0.0001);

const pdf = createColdPdf(
  state,
  bounds.start,
  bounds.end,
  "01.09.2026 - 30.09.2026",
);
assert.match(pdf, /FIRE HAREKETLERI/);
assert.match(pdf, /TOPLAM FIRE/);
assert.match(pdf, /Elektrik.*%57\.1/);

console.log(
  "Tarih aralığı, Fire, ürün filtresi, gider yüzdeleri ve Soğuk Hava PDF kontrolleri başarılı.",
);

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  backupSummary,
  formatRestoreReport,
  normalizeBackupPayload,
} from "../lib/backup.ts";

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const productId = id(1);
const fixture = normalizeBackupPayload({
  backupVersion: 2,
  createdAt: "2026-09-21T12:00:00.000Z",
  appName: "GURMİNİK",
  userId: id(99),
  schemaVersion: "2026-09-21.2",
  tables: {
    products: [{ id: productId, name: "Limon" }],
    purchases: [{ id: id(2), product_id: productId, supplier_name: "Murat", quantity_kg: 100, unit_buy_price: 10 }],
    sales: [{ id: id(3), product_id: productId, buyer_name: "GETA", quantity_kg: 80, unit_sale_price: 18 }],
    expenses: [{ id: id(4), title: "Yemek", category: "Yemek", amount: 200 }],
    expenseCategories: [{ id: id(5), name: "Yemek" }],
    contactCategories: [{ id: id(6), name: "Tedarikçi" }],
    contacts: [{ id: id(7), name: "Murat", phone: "+905321234567" }],
    accountPayments: [{ id: id(8), company_name: "GETA", amount: 1000 }],
    favorites: [{ id: id(9), person_name: "Murat", last_product_id: productId }],
    shipments: [{ id: id(10), shipment_no: "SVK-1" }],
  },
  coldStorage: {
    purchases: [{ id: id(11), product_name: "Limon", supplier_name: "Murat", quantity_kg: 50, unit_buy_price: 11 }],
    sales: [{ id: id(12), product_name: "Limon", buyer_name: "GETA", quantity_kg: 30, unit_sale_price: 19 }],
    expenses: [{ id: id(13), title: "Fire", category: "Fire", amount: 100, product_name: "Limon", loss_kg: 2 }],
    expenseCategories: [{ id: id(14), name: "Fire" }],
  },
  settings: { favoriteSort: "most_kg", dateRanges: {} },
});

assert.equal(fixture.backupVersion, 2);
assert.equal(fixture.appName, "GURMİNİK");
assert.deepEqual(backupSummary(fixture), {
  products: 1,
  purchases: 1,
  sales: 1,
  expenses: 1,
  accountPayments: 1,
  contacts: 1,
  favorites: 1,
  shipments: 1,
  coldPurchases: 1,
  coldSales: 1,
  coldExpenses: 1,
  coldFire: 1,
});

const legacy = normalizeBackupPayload([{ id: id(20), person: "Ali" }]);
assert.equal(legacy.backupVersion, 1);
assert.equal(legacy.tables.purchases.length, 1);

const report = formatRestoreReport({
  success: true,
  mode: "merge",
  sections: { sales: { added: 1, skipped: 2 } },
});
assert.match(report, /Satışlar: 1 eklendi, 2 atlandı/);

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260921143000_full_backup_restore_v2.sql", import.meta.url),
  "utf8",
);
for (const table of [
  "products",
  "purchases",
  "sales",
  "expenses",
  "expense_categories",
  "contact_categories",
  "contacts",
  "account_payments",
  "favorites",
  "shipments",
  "cold_storage_purchases",
  "cold_storage_sales",
  "cold_storage_expenses",
  "cold_storage_expense_categories",
]) assert.match(migration, new RegExp(`public\\.${table}\\b`), `${table} eksik`);
assert.match(migration, /security invoker/gi);
assert.match(migration, /owner_id\s*=\s*uid/gi);
assert.match(migration, /restore_mode\s*=\s*'replace'/);
assert.doesNotMatch(migration, /service[_ -]?role/i);

console.log("Backup v2 fixture, legacy compatibility, coverage and safety checks passed.");

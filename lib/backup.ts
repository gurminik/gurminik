export type RestoreMode = "merge" | "replace";

export type BackupPayload = {
  backupVersion: number;
  createdAt: string;
  appName: "GURMİNİK";
  userId: string;
  schemaVersion: string;
  tables: Record<string, unknown[]>;
  coldStorage: {
    products: unknown[];
    purchases: unknown[];
    sales: unknown[];
    expenses: unknown[];
    expenseCategories: unknown[];
  };
  settings: Record<string, unknown>;
};

export type BackupSummary = {
  products: number;
  purchases: number;
  sales: number;
  expenses: number;
  accountPayments: number;
  contacts: number;
  favorites: number;
  shipments: number;
  coldPurchases: number;
  coldSales: number;
  coldExpenses: number;
  coldFire: number;
  coldProducts: number;
};

export type RestoreSectionResult = { added: number; skipped: number };
export type RestoreReport = {
  success: boolean;
  mode: RestoreMode;
  sections: Record<string, RestoreSectionResult>;
};

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function normalizeBackupPayload(raw: unknown): BackupPayload {
  if (Array.isArray(raw)) raw = { records: raw };
  const root = object(raw);
  const sourceTables = object(root.tables);
  const cold = object(root.coldStorage);
  const purchases = array(
    sourceTables.purchases ?? root.purchases ?? root.records,
  );
  const tables: Record<string, unknown[]> = {
    products: array(sourceTables.products ?? root.products),
    purchases,
    sales: array(sourceTables.sales ?? root.sales),
    expenses: array(sourceTables.expenses ?? root.expenses),
    expenseCategories: array(
      sourceTables.expenseCategories ??
        sourceTables.expense_categories ??
        root.expenseCategories ??
        root.categories,
    ),
    contactCategories: array(
      sourceTables.contactCategories ??
        sourceTables.contact_categories ??
        root.contactCategories,
    ),
    contacts: array(sourceTables.contacts ?? root.contacts),
    accountPayments: array(
      sourceTables.accountPayments ??
        sourceTables.account_payments ??
        root.accountPayments,
    ),
    favorites: array(sourceTables.favorites ?? root.favorites),
    shipments: array(sourceTables.shipments ?? root.shipments),
  };
  const coldStorage = {
    products: array(cold.products ?? root.coldStorageProducts),
    purchases: array(cold.purchases ?? root.coldStoragePurchases),
    sales: array(cold.sales ?? root.coldStorageSales),
    expenses: array(cold.expenses ?? root.coldStorageExpenses),
    expenseCategories: array(
      cold.expenseCategories ?? cold.categories ?? root.coldStorageCategories,
    ),
  };
  const totalRows =
    Object.values(tables).reduce((sum, rows) => sum + rows.length, 0) +
    Object.values(coldStorage).reduce((sum, rows) => sum + rows.length, 0);
  if (!totalRows) throw new Error("Yedek dosyasında desteklenen kayıt bulunamadı.");
  return {
    backupVersion: Number(root.backupVersion ?? root.version ?? 1),
    createdAt: String(root.createdAt ?? root.exportedAt ?? ""),
    appName: "GURMİNİK",
    userId: String(root.userId ?? ""),
    schemaVersion: String(root.schemaVersion ?? "legacy"),
    tables,
    coldStorage,
    settings: object(root.settings),
  };
}

export function backupSummary(payload: BackupPayload): BackupSummary {
  const isFire = (row: unknown) => {
    const item = object(row);
    return String(item.category || "").trim().toLocaleLowerCase("tr-TR") === "fire";
  };
  return {
    products: payload.tables.products.length,
    purchases: payload.tables.purchases.length,
    sales: payload.tables.sales.length,
    expenses: payload.tables.expenses.length,
    accountPayments: payload.tables.accountPayments.length,
    contacts: payload.tables.contacts.length,
    favorites: payload.tables.favorites.length,
    shipments: payload.tables.shipments.length,
    coldPurchases: payload.coldStorage.purchases.length,
    coldSales: payload.coldStorage.sales.length,
    coldExpenses: payload.coldStorage.expenses.length,
    coldFire: payload.coldStorage.expenses.filter(isFire).length,
    coldProducts: payload.coldStorage.products.length,
  };
}

const DATE_SCOPES = [
  "dashboard",
  "purchases",
  "sales",
  "expenses",
  "accounts",
  "cold_storage",
  "activity_logs",
];

export function readBackupSettings(userId: string) {
  const dateRanges: Record<string, unknown> = {};
  for (const scope of DATE_SCOPES) {
    try {
      const value = localStorage.getItem(
        `gurminik_date_range_v1:${userId}:${scope}`,
      );
      if (value) dateRanges[scope] = JSON.parse(value);
    } catch {}
  }
  return {
    favoriteSort:
      localStorage.getItem(`gurminik_favorite_sort:${userId}`) || "",
    dateRanges,
    coldPreferences: {
      entryProduct: localStorage.getItem(`gurminik:${userId}:cold:entry-product`) || "",
      expenseProduct: localStorage.getItem(`gurminik:${userId}:cold:expense-product`) || "",
      expenseScope: localStorage.getItem(`gurminik:${userId}:cold:expense-scope`) || "general",
    },
  };
}

export function restoreBackupSettings(
  userId: string,
  settings: Record<string, unknown>,
) {
  const favoriteSort = settings.favoriteSort;
  if (typeof favoriteSort === "string" && favoriteSort)
    localStorage.setItem(`gurminik_favorite_sort:${userId}`, favoriteSort);
  const ranges = object(settings.dateRanges);
  for (const scope of DATE_SCOPES) {
    const value = ranges[scope];
    if (value && typeof value === "object")
      localStorage.setItem(
        `gurminik_date_range_v1:${userId}:${scope}`,
        JSON.stringify(value),
      );
  }
  const cold=object(settings.coldPreferences);
  for(const [name,value] of Object.entries({"entry-product":cold.entryProduct,"expense-product":cold.expenseProduct,"expense-scope":cold.expenseScope}))
    if(typeof value==="string"&&value)localStorage.setItem(`gurminik:${userId}:cold:${name}`,value);
}

export function formatRestoreReport(report: RestoreReport) {
  const labels: Record<string, string> = {
    products: "Ürünler",
    expenseCategories: "Gider kategorileri",
    contactCategories: "Rehber kategorileri",
    contacts: "Telefon numaraları",
    shipments: "Sevkiyatlar",
    purchases: "Alışlar",
    sales: "Satışlar",
    expenses: "Giderler",
    accountPayments: "Cari hesap",
    favorites: "Favoriler",
    coldExpenseCategories: "Soğuk Hava gider kategorileri",
    coldProducts: "Soğuk Hava ürünleri",
    coldPurchases: "Soğuk Hava alışları",
    coldSales: "Soğuk Hava satışları",
    coldExpenses: "Soğuk Hava gider/Fire",
  };
  return Object.entries(report.sections)
    .map(
      ([key, value]) =>
        `${labels[key] || key}: ${Number(value.added || 0)} eklendi, ${Number(value.skipped || 0)} atlandı`,
    )
    .join("\n");
}

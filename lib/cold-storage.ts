export type ColdPurchase = {
  id: string;
  productId: string;
  product: string;
  person: string;
  plate: string;
  kg: number;
  price: number;
  dateTime: string;
  note: string;
  status: string;
  cancelledAt?: string | null;
};
export type ColdSale = {
  id: string;
  productId: string;
  product: string;
  buyer: string;
  kg: number;
  price: number;
  dateTime: string;
  note: string;
  status: string;
  cancelledAt?: string | null;
};
export type ColdExpense = {
  id: string;
  productId: string;
  title: string;
  category: string;
  amount: number;
  dateTime: string;
  note: string;
  product: string;
  lossKg: number;
  scope: "purchase" | "sale" | "general";
};
export type ColdCategory = { id: string; name: string };
export type ColdProduct = { id: string; name: string; isActive: boolean };
export type ColdState = {
  purchases: ColdPurchase[];
  sales: ColdSale[];
  expenses: ColdExpense[];
  categories: ColdCategory[];
  products: ColdProduct[];
};
export const EMPTY_COLD: ColdState = {
  purchases: [],
  sales: [],
  expenses: [],
  categories: [],
  products: [],
};
export const COLD_DEFAULT_CATEGORIES = [
  "Elektrik",
  "Nakliye",
  "Çalışan",
  "Bakım / Onarım",
  "Kira",
  "Yakıt",
  "Ambalaj",
  "Yükleme / Boşaltma",
  "Fire",
  "Diğer",
];
const key = (v: string) => v.trim().toLocaleLowerCase("tr-TR");
const active = (s: { status: string }) => s.status !== "cancelled";
export function coldProducts(state: ColdState) {
  const names = new Map<string, string>();
  for (const name of [
    ...(state.products || []).filter((x) => x.isActive).map((x) => x.name),
    ...state.purchases.map((x) => x.product),
    ...state.sales.map((x) => x.product),
    ...state.expenses.map((x) => x.product).filter(Boolean),
  ])
    if (!names.has(key(name))) names.set(key(name), name.trim());
  return [...names.values()].sort((a, b) => a.localeCompare(b, "tr-TR"));
}
export function coldStockAt(state: ColdState, product: string, at = Infinity) {
  const k = key(product);
  return (
    state.purchases
      .filter(
        (x) =>
          active(x) &&
          key(x.product) === k &&
          new Date(x.dateTime).getTime() <= at,
      )
      .reduce((a, x) => a + x.kg, 0) -
    state.sales
      .filter(
        (x) =>
          active(x) &&
          key(x.product) === k &&
          new Date(x.dateTime).getTime() <= at,
      )
      .reduce((a, x) => a + x.kg, 0)
  );
}
export function coldDuplicate<T extends ColdPurchase | ColdSale>(
  rows: T[],
  item: T,
) {
  const when = new Date(item.dateTime).getTime();
  return rows.some(
    (row) =>
      active(row) &&
      row.id !== item.id &&
      key(row.product) === key(item.product) &&
      row.kg === item.kg &&
      row.price === item.price &&
      Math.abs(new Date(row.dateTime).getTime() - when) <= 300000 &&
      ("person" in row && "person" in item
        ? key(row.person) === key(item.person) &&
          key(row.plate) === key(item.plate)
        : "buyer" in row &&
          "buyer" in item &&
          key(row.buyer) === key(item.buyer)),
  );
}

export function coldSummary(
  state: ColdState,
  start = -Infinity,
  end = Infinity,
  product = "",
) {
  const matches = (name: string) => !product || key(name) === key(product);
  const within = (s: { dateTime: string }) => {
    const t = new Date(s.dateTime).getTime();
    return t >= start && t < end;
  };
  const purchases = state.purchases.filter(
    (x) => active(x) && matches(x.product) && within(x),
  );
  const sales = state.sales.filter(
    (x) => active(x) && matches(x.product) && within(x),
  );
  const allPurchases = state.purchases.filter((x) => active(x) && within(x));
  const allSales = state.sales.filter((x) => active(x) && within(x));
  const allExpenses = state.expenses.filter(within);
  const scopedExpenses = allExpenses.filter((x) => !product || !x.product || matches(x.product));
  const fireKg = allExpenses
    .filter(
      (x) => key(x.category) === "fire" && (!product || matches(x.product)),
    )
    .reduce((sum, x) => sum + Number(x.lossKg || 0), 0);
  const quantity = (rows: { kg: number }[]) =>
    rows.reduce((sum, x) => sum + x.kg, 0);
  const buyKg = quantity(purchases),
    saleKg = quantity(sales),
    totalHandledKg = quantity(allPurchases) + quantity(allSales),
    handledKg = buyKg + saleKg;
  const buyCost = purchases.reduce((sum, x) => sum + x.kg * x.price, 0),
    revenue = sales.reduce((sum, x) => sum + x.kg * x.price, 0);
  const sumScope = (scope: ColdExpense["scope"]) =>
    scopedExpenses.filter((x) => (x.scope || "general") === scope && (!product || matches(x.product)))
      .reduce((sum, x) => sum + x.amount, 0);
  const purchaseExpenses = sumScope("purchase"), saleExpenses = sumScope("sale");
  const allGeneral = allExpenses.filter((x) => (x.scope || "general") === "general");
  const generalTotal = allGeneral.reduce((sum, x) => sum + x.amount, 0);
  const directGeneral = product
    ? allGeneral.filter((x) => x.product && matches(x.product)).reduce((sum,x)=>sum+x.amount,0)
    : generalTotal;
  const sharedGeneral = product
    ? allGeneral.filter((x) => !x.product).reduce((sum,x)=>sum+x.amount,0)
    : 0;
  // General expenses are shared by handled volume (purchase kg + sale kg), an understandable
  // and deterministic method that keeps product totals equal to the depot total.
  const allocatedGeneral = product
    ? directGeneral + (totalHandledKg ? sharedGeneral * handledKg / totalHandledKg : 0)
    : generalTotal;
  const products = coldProducts(state).filter(matches);
  let costOfGoods = 0,
    acquisitionExpenseInCogs = 0,
    stockKg = 0;
  for (const name of products) {
    const events = [
      ...state.purchases
        .filter(
          (x) =>
            active(x) &&
            key(x.product) === key(name) &&
            new Date(x.dateTime).getTime() < end,
        )
        .map((x) => ({
          t: new Date(x.dateTime).getTime(),
          type: 0 as const,
          kg: x.kg,
          price: x.price,
          id: x.id,
        })),
      ...state.sales
        .filter(
          (x) =>
            active(x) &&
            key(x.product) === key(name) &&
            new Date(x.dateTime).getTime() < end,
        )
        .map((x) => ({
          t: new Date(x.dateTime).getTime(),
          type: 1 as const,
          kg: x.kg,
          price: x.price,
          id: x.id,
        })),
    ].sort((a, b) => a.t - b.t || a.type - b.type || a.id.localeCompare(b.id));
    let available = 0,
      inventoryCost = 0,
      lastAverage = 0;
    for (const e of events) {
      if (e.type === 0) {
        inventoryCost += e.kg * e.price;
        available += e.kg;
        lastAverage = available > 0 ? inventoryCost / available : lastAverage;
      } else {
        const unit = available > 0 ? inventoryCost / available : lastAverage;
        const cogs = e.kg * unit;
        if (e.t >= start) costOfGoods += cogs;
        available -= e.kg;
        inventoryCost = Math.max(available, 0) * unit;
        lastAverage = unit;
      }
    }
    const acquiredBeforeEnd = state.purchases.filter((x)=>active(x) && key(x.product)===key(name) && new Date(x.dateTime).getTime()<end).reduce((s,x)=>s+x.kg,0);
    const acquisitionCostsBeforeEnd = state.expenses.filter((x)=>(x.scope||"general")==="purchase" && key(x.product)===key(name) && new Date(x.dateTime).getTime()<end).reduce((s,x)=>s+x.amount,0);
    const soldInPeriod = state.sales.filter((x)=>active(x) && key(x.product)===key(name) && within(x)).reduce((s,x)=>s+x.kg,0);
    acquisitionExpenseInCogs += acquiredBeforeEnd ? (acquisitionCostsBeforeEnd / acquiredBeforeEnd) * soldInPeriod : 0;
    stockKg += available;
  }
  return {
    buyCount: purchases.length,
    buyKg,
    buyCost,
    averageBuy: buyKg ? buyCost / buyKg : 0,
    purchaseExpenses,
    realBuyCost: buyCost + purchaseExpenses,
    realAverageBuy: buyKg ? (buyCost + purchaseExpenses) / buyKg : 0,
    saleCount: sales.length,
    saleKg,
    revenue,
    averageSale: saleKg ? revenue / saleKg : 0,
    saleExpenses,
    saleExpensePerKg: saleKg ? saleExpenses / saleKg : 0,
    generalExpenses: allocatedGeneral,
    expenses: purchaseExpenses + saleExpenses + allocatedGeneral,
    fireKg,
    stockKg,
    costOfGoods,
    grossProfit: revenue - costOfGoods - acquisitionExpenseInCogs,
    acquisitionExpenseInCogs,
    profit: revenue - costOfGoods - acquisitionExpenseInCogs - saleExpenses - allocatedGeneral,
    profitPerKg: saleKg
      ? (revenue - costOfGoods - acquisitionExpenseInCogs - saleExpenses - allocatedGeneral) / saleKg
      : 0,
  };
}

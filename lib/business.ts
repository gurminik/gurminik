export type Transaction = { id: string; productId: string; kg: number; dateTime: string; status: string };
export type PurchaseTransaction = Transaction & { person: string; plate: string; buyPrice: number };
export type SaleTransaction = Transaction & { buyer: string; driver: string; plate: string; sellPrice: number };

const normalize = (value: string) => value.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ");
const plateKey = (value: string) => normalize(value).replace(/\s+/g, "");
const sameNumber = (a: number, b: number) => Math.abs(a - b) < 0.000001;

export function summarizeTransactions<T extends Transaction>(rows: T[], price: (row: T) => number) {
  const active = rows.filter(row => row.status !== "cancelled");
  const totalKg = active.reduce((sum, row) => sum + Number(row.kg), 0);
  const totalAmount = active.reduce((sum, row) => sum + Number(row.kg) * Number(price(row)), 0);
  return { count: active.length, totalKg, totalAmount, average: totalKg ? totalAmount / totalKg : 0 };
}

export function latestSalePrice(rows: SaleTransaction[], productId: string, buyer: string) {
  const active = rows.filter(row => row.productId === productId && row.status !== "cancelled")
    .sort((a, b) => Date.parse(b.dateTime) - Date.parse(a.dateTime));
  return (buyer ? active.find(row => normalize(row.buyer) === normalize(buyer)) : undefined)?.sellPrice ?? active[0]?.sellPrice;
}

export function driverMatches(rows: SaleTransaction[], entered: string) {
  const names = new Map<string, { name: string; plate: string }>();
  for (const row of [...rows].sort((a, b) => Date.parse(b.dateTime) - Date.parse(a.dateTime))) {
    if (row.status === "cancelled" || !(row.driver || "").trim()) continue;
    const key = normalize(row.driver);
    if (!names.has(key)) names.set(key, { name: row.driver, plate: row.plate || "" });
  }
  return [...names.values()].filter(row => normalize(row.name).includes(normalize(entered)));
}

export function findRecentDuplicate<T extends PurchaseTransaction | SaleTransaction>(
  rows: T[], candidate: T, kind: "purchase" | "sale", minutes = 5,
) {
  const timestamp = Date.parse(candidate.dateTime);
  if (!Number.isFinite(timestamp)) return undefined;
  return rows.find(row => {
    if (row.id === candidate.id || row.status === "cancelled" || row.productId !== candidate.productId) return false;
    if (Math.abs(Date.parse(row.dateTime) - timestamp) > minutes * 60_000) return false;
    if (!sameNumber(Number(row.kg), Number(candidate.kg))) return false;
    if (kind === "purchase") {
      const a = row as PurchaseTransaction, b = candidate as PurchaseTransaction;
      return normalize(a.person) === normalize(b.person) && plateKey(a.plate) === plateKey(b.plate)
        && sameNumber(Number(a.buyPrice), Number(b.buyPrice));
    }
    const a = row as SaleTransaction, b = candidate as SaleTransaction;
    return normalize(a.buyer) === normalize(b.buyer) && normalize(a.driver || "") === normalize(b.driver || "")
      && plateKey(a.plate || "") === plateKey(b.plate || "") && sameNumber(Number(a.sellPrice), Number(b.sellPrice));
  });
}

export type PricePoint = { dateTime: string; buyPrice: number | null; sellPrice: number | null; purchaseKg: number; saleKg: number };
export function buildPriceHistory(purchases: PurchaseTransaction[], sales: SaleTransaction[], productId: string): PricePoint[] {
  const events = [
    ...purchases.filter(row => row.productId === productId && row.status !== "cancelled").map(row => ({ ...row, kind: "buy" as const, price: Number(row.buyPrice) })),
    ...sales.filter(row => row.productId === productId && row.status !== "cancelled").map(row => ({ ...row, kind: "sell" as const, price: Number(row.sellPrice) })),
  ].sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime) || a.kind.localeCompare(b.kind));
  const points: PricePoint[] = [];
  let buyPrice: number | null = null, sellPrice: number | null = null, purchaseKg = 0, saleKg = 0;
  for (const event of events) {
    const changed = event.kind === "buy" ? buyPrice !== event.price : sellPrice !== event.price;
    if (event.kind === "buy") { buyPrice = event.price; purchaseKg += Number(event.kg); }
    else { sellPrice = event.price; saleKg += Number(event.kg); }
    if (points.length && points[points.length - 1].dateTime === event.dateTime) {
      Object.assign(points[points.length - 1], { buyPrice, sellPrice, purchaseKg, saleKg });
    } else if (changed) points.push({ dateTime: event.dateTime, buyPrice, sellPrice, purchaseKg, saleKg });
  }
  return points;
}

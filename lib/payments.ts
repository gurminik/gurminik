export type PaymentTab = "all" | "paid" | "unpaid";
export type PaymentRow = {
  id: string;
  supplier_name: string;
  product_name: string;
  vehicle_plate: string | null;
  quantity_kg: number;
  unit_buy_price: number;
  total_buy_amount: number;
  transaction_at: string;
  is_paid: boolean;
};
export type PaymentTotals = { people: number; kg: number; amount: number };
export type PaymentPage = {
  rows: PaymentRow[];
  count: number;
  page: number;
  total: PaymentTotals;
  paid: PaymentTotals;
  unpaid: PaymentTotals;
};
export const PAYMENT_PAGE_SIZE = 10;
export const emptyPaymentTotals = (): PaymentTotals => ({ people: 0, kg: 0, amount: 0 });
export const emptyPaymentPage = (): PaymentPage => ({
  rows: [], count: 0, page: 1,
  total: emptyPaymentTotals(), paid: emptyPaymentTotals(), unpaid: emptyPaymentTotals(),
});
// FormData strings and offline boolean payloads must have the same meaning.
// Missing values are unpaid for new purchases; edits explicitly retain their value.
export const purchasePaymentValue = (value: unknown) => value === true || value === "true";

export function paymentDateBounds(range: { start: string; end: string }) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+03:00`));
  let start = valid(range.start) ? range.start : "";
  let end = valid(range.end) ? range.end : "";
  if (start && end && start > end) [start, end] = [end, start];
  return {
    start: start ? new Date(`${start}T00:00:00+03:00`).toISOString() : null,
    end: end ? new Date(Date.parse(`${end}T00:00:00+03:00`) + 86400000).toISOString() : null,
  };
}
export const paymentTimestamp = (value: string) => new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short",
}).format(new Date(value));

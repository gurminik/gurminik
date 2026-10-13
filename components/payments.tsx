"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useRememberedDateRange } from "@/lib/date-range";
import { supabase } from "@/lib/supabase";
import { emptyPaymentPage, PAYMENT_PAGE_SIZE, paymentDateBounds, paymentTimestamp,
  type PaymentPage, type PaymentRow, type PaymentTab, type PaymentTotals } from "@/lib/payments";

const number = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(value);
const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value);

function Summary({ title, totals }: { title: string; totals: PaymentTotals }) {
  return <article className="gurminik-stat gurminik-payment-summary">
    <span>{title}</span><strong>{money(totals.amount)}</strong>
    <small>{number(totals.people)} farklı kişi · {number(totals.kg)} kg</small>
  </article>;
}

export function Payments({ userId, canUpdate, compact = false, onChanged, openPurchaseId, onOpened }: {
  userId: string; canUpdate: boolean; compact?: boolean;
  onChanged: (id: string, paid: boolean) => void;
  openPurchaseId?: string | null; onOpened?: () => void;
}) {
  const { range, setRange } = useRememberedDateRange(userId, "payments");
  const [tab, setTab] = useState<PaymentTab>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PaymentPage>(emptyPaymentPage);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<PaymentRow | null>(null);
  const requestId = useRef(0);
  const saveLock = useRef(false);
  const invalidate = useCallback(() => { requestId.current += 1; }, []);
  const storageKey = `gurminik_payment_tab_v1:${userId}`;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved === "paid" || saved === "unpaid" || saved === "all") setTab(saved);
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true); setMessage("");
    try {
      const bounds = paymentDateBounds(range);
      const { data, error } = await supabase.rpc("get_gurminik_payments_page", {
        p_search: search.trim(), p_start: bounds.start, p_end: bounds.end,
        p_status: tab, p_page: page,
      });
      if (current !== requestId.current) return;
      if (error) throw error;
      const next = data as PaymentPage;
      setResult(next);
      // The server clamps a page that became empty after a payment/filter change.
      if (next.page !== page) setPage(next.page);
    } catch (error) {
      if (current !== requestId.current) return;
      setResult(emptyPaymentPage());
      setMessage((error as { message?: string })?.message || "Ödemeler yüklenemedi. İnternet bağlantınızı ve yetkinizi kontrol edin.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [page, range, search, tab]);

  useEffect(() => {
    // Debounce typing and invalidate stale responses immediately.
    invalidate();
    const timer = window.setTimeout(() => void load(), 250);
    return () => { window.clearTimeout(timer); invalidate(); };
  }, [load, invalidate]);
  useEffect(() => {
    let timer: number | undefined;
    const channel = supabase.channel(`gurminik-payments:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases" }, () => {
        window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 250);
      }).subscribe();
    return () => { window.clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [load, userId]);
  useEffect(() => {
    if (!openPurchaseId) return;
    let cancelled = false;
    void supabase.rpc("get_gurminik_payment_detail", { p_id: openPurchaseId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) setMessage("Alış kaydı bulunamadı veya bu kayda erişiminiz yok.");
      else setSelected(data as PaymentRow);
      onOpened?.();
    });
    return () => { cancelled = true; };
  }, [openPurchaseId, onOpened]);

  async function changePayment(row: PaymentRow, paid: boolean) {
    if (!canUpdate || row.is_paid === paid || saveLock.current) return;
    if (!navigator.onLine) { setMessage("Ödeme durumunu değiştirmek için internet bağlantısı gerekir."); return; }
    saveLock.current = true;
    setSaving(row.id); setMessage("");
    try {
      const { data, error } = await supabase.rpc("set_gurminik_purchase_payment", {
        p_id: row.id, p_paid: paid, p_expected_paid: row.is_paid,
      });
      if (error) throw error;
      if (!data) throw new Error("Ödeme durumu güncellenemedi.");
      onChanged(row.id, paid);
      setSelected((current) => current?.id === row.id ? { ...current, is_paid: paid } : current);
      await load();
    } catch (error) {
      setMessage((error as { message?: string })?.message || "Ödeme durumu değiştirilemedi. Listeyi yenileyip tekrar deneyin.");
    } finally { saveLock.current = false; setSaving(null); }
  }

  function chooseTab(value: PaymentTab) {
    setTab(value); setPage(1);
    try { localStorage.setItem(storageKey, value); } catch {}
  }
  const pages = Math.max(1, Math.ceil(result.count / PAYMENT_PAGE_SIZE));
  const statusControl = (row: PaymentRow) => canUpdate
    ? <select aria-label={`${row.supplier_name} ödeme durumu`} value={String(row.is_paid)}
        disabled={!!saving || loading} onChange={(event) => void changePayment(row, event.target.value === "true")}>
        <option value="false">Ödenmedi</option><option value="true">Ödendi</option>
      </select>
    : <span className={`gurminik-payment-badge ${row.is_paid ? "is-paid" : "is-unpaid"}`}>{row.is_paid ? "Ödendi" : "Ödenmedi"}</span>;

  return <section className={`gurminik-payments ${compact ? "is-compact" : ""}`} aria-busy={loading}>
    <div className="gurminik-block-heading"><p>TEDARİKÇİ ÖDEME TAKİBİ</p><h3>Ödemeler</h3></div>
    <p className="gurminik-form-hint">Aktif alış kayıtları gösterilir. İptal edilen alışlar ve Soğuk Hava bu toplamlara dahil değildir.</p>
    <DateRangeFilter title="Ödemeler tarih aralığı" range={range} onChange={(next) => { setRange(next); setPage(1); }} />
    <div className="gurminik-payment-search">
      <Input aria-label="Ödemelerde kişi, plaka veya ürün ara" placeholder="Kişi, plaka veya ürün ara…" value={search}
        onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw /> Yenile</Button>
    </div>
    {message && <p role="alert" className="gurminik-permission-error">{message}</p>}
    <div className="gurminik-payment-summaries">
      {tab === "all" && <Summary title="Toplam" totals={result.total} />}
      {tab !== "unpaid" && <Summary title="Ödenenler" totals={result.paid} />}
      {tab !== "paid" && <Summary title="Ödenmeyenler" totals={result.unpaid} />}
    </div>
    <div className="gurminik-payment-tabs" role="group" aria-label="Ödeme durumu filtresi">
      {([["all", "Toplam"], ["paid", "Ödenenler"], ["unpaid", "Ödenmeyenler"]] as const).map(([value, label]) =>
        <Button key={value} type="button" aria-pressed={tab === value} variant={tab === value ? "default" : "outline"}
          onClick={() => chooseTab(value)}>{label}</Button>)}
    </div>
    {loading && <p role="status">Ödemeler yükleniyor…</p>}
    <div className="gurminik-panel gurminik-payment-table">
      <table><thead><tr><th>Tarih / Saat</th><th>Kişi</th><th>Plaka</th><th>Ürün</th><th>Kg</th><th>Kg fiyatı</th><th>Toplam</th><th>Durum</th><th>Detay</th></tr></thead>
        <tbody>{result.rows.map((row) => <tr key={row.id}>
          <td data-label="Tarih / Saat">{paymentTimestamp(row.transaction_at)}</td>
          <td data-label="Kişi">{row.supplier_name}</td><td data-label="Plaka">{row.vehicle_plate || "—"}</td>
          <td data-label="Ürün">{row.product_name}</td><td data-label="Kg">{number(row.quantity_kg)}</td>
          <td data-label="Kg fiyatı">{money(row.unit_buy_price)}</td><td data-label="Toplam">{money(row.total_buy_amount)}</td>
          <td data-label="Durum">{statusControl(row)}</td>
          <td data-label="Detay"><Button type="button" variant="outline" onClick={() => setSelected(row)}><Eye /> Aç</Button></td>
        </tr>)}</tbody>
      </table>
      {!result.rows.length && !loading && <p className="gurminik-form-hint">Filtrelere uygun alış bulunamadı.</p>}
    </div>
    <div className="gurminik-payment-pager">
      <Button type="button" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft /> Önceki</Button>
      <span>{result.count ? `${(result.page - 1) * PAYMENT_PAGE_SIZE + 1}–${Math.min(result.page * PAYMENT_PAGE_SIZE, result.count)} / ${result.count}` : "0 kayıt"} · Sayfa {result.page} / {pages}</span>
      <Button type="button" variant="outline" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>Sonraki <ChevronRight /></Button>
    </div>
    <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Alış kaydı</DialogTitle><DialogDescription>Mevcut alış kaydının ödeme detayları.</DialogDescription></DialogHeader>
        {selected && <dl className="gurminik-payment-detail">
          <dt>Kişi</dt><dd>{selected.supplier_name}</dd><dt>Ürün</dt><dd>{selected.product_name}</dd>
          <dt>Miktar</dt><dd>{number(selected.quantity_kg)} kg</dd><dt>Kg fiyatı</dt><dd>{money(selected.unit_buy_price)}</dd>
          <dt>Toplam tutar</dt><dd>{money(selected.total_buy_amount)}</dd><dt>Tarih / Saat</dt><dd>{paymentTimestamp(selected.transaction_at)}</dd>
          <dt>Plaka</dt><dd>{selected.vehicle_plate || "—"}</dd><dt>Ödeme durumu</dt><dd>{selected.is_paid ? "Ödendi" : "Ödenmedi"}</dd>
        </dl>}
      </DialogContent>
    </Dialog>
  </section>;
}

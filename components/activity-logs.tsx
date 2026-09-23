"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateRangeFilter } from "@/components/date-range-filter";
import { useRememberedDateRange } from "@/lib/date-range";
import { downloadActivityPdf, type ActivityPdfRow } from "@/lib/activity-pdf";
import { fetchAllRows } from "@/lib/pagination";
import { supabase } from "@/lib/supabase";

export type ActivityLog = ActivityPdfRow & {
  id: string;
  module: string;
  entity_type?: string | null;
  entity_id?: string | null;
  amount?: number | null;
  metadata?: Record<string, unknown>;
};

const PAGE_SIZE = 15;
const actionLabels: Record<string, string> = {
  create: "Oluşturma", update: "Düzenleme", cancel: "İptal", restore: "Etkinleştirme",
  delete: "Silme", export: "Dışa aktarma", import: "Geri yükleme",
  permission: "Yetki", system: "Sistem",
};
const isoStart = (v: string) => v ? new Date(`${v}T00:00:00`).toISOString() : "";
const isoEnd = (v: string) => v ? new Date(`${v}T23:59:59.999`).toISOString() : "";
const localDate = (date: Date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
};

export function ActivityLogs({
  userId,
  onOpen,
  financeUnlocked,
  requestFinanceUnlock,
}: {
  userId: string;
  onOpen: (row: ActivityLog) => void;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
}) {
  const { range, setRange } = useRememberedDateRange(userId, "activity_logs");
  const [rows, setRows] = useState<ActivityLog[]>([]), [page, setPage] = useState(1);
  const [total, setTotal] = useState(0), [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(""), [selected, setSelected] = useState<ActivityLog | null>(null);

  const queryBase = useCallback(() => {
    let query = supabase.from("activity_logs").select(
      "id,actor_name,module,action_type,entity_type,entity_id,person_name,product_name,quantity,amount,description,metadata,created_at",
      { count: "exact" },
    );
    if (range.start) query = query.gte("created_at", isoStart(range.start));
    if (range.end) query = query.lte("created_at", isoEnd(range.end));
    return query;
  }, [range.end, range.start]);

  const load = useCallback(async () => {
    setLoading(true); setMessage("");
    const from = (page - 1) * PAGE_SIZE;
    const { data, error, count } = await queryBase()
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) setMessage(error.message);
    else { setRows((data || []) as ActivityLog[]); setTotal(count || 0); }
    setLoading(false);
  }, [page, queryBase]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => setPage(1), 0);
    return () => window.clearTimeout(timer);
  }, [range.start, range.end]);

  const periodLabel = range.start || range.end
    ? `${range.start || "Başlangıç"} – ${range.end || "Bugün"}` : "Tüm zamanlar";
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const presets = useMemo(() => {
    const today = new Date(), yesterday = new Date(today), seven = new Date(today);
    yesterday.setDate(today.getDate() - 1); seven.setDate(today.getDate() - 6);
    const week = new Date(today); week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    return [
      ["Bugün", today, today], ["Dün", yesterday, yesterday], ["Son 7 Gün", seven, today],
      ["Bu Hafta", week, today], ["Bu Ay", month, today], ["Geçen Ay", lastStart, lastEnd],
    ] as const;
  }, []);

  async function pdf() {
    setLoading(true); setMessage("");
    try {
      const all = await fetchAllRows((from, to) => {
        let query = supabase.from("activity_logs").select(
          "created_at,actor_name,action_type,person_name,product_name,quantity,description",
        );
        if (range.start) query = query.gte("created_at", isoStart(range.start));
        if (range.end) query = query.lte("created_at", isoEnd(range.end));
        return query.order("created_at", { ascending: false }).range(from, to);
      });
      if (all.error) throw all.error;
      await downloadActivityPdf((all.data || []) as ActivityPdfRow[], periodLabel);
      await supabase.rpc("log_gurminik_export", {
        export_module: "activity_logs", report_name: `İşlem Geçmişi PDF (${periodLabel})`,
        date_start: range.start || null, date_end: range.end || null, filters: {},
      });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "PDF oluşturulamadı."); }
    finally { setLoading(false); }
  }

  return <>
    <DateRangeFilter range={range} onChange={setRange} title="İşlem geçmişi tarih aralığı" />
    <div className="gurminik-activity-toolbar gurminik-panel">
      <div className="gurminik-activity-presets">
        {presets.map(([label, start, end]) => <button key={label} onClick={() => setRange({ start: localDate(start), end: localDate(end) })}>{label}</button>)}
        <button onClick={() => setRange({ start: "", end: "" })}>Tüm Zamanlar</button>
      </div>
      <Button onClick={() => void pdf()} disabled={loading}><Download />PDF Olarak İndir</Button>
    </div>
    {message && <div className="gurminik-permission-error">{message}</div>}
    <section className="gurminik-panel gurminik-activity-panel">
      <header><div><p>DENETİM KAYITLARI</p><h3>{total.toLocaleString("tr-TR")} önemli işlem</h3></div>{loading && <RefreshCw className="animate-spin" />}</header>
      <div className="gurminik-activity-table">
        <div className="gurminik-activity-row is-header"><span>Tarih / Saat</span><span>Kullanıcı</span><span>İşlem</span><span>Kişi</span><span>Ürün / Açıklama</span><span>Aç</span></div>
        {rows.map(row => <div className="gurminik-activity-row" key={row.id}>
          <span data-label="Tarih / Saat">{new Date(row.created_at).toLocaleString("tr-TR")}</span>
          <strong data-label="Kullanıcı">{row.actor_name}</strong>
          <span data-label="İşlem"><i className={`gurminik-activity-badge is-${row.action_type}`}>{actionLabels[row.action_type] || row.action_type}</i></span>
          <span data-label="Kişi">{row.person_name || "—"}</span>
          <span data-label="Ürün / Açıklama"><b>{row.product_name || ""}{row.quantity ? ` · ${Number(row.quantity).toLocaleString("tr-TR")} kg` : ""}</b><small>{row.description}</small></span>
          <span><Button variant="outline" onClick={() => setSelected(row)}><Eye />Aç</Button></span>
        </div>)}
        {!loading && !rows.length && <p className="gurminik-empty">Seçilen tarihlerde işlem kaydı yok.</p>}
      </div>
      <div className="gurminik-activity-pager"><Button variant="outline" disabled={page<=1} onClick={() => setPage(x=>x-1)}><ChevronLeft /></Button><span>{page} / {pages}</span><Button variant="outline" disabled={page>=pages} onClick={() => setPage(x=>x+1)}><ChevronRight /></Button></div>
    </section>
    <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
      <DialogContent className="gurminik-dialog gurminik-activity-dialog">
        <DialogHeader><DialogTitle>İşlem ayrıntısı</DialogTitle><DialogDescription>{selected && new Date(selected.created_at).toLocaleString("tr-TR")}</DialogDescription></DialogHeader>
        {selected && <div className="gurminik-activity-detail">
          <p><b>Kullanıcı</b><span>{selected.actor_name}</span></p><p><b>İşlem</b><span>{actionLabels[selected.action_type] || selected.action_type}</span></p>
          <p><b>Kişi</b><span>{selected.person_name || "—"}</span></p><p><b>Ürün</b><span>{selected.product_name || "—"}</span></p>
          <p><b>Miktar</b><span>{selected.quantity ? `${Number(selected.quantity).toLocaleString("tr-TR")} kg` : "—"}</span></p>
          <p><b>Tutar</b><span>{selected.amount == null ? "—" : financeUnlocked ? Number(selected.amount).toLocaleString("tr-TR",{style:"currency",currency:"TRY"}) : <button onClick={requestFinanceUnlock}>Şifreyle göster</button>}</span></p>
          <div><b>Açıklama</b><span>{selected.description}</span></div>
          {selected.metadata && Object.keys(selected.metadata).length > 0 && <div><b>Eski / yeni değerler</b>{financeUnlocked ? <pre>{JSON.stringify(selected.metadata,null,2)}</pre> : <button onClick={requestFinanceUnlock}>Ayrıntıları şifreyle göster</button>}</div>}
          <div><Button onClick={() => { onOpen(selected); setSelected(null); }}><Eye />İlgili kayda git</Button></div>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}

"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Download, LockKeyhole, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ColdState,
  ColdPurchase,
  ColdSale,
  ColdExpense,
  COLD_DEFAULT_CATEGORIES,
  coldProducts,
  coldSummary,
} from "@/lib/cold-storage";
import { createColdPdf } from "@/lib/cold-pdf";
import { DateRangeFilter } from "@/components/date-range-filter";
import {
  inRememberedDateRange,
  useRememberedDateRange,
} from "@/lib/date-range";

type Rights = {
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
};
type Mutation = (
  action: string,
  data: Record<string, unknown>,
) => Promise<void>;
const fmt = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(
    n || 0,
  );
const kilos = (n: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n || 0) +
  " kg";
const now = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const local = (v: string) => {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const norm = (v: string) => v.toLocaleLowerCase("tr-TR").trim();
const ts = (v: string) => new Date(v).toLocaleString("tr-TR");
const pager = (rows: number) => Math.max(1, Math.ceil(rows / 15));

function Money({
  value,
  unlocked,
  unlock,
}: {
  value: number;
  unlocked: boolean;
  unlock: () => void;
}) {
  return unlocked ? (
    <strong>{fmt(value)}</strong>
  ) : (
    <button type="button" className="cold-locked" onClick={unlock}>
      <LockKeyhole size={16} />
      Şifreyle göster
    </button>
  );
}
function Metric({
  label,
  value,
  financial = false,
  unlocked,
  unlock,
}: {
  label: string;
  value: number | string;
  financial?: boolean;
  unlocked: boolean;
  unlock: () => void;
}) {
  return (
    <article className="gurminik-stat">
      <span>{label}</span>
      {financial ? (
        <Money value={Number(value)} unlocked={unlocked} unlock={unlock} />
      ) : (
        <strong>{value}</strong>
      )}
    </article>
  );
}
function Totals({
  summary,
  unlocked,
  unlock,
}: {
  summary: ReturnType<typeof coldSummary>;
  unlocked: boolean;
  unlock: () => void;
}) {
  return (
    <div className="gurminik-summary-grid cold-summary">
      <Metric
        label="Alınan KG"
        value={kilos(summary.buyKg)}
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="Alış maliyeti"
        value={summary.buyCost}
        financial
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="Ort. alış TL/KG"
        value={summary.averageBuy}
        financial
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="Satılan KG"
        value={kilos(summary.saleKg)}
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="Satış tutarı"
        value={summary.revenue}
        financial
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="Ort. satış TL/KG"
        value={summary.averageSale}
        financial
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="Depo gideri"
        value={summary.expenses}
        financial
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="Fire"
        value={kilos(summary.fireKg)}
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="Gerçekleşmiş kâr"
        value={summary.profit}
        financial
        unlocked={unlocked}
        unlock={unlock}
      />
      <Metric
        label="KG başına kâr"
        value={summary.profitPerKg}
        financial
        unlocked={unlocked}
        unlock={unlock}
      />
    </div>
  );
}

export function ColdStorage({
  state,
  products,
  userId,
  financeUnlocked,
  requestFinanceUnlock,
  permission,
  mutate,
}: {
  state: ColdState;
  products: string[];
  userId: string;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
  permission: Rights;
  mutate: Mutation;
}) {
  const [tab, setTab] = useState<
      "overview" | "purchases" | "sales" | "expenses"
    >("overview"),
    [product, setProduct] = useState(""),
    [purchaseSearch, setPurchaseSearch] = useState(""),
    [saleSearch, setSaleSearch] = useState(""),
    [expenseSearch, setExpenseSearch] = useState(""),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<
      ColdPurchase | ColdSale | ColdExpense | null
    >(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [expenseCategory, setExpenseCategory] = useState(
      COLD_DEFAULT_CATEGORIES[0],
    );
  const { range, setRange, bounds } = useRememberedDateRange(
    userId,
    "cold_storage",
  );
  const lock = useRef(false);
  const names = [
    ...new Map(
      [
        ...coldProducts(state),
        ...products,
        ..."Portakal,Mandalina,Limon,Greyfurt,Nar".split(","),
      ].map((x) => [norm(x), x]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b, "tr-TR"));
  const totals = useMemo(
    () => coldSummary(state, bounds.start, bounds.end, product),
    [state, product, bounds.start, bounds.end],
  );
  const match = (p: string) => !product || norm(p) === norm(product);
  const inRange = (x: { dateTime: string }) =>
    inRememberedDateRange(x.dateTime, range);
  const pr = state.purchases.filter(
    (x) =>
      inRange(x) &&
      match(x.product) &&
      [x.person, x.product, x.plate].some((v) =>
        norm(v).includes(norm(purchaseSearch)),
      ),
  );
  const sr = state.sales.filter(
    (x) =>
      inRange(x) &&
      match(x.product) &&
      [x.buyer, x.product].some((v) => norm(v).includes(norm(saleSearch))),
  );
  const ex = state.expenses.filter(
    (x) =>
      inRange(x) &&
      (!product || !x.product || match(x.product)) &&
      [x.title, x.category, x.product, x.note].some((v) =>
        norm(v).includes(norm(expenseSearch)),
      ),
  );
  const pSum = coldSummary(
      { ...state, purchases: pr },
      bounds.start,
      bounds.end,
      product,
    ),
    sSum = coldSummary(
      { ...state, sales: sr },
      bounds.start,
      bounds.end,
      product,
    );
  function changeTab(value: typeof tab) {
    setTab(value);
    setPage(1);
    setEditing(null);
    setMessage("");
  }
  function guardedEdit(row: ColdPurchase | ColdSale | ColdExpense) {
    if (!financeUnlocked) {
      requestFinanceUnlock();
      return;
    }
    if ("category" in row) setExpenseCategory(row.category);
    setEditing(row);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const form = e.currentTarget,
      fd = new FormData(form),
      data = Object.fromEntries(fd.entries()) as Record<string, unknown>,
      kind =
        tab === "purchases"
          ? "ColdPurchase"
          : tab === "sales"
            ? "ColdSale"
            : "ColdExpense",
      isEdit = !!editing;
    data.id = editing?.id || crypto.randomUUID();
    try {
      if (tab === "purchases" || tab === "sales") {
        const quantity = Number(data.kg),
          price = Number(data.price);
        if (!(quantity > 0) || price < 0)
          throw Error("KG pozitif, fiyat sıfır veya daha büyük olmalıdır.");
        const selected = String(data.product || "").trim();
        if (!selected) throw Error("Ürün seçin veya yeni ürün yazın.");
        data.product = selected;
      }
      if (tab === "expenses") {
        data.amount = Number(data.amount || 0);
        if (String(data.category) === "Fire") {
          if (!(Number(data.lossKg) > 0))
            throw Error("Fire kg sıfırdan büyük olmalıdır.");
          if (!String(data.product || "").trim())
            throw Error("Fire için ürün seçin.");
          data.title = "Fire";
        } else if (!(Number(data.amount) > 0))
          throw Error("Gider tutarı sıfırdan büyük olmalıdır.");
      }
      await mutate((isEdit ? "edit" : "add") + kind, data);
      setEditing(null);
      if (tab === "expenses") setExpenseCategory(COLD_DEFAULT_CATEGORIES[0]);
      form.reset();
      form.dispatchEvent(new Event("input", { bubbles: true }));
      setMessage(
        isEdit
          ? "Kayıt güncellendi."
          : "Kayıt buluta gönderildi veya çevrimdışı kuyruğa alındı.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kayıt yapılamadı.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function category() {
    const name = window.prompt("Yeni Soğuk Hava gider kategorisi:")?.trim();
    if (!name) return;
    if (
      [...COLD_DEFAULT_CATEGORIES, ...state.categories.map((c) => c.name)].some(
        (x) => norm(x) === norm(name),
      )
    ) {
      setMessage("Kategori zaten mevcut.");
      return;
    }
    try {
      await mutate("addColdCategory", { id: crypto.randomUUID(), name });
      setMessage("Kategori eklendi.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Kategori eklenemedi.");
    }
  }
  async function action(
    kind: "Purchase" | "Sale",
    row: ColdPurchase | ColdSale,
  ) {
    if (
      !window.confirm(
        row.status === "cancelled"
          ? "Kaydı yeniden etkinleştir?"
          : "Kaydı iptal et?",
      )
    )
      return;
    try {
      await mutate("toggleCold" + kind, {
        id: row.id,
        status: row.status === "cancelled" ? "active" : "cancelled",
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "İşlem başarısız.");
    }
  }
  const expenseCategories = [
    ...new Set([
      ...COLD_DEFAULT_CATEGORIES,
      ...state.categories.map((x) => x.name),
      ...state.expenses.map((x) => x.category),
    ]),
  ];
  const current = tab === "purchases" ? pr : tab === "sales" ? sr : ex;
  const pages = pager(current.length),
    shown = current.slice(
      (Math.min(page, pages) - 1) * 15,
      Math.min(page, pages) * 15,
    );
  return (
    <div className="cold-layout">
      <section className="gurminik-panel cold-header">
        <div>
          <p className="gurminik-eyebrow">AYRI İŞLETME DEFTERİ</p>
          <h3>Soğuk Hava Deposu</h3>
          <span>
            Buradaki işlemler normal GURMİNİK alış, satış ve gider toplamlarına
            eklenmez.
          </span>
        </div>
        <select
          aria-label="Soğuk Hava ürün filtresi"
          value={product}
          onChange={(e) => {
            setProduct(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm ürünler</option>
          {names.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </section>
      <DateRangeFilter
        range={range}
        onChange={(next) => {
          setRange(next);
          setPage(1);
        }}
        title="Soğuk Hava tarih aralığı"
      />
      <div className="cold-tabs">
        {(
          [
            ["overview", "Genel Bakış"],
            ["purchases", "Alışlar"],
            ["sales", "Satışlar"],
            ["expenses", "Giderler"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            className={tab === id ? "is-active" : ""}
            onClick={() => changeTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {message && (
        <p role="status" className="gurminik-sync-notice">
          {message}
        </p>
      )}
      {tab === "overview" && (
        <>
          <Totals
            summary={totals}
            unlocked={financeUnlocked}
            unlock={requestFinanceUnlock}
          />
          <p className="cold-note">
            Satılan mal maliyeti işlem tarihindeki hareketli ağırlıklı
            ortalamadan hesaplanır. Depo giderleri seçili dönemde satılan KG
            payına göre ürünlere dağıtılır. Fire yalnızca Giderler bölümündeki
            manuel Fire kayıtlarından gelir.
          </p>
          <div className="gurminik-table-panel cold-table">
            <table>
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th>Alınan</th>
                  <th>Satılan</th>
                  <th>Fire</th>
                  <th>Gerçekleşmiş kâr</th>
                </tr>
              </thead>
              <tbody>
                {names
                  .filter(
                    (x) =>
                      coldProducts(state).some((p) => norm(p) === norm(x)) &&
                      match(x),
                  )
                  .map((x) => {
                    const row = coldSummary(state, bounds.start, bounds.end, x);
                    return (
                      <tr key={x}>
                        <td>{x}</td>
                        <td>{kilos(row.buyKg)}</td>
                        <td>{kilos(row.saleKg)}</td>
                        <td>{kilos(row.fireKg)}</td>
                        <td>
                          <Money
                            value={row.profit}
                            unlocked={financeUnlocked}
                            unlock={requestFinanceUnlock}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "purchases" && (
        <>
          <div className="cold-search">
            <Input
              aria-label="Soğuk Hava alış ara"
              placeholder="Tedarikçi, ürün veya plaka ara…"
              value={purchaseSearch}
              onChange={(e) => {
                setPurchaseSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="gurminik-summary-grid">
            <Metric
              label="Aktif alış"
              value={pr.filter((x) => x.status !== "cancelled").length}
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
            <Metric
              label="Alınan KG"
              value={kilos(pSum.buyKg)}
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
            <Metric
              label="Alış maliyeti"
              value={pSum.buyCost}
              financial
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
            <Metric
              label="Ort. alış TL/KG"
              value={pSum.averageBuy}
              financial
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
          </div>
          {permission.can_create || editing ? (
            <form
              key={editing?.id || "new-purchase"}
              onSubmit={submit}
              className="gurminik-panel cold-form"
            >
              <h3>{editing ? "Alışı düzenle" : "Soğuk Hava alış gir"}</h3>
              <div className="cold-fields">
                <label>
                  Ürün
                  <input
                    name="product"
                    list="cold-product-list"
                    defaultValue={(editing as ColdPurchase)?.product || product}
                    required
                  />
                </label>
                <label>
                  Tedarikçi
                  <input
                    name="person"
                    defaultValue={(editing as ColdPurchase)?.person || ""}
                    required
                  />
                </label>
                <label>
                  Plaka
                  <input
                    name="plate"
                    defaultValue={(editing as ColdPurchase)?.plate || ""}
                  />
                </label>
                <label>
                  KG
                  <input
                    name="kg"
                    type="number"
                    step="0.01"
                    min="0.01"
                    defaultValue={(editing as ColdPurchase)?.kg || ""}
                    required
                  />
                </label>
                <label>
                  Alış fiyatı (TL/KG)
                  <input
                    name="price"
                    type="number"
                    step="0.0001"
                    min="0"
                    defaultValue={(editing as ColdPurchase)?.price ?? ""}
                    required
                  />
                </label>
                <label>
                  Tarih ve saat
                  <input
                    name="dateTime"
                    type="datetime-local"
                    defaultValue={editing ? local(editing.dateTime) : now()}
                    required
                  />
                </label>
                <label className="cold-wide">
                  Açıklama
                  <input
                    name="note"
                    defaultValue={(editing as ColdPurchase)?.note || ""}
                  />
                </label>
              </div>
              <PricePreview />
              <div className="cold-actions">
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(null)}
                  >
                    Vazgeç
                  </Button>
                )}
                <Button disabled={busy}>
                  <Save size={16} />
                  {busy
                    ? "Kaydediliyor…"
                    : editing
                      ? "Değişiklikleri kaydet"
                      : "Alışı kaydet"}
                </Button>
              </div>
            </form>
          ) : null}
          <ColdTable
            type="purchase"
            rows={shown as ColdPurchase[]}
            unlocked={financeUnlocked}
            unlock={requestFinanceUnlock}
            permission={permission}
            edit={guardedEdit}
            toggle={(x) => void action("Purchase", x)}
          />
        </>
      )}
      {tab === "sales" && (
        <>
          <div className="cold-search">
            <Input
              aria-label="Soğuk Hava satış ara"
              placeholder="Alıcı veya ürün ara…"
              value={saleSearch}
              onChange={(e) => {
                setSaleSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="gurminik-summary-grid">
            <Metric
              label="Aktif satış"
              value={sr.filter((x) => x.status !== "cancelled").length}
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
            <Metric
              label="Satılan KG"
              value={kilos(sSum.saleKg)}
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
            <Metric
              label="Satış tutarı"
              value={sSum.revenue}
              financial
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
            <Metric
              label="Ort. satış TL/KG"
              value={sSum.averageSale}
              financial
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
          </div>
          {permission.can_create || editing ? (
            <form
              key={editing?.id || "new-sale"}
              onSubmit={submit}
              className="gurminik-panel cold-form"
            >
              <h3>{editing ? "Satışı düzenle" : "Soğuk Hava satış gir"}</h3>
              <div className="cold-fields">
                <label>
                  Ürün
                  <input
                    name="product"
                    list="cold-product-list"
                    defaultValue={(editing as ColdSale)?.product || product}
                    required
                  />
                </label>
                <label>
                  Alıcı / Firma
                  <input
                    name="buyer"
                    defaultValue={(editing as ColdSale)?.buyer || ""}
                    required
                  />
                </label>
                <label>
                  KG
                  <input
                    name="kg"
                    type="number"
                    step="0.01"
                    min="0.01"
                    defaultValue={(editing as ColdSale)?.kg || ""}
                    required
                  />
                </label>
                <label>
                  Satış fiyatı (TL/KG)
                  <input
                    name="price"
                    type="number"
                    step="0.0001"
                    min="0"
                    defaultValue={(editing as ColdSale)?.price ?? ""}
                    required
                  />
                </label>
                <label>
                  Tarih ve saat
                  <input
                    name="dateTime"
                    type="datetime-local"
                    defaultValue={editing ? local(editing.dateTime) : now()}
                    required
                  />
                </label>
                <label className="cold-wide">
                  Açıklama
                  <input
                    name="note"
                    defaultValue={(editing as ColdSale)?.note || ""}
                  />
                </label>
              </div>
              <PricePreview />
              <div className="cold-actions">
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(null)}
                  >
                    Vazgeç
                  </Button>
                )}
                <Button disabled={busy}>
                  <Save size={16} />
                  {busy
                    ? "Kaydediliyor…"
                    : editing
                      ? "Değişiklikleri kaydet"
                      : "Satışı kaydet"}
                </Button>
              </div>
            </form>
          ) : null}
          <ColdTable
            type="sale"
            rows={shown as ColdSale[]}
            unlocked={financeUnlocked}
            unlock={requestFinanceUnlock}
            permission={permission}
            edit={guardedEdit}
            toggle={(x) => void action("Sale", x)}
          />
        </>
      )}
      {tab === "expenses" && (
        <>
          <div className="cold-search">
            <Input
              aria-label="Soğuk Hava gider ara"
              placeholder="Gider, kategori veya ürün ara…"
              value={expenseSearch}
              onChange={(e) => {
                setExpenseSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="gurminik-summary-grid">
            <Metric
              label="Soğuk Hava giderleri"
              value={ex.reduce((a, x) => a + x.amount, 0)}
              financial
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
            <Metric
              label="Fire"
              value={kilos(
                ex
                  .filter((x) => norm(x.category) === "fire")
                  .reduce((a, x) => a + x.lossKg, 0),
              )}
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
            <Metric
              label="Gider kayıtları"
              value={ex.length}
              unlocked={financeUnlocked}
              unlock={requestFinanceUnlock}
            />
          </div>
          {permission.can_create || editing ? (
            <form
              key={editing?.id || "new-expense"}
              onSubmit={submit}
              className="gurminik-panel cold-form"
            >
              <h3>{editing ? "Gideri düzenle" : "Soğuk Hava gideri gir"}</h3>
              <div className="cold-fields">
                <label>
                  Kategori
                  <select
                    name="category"
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                  >
                    {expenseCategories.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                {expenseCategory === "Fire" ? (
                  <>
                    <input type="hidden" name="title" value="Fire" />
                    <label>
                      Ürün
                      <input
                        name="product"
                        list="cold-product-list"
                        defaultValue={
                          (editing as ColdExpense)?.product || product
                        }
                        required
                      />
                    </label>
                    <label>
                      Fire kg
                      <input
                        name="lossKg"
                        type="number"
                        min="0.01"
                        step="0.01"
                        defaultValue={(editing as ColdExpense)?.lossKg || ""}
                        required
                      />
                    </label>
                    <label>
                      TL karşılığı (isteğe bağlı)
                      <input
                        name="amount"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={(editing as ColdExpense)?.amount || ""}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Gider adı
                      <input
                        name="title"
                        defaultValue={(editing as ColdExpense)?.title || ""}
                        required
                      />
                    </label>
                    <label>
                      Tutar (TL)
                      <input
                        name="amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        defaultValue={(editing as ColdExpense)?.amount || ""}
                        required
                      />
                    </label>
                  </>
                )}
                <label>
                  Tarih ve saat
                  <input
                    name="dateTime"
                    type="datetime-local"
                    defaultValue={editing ? local(editing.dateTime) : now()}
                    required
                  />
                </label>
                <label className="cold-wide">
                  Açıklama
                  <input
                    name="note"
                    defaultValue={(editing as ColdExpense)?.note || ""}
                  />
                </label>
              </div>
              <div className="cold-actions">
                {permission.can_create && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void category()}
                  >
                    <Plus size={16} />
                    Yeni kategori
                  </Button>
                )}
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditing(null);
                      setExpenseCategory(COLD_DEFAULT_CATEGORIES[0]);
                    }}
                  >
                    Vazgeç
                  </Button>
                )}
                <Button disabled={busy}>
                  <Save size={16} />
                  {busy
                    ? "Kaydediliyor…"
                    : editing
                      ? "Değişiklikleri kaydet"
                      : "Gideri kaydet"}
                </Button>
              </div>
            </form>
          ) : null}
          <ExpenseBreakdown
            rows={ex}
            unlocked={financeUnlocked}
            unlock={requestFinanceUnlock}
          />
          <div className="gurminik-table-panel cold-table">
            <table>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Gider</th>
                  <th>Kategori</th>
                  <th>Ürün / Fire</th>
                  <th>Tutar</th>
                  <th>Not</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {(shown as ColdExpense[]).map((x) => (
                  <tr key={x.id}>
                    <td>{ts(x.dateTime)}</td>
                    <td>{x.title}</td>
                    <td>{x.category}</td>
                    <td>
                      {x.product
                        ? `${x.product}${x.lossKg ? ` · ${kilos(x.lossKg)}` : ""}`
                        : "—"}
                    </td>
                    <td>
                      <Money
                        value={x.amount}
                        unlocked={financeUnlocked}
                        unlock={requestFinanceUnlock}
                      />
                    </td>
                    <td>{x.note || "—"}</td>
                    <td>
                      <div className="cold-actions">
                        {permission.can_update && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => guardedEdit(x)}
                          >
                            Düzenle
                          </Button>
                        )}
                        {permission.can_delete && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (
                                window.confirm("Soğuk Hava gideri silinsin mi?")
                              )
                                void mutate("deleteColdExpense", {
                                  id: x.id,
                                }).catch((e) => setMessage(String(e)));
                            }}
                          >
                            <Trash2 size={14} />
                            Sil
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab !== "overview" && pages > 1 && (
        <div className="cold-pages">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Önceki
          </Button>
          <span>
            {Math.min(page, pages)} / {pages}
          </span>
          <Button
            variant="outline"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Sonraki
          </Button>
        </div>
      )}
      <datalist id="cold-product-list">
        {names.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </div>
  );
}

function PricePreview() {
  const ref = useRef<HTMLDivElement>(null),
    [total, setTotal] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () =>
      setTotal(
        (Number((form.elements.namedItem("kg") as HTMLInputElement)?.value) ||
          0) *
          (Number(
            (form.elements.namedItem("price") as HTMLInputElement)?.value,
          ) || 0),
      );
    form.addEventListener("input", update);
    update();
    return () => form.removeEventListener("input", update);
  }, []);
  return (
    <div ref={ref} className="cold-preview">
      Toplam: <strong>{fmt(total)}</strong>
    </div>
  );
}

function ExpenseBreakdown({
  rows,
  unlocked,
  unlock,
}: {
  rows: ColdExpense[];
  unlocked: boolean;
  unlock: () => void;
}) {
  const total = rows.reduce((a, x) => a + x.amount, 0),
    items = [...new Set(rows.map((x) => x.category))]
      .map((name) => {
        const amount = rows
          .filter((x) => x.category === name)
          .reduce((a, x) => a + x.amount, 0);
        return { name, amount, share: total ? (amount * 100) / total : 0 };
      })
      .sort((a, b) => b.amount - a.amount);
  return (
    <section className="gurminik-panel cold-expense-breakdown">
      <h3>Kategori dağılımı</h3>
      {items.length ? (
        items.map((x) => (
          <div key={x.name} className="cold-expense-share">
            <div>
              <span>{x.name}</span>
              <Money value={x.amount} unlocked={unlocked} unlock={unlock} />
              <b>
                %
                {new Intl.NumberFormat("tr-TR", {
                  maximumFractionDigits: 1,
                }).format(x.share)}
              </b>
            </div>
            <progress max="100" value={x.share} />
          </div>
        ))
      ) : (
        <p className="gurminik-empty">Seçili tarihlerde gider yok.</p>
      )}
    </section>
  );
}

function ColdTable({
  type,
  rows,
  unlocked,
  unlock,
  permission,
  edit,
  toggle,
}: {
  type: "purchase" | "sale";
  rows: (ColdPurchase | ColdSale)[];
  unlocked: boolean;
  unlock: () => void;
  permission: Rights;
  edit: (x: ColdPurchase | ColdSale) => void;
  toggle: (x: ColdPurchase | ColdSale) => void;
}) {
  return (
    <div className="gurminik-table-panel cold-table">
      <table>
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Ürün</th>
            <th>{type === "purchase" ? "Tedarikçi" : "Alıcı"}</th>
            <th>KG</th>
            <th>Fiyat/KG</th>
            <th>Toplam</th>
            {type === "purchase" && <th>Plaka</th>}
            <th>Durum</th>
            <th>İşlem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{ts(row.dateTime)}</td>
              <td>{row.product}</td>
              <td>{"person" in row ? row.person : row.buyer}</td>
              <td>{kilos(row.kg)}</td>
              <td>
                <Money value={row.price} unlocked={unlocked} unlock={unlock} />
              </td>
              <td>
                <Money
                  value={row.kg * row.price}
                  unlocked={unlocked}
                  unlock={unlock}
                />
              </td>
              {type === "purchase" && (
                <td>{"plate" in row ? row.plate : "—"}</td>
              )}
              <td>{row.status === "cancelled" ? "İptal" : "Aktif"}</td>
              <td>
                <div className="cold-actions">
                  {permission.can_update && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        edit(row);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Düzenle
                    </Button>
                  )}
                  {permission.can_delete && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggle(row)}
                    >
                      {row.status === "cancelled" ? "Etkinleştir" : "İptal"}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ColdReport({
  state,
  financeUnlocked,
  requestFinanceUnlock,
  onPdfExport,
}: {
  state: ColdState;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
  onPdfExport?: (name: string, start?: string | null, end?: string | null) => Promise<void>;
}) {
  const [period, setPeriod] = useState<
      "daily" | "weekly" | "monthly" | "range" | "all"
    >("monthly"),
    [date, setDate] = useState(now().slice(0, 10)),
    [from, setFrom] = useState(now().slice(0, 10)),
    [to, setTo] = useState(now().slice(0, 10));
  const base = new Date(date + "T00:00:00"),
    start =
      period === "all"
        ? -Infinity
        : period === "range"
          ? new Date(from + "T00:00:00").getTime()
          : period === "monthly"
            ? new Date(base.getFullYear(), base.getMonth(), 1).getTime()
            : period === "weekly"
              ? new Date(
                  base.getFullYear(),
                  base.getMonth(),
                  base.getDate() - ((base.getDay() + 6) % 7),
                ).getTime()
              : base.getTime();
  const end =
    period === "all"
      ? Infinity
      : period === "range"
        ? new Date(to + "T00:00:00").getTime() + 86400000
        : period === "monthly"
          ? new Date(base.getFullYear(), base.getMonth() + 1, 1).getTime()
          : period === "weekly"
            ? start + 7 * 86400000
            : start + 86400000;
  const summary = coldSummary(state, start, end),
    products = coldProducts(state),
    categories = [...new Set(state.expenses.map((x) => x.category))],
    periodExpenses = state.expenses.filter((x) => {
      const t = new Date(x.dateTime).getTime();
      return t >= start && t < end;
    }),
    periodExpenseTotal = periodExpenses.reduce((a, x) => a + x.amount, 0);
  async function pdf() {
    if (end < start) return;
    if (!financeUnlocked) {
      requestFinanceUnlock();
      return;
    }
    const file = createColdPdf(
      state,
      start,
      end,
      period === "all"
        ? "Tüm zamanlar"
        : period === "range"
          ? `${from} - ${to}`
          : date,
    );
    const url = URL.createObjectURL(
        new Blob([file], { type: "application/pdf" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `gurminik-soguk-hava-${date}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    await onPdfExport?.(
      "Soğuk Hava Deposu PDF",
      Number.isFinite(start) ? new Date(start).toISOString().slice(0,10) : null,
      Number.isFinite(end) ? new Date(end - 1).toISOString().slice(0,10) : null,
    );
  }
  return (
    <section className="gurminik-panel cold-report">
      <div className="gurminik-block-heading">
        <p>AYRI İŞLETME RAPORU</p>
        <h3>Soğuk Hava Raporu</h3>
      </div>
      <div className="cold-report-controls">
        <select
          aria-label="Soğuk Hava rapor dönemi"
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
        >
          <option value="daily">Günlük</option>
          <option value="weekly">Haftalık</option>
          <option value="monthly">Aylık</option>
          <option value="range">Tarih aralığı</option>
          <option value="all">Tüm zamanlar</option>
        </select>
        {period === "range" ? (
          <>
            <Input
              aria-label="Başlangıç"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              aria-label="Bitiş"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        ) : (
          period !== "all" && (
            <Input
              aria-label="Rapor tarihi"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )
        )}
        <Button onClick={() => void pdf()}>
          <Download size={16} />
          Soğuk Hava PDF indir
        </Button>
      </div>
      {period === "range" && end < start && (
        <p role="alert">Bitiş başlangıçtan önce olamaz.</p>
      )}
      <Totals
        summary={summary}
        unlocked={financeUnlocked}
        unlock={requestFinanceUnlock}
      />
      <div className="cold-report-breakdown">
        <article>
          <h4>Ürün bazlı</h4>
          {products.map((p) => {
            const x = coldSummary(state, start, end, p);
            return (
              <div key={p} className="gurminik-metric-row">
                <span>
                  {p} · Alış {kilos(x.buyKg)} / Satış {kilos(x.saleKg)} / Fire{" "}
                  {kilos(x.fireKg)}
                </span>
                <Money
                  value={x.profit}
                  unlocked={financeUnlocked}
                  unlock={requestFinanceUnlock}
                />
              </div>
            );
          })}
        </article>
        <article>
          <h4>Gider kategorileri</h4>
          {categories.map((c) => {
            const amount = periodExpenses
                .filter((x) => x.category === c)
                .reduce((a, x) => a + x.amount, 0),
              share = periodExpenseTotal
                ? (amount * 100) / periodExpenseTotal
                : 0;
            return (
              <div key={c} className="gurminik-metric-row">
                <span>
                  {c} · %
                  {new Intl.NumberFormat("tr-TR", {
                    maximumFractionDigits: 1,
                  }).format(share)}
                </span>
                <Money
                  value={amount}
                  unlocked={financeUnlocked}
                  unlock={requestFinanceUnlock}
                />
              </div>
            );
          })}
        </article>
      </div>
    </section>
  );
}

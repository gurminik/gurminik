"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Boxes,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  Eye,
  EyeOff,
  History,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  ReceiptText,
  Save,
  Search,
  ShieldCheck,
  ShoppingCart,
  Star,
  Trash2,
  Trophy,
  Upload,
  Users,
  WalletCards,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import {
  decodeVCardBuffer,
  formatPhone,
  normalizePhone,
  parseVCard,
  type ParsedVCardContact,
} from "@/lib/vcard";
import {
  buildPriceHistory,
  driverMatches,
  findRecentDuplicate,
  latestSalePrice,
  summarizeTransactions,
} from "@/lib/business";
import { fetchAllRows } from "@/lib/pagination";
import {
  cancellationExpired,
  cancellationNotice,
  isPermanentCancellationError,
} from "@/lib/cancellation";
import {
  ColdCategory,
  ColdExpense,
  ColdPurchase,
  ColdSale,
  ColdState,
  EMPTY_COLD,
  coldDuplicate,
  coldProducts,
  coldSummary,
} from "@/lib/cold-storage";
import { ColdStorage, ColdReport } from "@/components/cold-storage";
import { ActivityLogs, type ActivityLog } from "@/components/activity-logs";
import { DateRangeFilter } from "@/components/date-range-filter";
import { MobileNumberInput } from "@/components/mobile-number-input";
import {
  inRememberedDateRange,
  useRememberedDateRange,
} from "@/lib/date-range";
import {
  type BackupPayload,
  type RestoreMode,
  type RestoreReport,
  backupSummary,
  formatRestoreReport,
  normalizeBackupPayload,
  readBackupSettings,
  restoreBackupSettings,
} from "@/lib/backup";

type Product = {
  id: string;
  name: string;
  icon: string;
  isActive?: boolean;
  createdAt?: string;
};
type Purchase = {
  id: string;
  productId: string;
  person: string;
  plate: string;
  kg: number;
  buyPrice: number;
  dateTime: string;
  status: string;
  cancelledAt?: string | null;
  isPaid: boolean;
  createdAt?: string;
};
type Sale = {
  id: string;
  productId: string;
  buyer: string;
  driver: string;
  plate: string;
  kg: number;
  sellPrice: number;
  dateTime: string;
  status: string;
  cancelledAt?: string | null;
  createdBy?: string | null;
  createdAt?: string;
};
type Expense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  dateTime: string;
  createdAt?: string;
};
type Category = { id: string; name: string; createdAt?: string };
type ContactCategory = { id: string; name: string; createdAt?: string };
type Contact = {
  id: string;
  name: string;
  phone: string;
  category: string;
  note: string;
  createdAt?: string;
};
type AccountPayment = {
  id: string;
  company: string;
  amount: number;
  dateTime: string;
  description: string;
  method: string;
  createdAt?: string;
};
type Favorite = {
  id: string;
  person: string;
  phone: string;
  plate: string;
  lastProductId: string;
  lastBuyPrice: number | null;
  notes: string;
  createdAt?: string;
};
type ContactImportResult = { added: number; skipped: number };
type State = {
  products: Product[];
  purchases: Purchase[];
  sales: Sale[];
  expenses: Expense[];
  categories: Category[];
  contactCategories: ContactCategory[];
  contacts: Contact[];
  accountPayments: AccountPayment[];
  favorites: Favorite[];
};
type PendingOperation = {
  id: string;
  action: string;
  data: Record<string, unknown>;
  createdAt: string;
  epoch?: string;
};
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type ModuleId =
  | "dashboard"
  | "purchases"
  | "sales"
  | "ranking"
  | "expenses"
  | "contacts"
  | "accounts"
  | "favorites"
  | "cold_storage"
  | "reports"
  | "backup"
  | "activity_logs";
type View = ModuleId | "authorization";
type Permission = {
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
};
type AccessState = {
  user_id: string;
  email?: string;
  display_name?: string | null;
  role: "admin" | "user";
  is_active: boolean;
  permissions: Partial<Record<ModuleId, Permission>>;
};
type AdminUser = AccessState & { id: string; created_at: string };
type DialogType =
  | "purchase"
  | "editPurchase"
  | "sale"
  | "editSale"
  | "unlockFinance"
  | "product"
  | "deleteProduct"
  | "detail"
  | "expense"
  | "category"
  | "contact"
  | null;

const EMPTY: State = {
  products: [],
  purchases: [],
  sales: [],
  expenses: [],
  categories: [],
  contactCategories: [],
  contacts: [],
  accountPayments: [],
  favorites: [],
};
const PAGE_SIZE = 15;
const money = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(
    n || 0,
  );
const kg = (n: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n || 0) +
  " kg";
const dateTime = (v: string) =>
  new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(v));
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const localInput = (v: string) => {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const norm = (v: string) => v.toLocaleLowerCase("tr-TR").trim();
const DEFAULT_PRODUCTS = [
  { name: "Portakal", icon: "🍊" },
  { name: "Mandalina", icon: "🍊" },
  { name: "Limon", icon: "🍋" },
  { name: "Greyfurt", icon: "🟠" },
  { name: "Nar", icon: "🔴" },
];
const DEFAULT_CATEGORIES = [
  "Yemek",
  "Çalışan Ücreti",
  "Yakıt",
  "Nakliye",
  "Diğer",
];
const DEFAULT_CONTACT_CATEGORIES = [
  "Tedarikçi",
  "Fabrika",
  "Şoför",
  "Nakliyeci",
  "Çalışan",
  "Diğer",
];
const QUEUE_KEY = "gurminik_pending_operations_v1",
  STATE_CACHE_KEY = "gurminik_state_cache_v1";
const OFFLINE_ACTIONS = new Set([
  "addProduct",
  "addPurchase",
  "editPurchase",
  "togglePurchase",
  "addSale",
  "editSale",
  "toggleSale",
  "archiveProduct",
  "addExpense",
  "deleteExpense",
  "addCategory",
  "addContactCategory",
  "addContact",
  "deleteContact",
  "deleteAccountPayment",
  "addAccountPayment",
  "editAccountPayment",
  "addFavorite",
  "deleteFavorite",
  "addColdPurchase",
  "editColdPurchase",
  "toggleColdPurchase",
  "addColdSale",
  "editColdSale",
  "toggleColdSale",
  "addColdExpense",
  "editColdExpense",
  "deleteColdExpense",
  "addColdCategory",
]);
const queueKey = (userId: string) => `${QUEUE_KEY}:${userId}`;
const readQueue = (userId: string): PendingOperation[] => {
  try {
    return userId
      ? JSON.parse(localStorage.getItem(queueKey(userId)) || "[]")
      : [];
  } catch {
    return [];
  }
};
const saveQueue = (userId: string, items: PendingOperation[]) => {
  if (userId) localStorage.setItem(queueKey(userId), JSON.stringify(items));
};
const whatsAppNumber = (phone: string) => normalizePhone(phone);

const NAV = [
  ["dashboard", "Ana Sayfa", LayoutDashboard],
  ["favorites", "Favoriler", Star],
  ["purchases", "Tüm Alışlar", Boxes],
  ["sales", "Satışlar", ShoppingCart],
  ["ranking", "Sıralamalar", Trophy],
  ["expenses", "Giderler", ReceiptText],
  ["contacts", "Telefon Numaraları", Phone],
  ["accounts", "Cari Hesap", WalletCards],
  ["cold_storage", "Soğuk Hava", Cloud],
  ["reports", "Raporlar", CalendarRange],
  ["backup", "Yedekleme", Download],
] as const;
const MODULE_LABELS: Record<ModuleId, string> = {
  dashboard: "Ana Sayfa",
  favorites: "Favoriler",
  purchases: "Tüm Alışlar",
  sales: "Satışlar",
  ranking: "Sıralamalar",
  expenses: "Giderler",
  contacts: "Telefon Numaraları",
  accounts: "Cari Hesap",
  cold_storage: "Soğuk Hava",
  reports: "Raporlar",
  backup: "Yedekleme",
  activity_logs: "İşlem Geçmişi",
};
const MODULE_IDS = Object.keys(MODULE_LABELS) as ModuleId[];
const NO_ACCESS: AccessState = {
  user_id: "",
  role: "user",
  is_active: false,
  permissions: {},
};
const FULL_PERMISSION: Permission = {
  can_view: true,
  can_create: true,
  can_update: true,
  can_delete: true,
};

export default function Home() {
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(false);
  const [access, setAccess] = useState<AccessState>(NO_ACCESS),
    [accessReady, setAccessReady] = useState(false);
  const [email, setEmail] = useState("hakdag414@gmail.com"),
    [password, setPassword] = useState(""),
    [authMode, setAuthMode] = useState<"signin" | "signup">("signin"),
    [notice, setNotice] = useState(""),
    [passwordRecovery, setPasswordRecovery] = useState(false);
  const [state, setState] = useState<State>(EMPTY),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [cold, setCold] = useState<ColdState>(EMPTY_COLD);
  const [view, setView] = useState<View>("dashboard"),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogType>(null),
    [selectedProduct, setSelectedProduct] = useState<string>(""),
    [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null),
    [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [financeUnlocked, setFinanceUnlocked] = useState(false);
  const [online, setOnline] = useState(true),
    [pendingCount, setPendingCount] = useState(0),
    [syncing, setSyncing] = useState(false),
    [syncNotice, setSyncNotice] = useState("");
  const [businessEpoch, setBusinessEpoch] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const [page, setPage] = useState(1),
    [salePage, setSalePage] = useState(1),
    [contactPage, setContactPage] = useState(1),
    [expensePage, setExpensePage] = useState(1);
  const [contactSearch, setContactSearch] = useState(""),
    [period, setPeriod] = useState<
      "daily" | "weekly" | "monthly" | "range" | "full"
    >("daily");
  const [reportDate, setReportDate] = useState(localNow().slice(0, 10)),
    [rangeStart, setRangeStart] = useState(localNow().slice(0, 10)),
    [rangeEnd, setRangeEnd] = useState(localNow().slice(0, 10));

  const permissionFor = useCallback(
    (module: ModuleId): Permission =>
      access.role === "admin"
        ? FULL_PERMISSION
        : access.permissions[module] || {
            can_view: false,
            can_create: false,
            can_update: false,
            can_delete: false,
          },
    [access],
  );
  const canView = useCallback(
    (module: ModuleId) => access.is_active && permissionFor(module).can_view,
    [access.is_active, permissionFor],
  );
  const fetchAccess = useCallback(async () => {
    const { data, error: accessError } = await supabase.rpc(
      "get_my_gurminik_access",
    );
    if (accessError) throw accessError;
    return {
      ...NO_ACCESS,
      ...(data || {}),
      permissions: data?.permissions || {},
    } as AccessState;
  }, []);
  const refreshBusinessEpoch = useCallback(async (userId: string) => {
    const key = `gurminik_business_epoch:${userId}`;
    const cached = localStorage.getItem(key) || "";
    if (cached) setBusinessEpoch(cached);
    if (!navigator.onLine) return cached;
    const { data, error: epochError } = await supabase.rpc(
      "get_gurminik_business_state",
    );
    if (epochError) throw epochError;
    const epoch = String(data?.epoch || "");
    if (epoch) {
      localStorage.setItem(key, epoch);
      setBusinessEpoch(epoch);
    }
    return epoch;
  }, []);

  const fetchState = useCallback(async () => {
    const [
      purchasesResult,
      salesResult,
      productsResult,
      expensesResult,
      categoriesResult,
      contactCategoriesResult,
      contactsResult,
      accountPaymentsResult,
      favoritesResult,
    ] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("purchases")
          .select(
            "id,product_id,supplier_name,vehicle_plate,quantity_kg,unit_buy_price,transaction_at,status,cancelled_at,is_paid,created_at",
          )
          .order("transaction_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("sales")
          .select(
            "id,product_id,buyer_name,driver_name,vehicle_plate,quantity_kg,unit_sale_price,transaction_at,status,cancelled_at,created_by,created_at",
          )
          .order("transaction_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("products")
          .select("id,name,icon,is_active,created_at")
          .order("created_at")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("expenses")
          .select("id,title,category,amount,transaction_at,created_at")
          .order("transaction_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("expense_categories")
          .select("id,name,created_at")
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("contact_categories")
          .select("id,name,created_at")
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("contacts")
          .select("id,name,phone,contact_type,notes,created_at")
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("account_payments")
          .select(
            "id,company_name,amount,payment_at,description,payment_method,created_at",
          )
          .order("payment_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("favorites")
          .select(
            "id,person_name,phone,vehicle_plate,last_product_id,last_buy_price,notes,created_at",
          )
          .order("updated_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
    ]);
    const failed = [
      purchasesResult,
      salesResult,
      productsResult,
      expensesResult,
      categoriesResult,
      contactCategoriesResult,
      contactsResult,
      accountPaymentsResult,
      favoritesResult,
    ].find((x) => x.error);
    if (failed?.error) throw failed.error;
    return {
      products: (productsResult.data || []).map((x) => ({
        id: x.id,
        name: x.name,
        icon: x.icon || "●",
        isActive: x.is_active !== false,
        createdAt: x.created_at,
      })),
      purchases: (purchasesResult.data || []).map((x) => ({
        id: x.id,
        productId: x.product_id,
        person: x.supplier_name,
        plate: x.vehicle_plate || "",
        kg: Number(x.quantity_kg),
        buyPrice: Number(x.unit_buy_price),
        dateTime: x.transaction_at,
        status: x.status || "active",
        cancelledAt: x.cancelled_at,
        isPaid: x.is_paid !== false,
        createdAt: x.created_at,
      })),
      sales: (salesResult.data || []).map((x) => ({
        id: x.id,
        productId: x.product_id,
        buyer: x.buyer_name || "Alıcı",
        driver: x.driver_name || "",
        plate: x.vehicle_plate || "",
        kg: Number(x.quantity_kg),
        sellPrice: Number(x.unit_sale_price),
        dateTime: x.transaction_at,
        status: x.status || "active",
        cancelledAt: x.cancelled_at,
        createdBy: x.created_by,
        createdAt: x.created_at,
      })),
      expenses: (expensesResult.data || []).map((x) => ({
        id: x.id,
        title: x.title,
        category: x.category,
        amount: Number(x.amount),
        dateTime: x.transaction_at,
        createdAt: x.created_at,
      })),
      categories: (categoriesResult.data || []).map((x) => ({
        id: x.id,
        name: x.name,
        createdAt: x.created_at,
      })),
      contactCategories: (contactCategoriesResult.data || []).map((x) => ({
        id: x.id,
        name: x.name,
        createdAt: x.created_at,
      })),
      contacts: (contactsResult.data || []).map((x) => ({
        id: x.id,
        name: x.name,
        phone: x.phone || "",
        category: x.contact_type || "Diğer",
        note: x.notes || "",
        createdAt: x.created_at,
      })),
      accountPayments: (accountPaymentsResult.data || []).map((x) => ({
        id: x.id,
        company: x.company_name,
        amount: Number(x.amount),
        dateTime: x.payment_at,
        description: x.description || "",
        method: x.payment_method || "",
        createdAt: x.created_at,
      })),
      favorites: (favoritesResult.data || []).map((x) => ({
        id: x.id,
        person: x.person_name,
        phone: x.phone || "",
        plate: x.vehicle_plate || "",
        lastProductId: x.last_product_id || "",
        lastBuyPrice:
          x.last_buy_price === null ? null : Number(x.last_buy_price),
        notes: x.notes || "",
        createdAt: x.created_at,
      })),
    } satisfies State;
  }, []);
  const fetchCold = useCallback(async (): Promise<ColdState> => {
    const [p, s, e, c, cp] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("cold_storage_purchases")
          .select(
            "id,product_id,product_name,supplier_name,vehicle_plate,quantity_kg,unit_buy_price,transaction_at,notes,status,cancelled_at",
          )
          .order("transaction_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("cold_storage_sales")
          .select(
            "id,product_id,product_name,buyer_name,quantity_kg,unit_sale_price,transaction_at,notes,status,cancelled_at",
          )
          .order("transaction_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("cold_storage_expenses")
          .select(
            "id,product_id,title,category,amount,product_name,loss_kg,expense_scope,transaction_at,notes",
          )
          .order("transaction_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("cold_storage_expense_categories")
          .select("id,name")
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase.from("cold_storage_products").select("id,name,is_active").order("name").order("id").range(from,to),
      ),
    ]);
    const failed = [p, s, e, c, cp].find((x) => x.error);
    if (failed?.error) throw failed.error;
    return {
      purchases: (p.data || []).map((x) => ({
        id: x.id,
        productId: x.product_id || "",
        product: x.product_name,
        person: x.supplier_name,
        plate: x.vehicle_plate,
        kg: Number(x.quantity_kg),
        price: Number(x.unit_buy_price),
        dateTime: x.transaction_at,
        note: x.notes,
        status: x.status,
        cancelledAt: x.cancelled_at,
      })),
      sales: (s.data || []).map((x) => ({
        id: x.id,
        productId: x.product_id || "",
        product: x.product_name,
        buyer: x.buyer_name,
        kg: Number(x.quantity_kg),
        price: Number(x.unit_sale_price),
        dateTime: x.transaction_at,
        note: x.notes,
        status: x.status,
        cancelledAt: x.cancelled_at,
      })),
      expenses: (e.data || []).map((x) => ({
        id: x.id,
        productId: x.product_id || "",
        title: x.title,
        category: x.category,
        amount: Number(x.amount),
        product: x.product_name || "",
        lossKg: Number(x.loss_kg || 0),
        scope: x.expense_scope === "purchase" || x.expense_scope === "sale" ? x.expense_scope : "general",
        dateTime: x.transaction_at,
        note: x.notes,
      })),
      categories: (c.data || []).map((x) => ({ id: x.id, name: x.name })),
      products: (cp.data || []).map((x)=>({id:x.id,name:x.name,isActive:x.is_active!==false})),
    };
  }, []);
  const load = useCallback(
    async (asAdmin = false, userId = "", coldAllowed = false) => {
      setLoading(true);
      setError("");
      try {
        if (asAdmin) {
          const claimed = await supabase.rpc("claim_gurminik_import");
          if (claimed.error) throw claimed.error;
        }
        let next = await fetchState();
        if (asAdmin && !next.products.length) {
          const inserted = await supabase
            .from("products")
            .insert(DEFAULT_PRODUCTS);
          if (inserted.error) throw inserted.error;
        }
        if (asAdmin && !next.categories.length) {
          const inserted = await supabase
            .from("expense_categories")
            .insert(DEFAULT_CATEGORIES.map((name) => ({ name })));
          if (inserted.error) throw inserted.error;
        }
        if (asAdmin && !next.contactCategories.length) {
          const inserted = await supabase
            .from("contact_categories")
            .insert(DEFAULT_CONTACT_CATEGORIES.map((name) => ({ name })));
          if (inserted.error) throw inserted.error;
        }
        if (
          asAdmin &&
          (!next.products.length ||
            !next.categories.length ||
            !next.contactCategories.length)
        )
          next = await fetchState();
        setState(next);
        if (userId)
          try {
            localStorage.setItem(
              `${STATE_CACHE_KEY}:${userId}`,
              JSON.stringify(next),
            );
          } catch {
            setSyncNotice(
              "Cihaz önbelleği dolu; bulut kayıtları açık, çevrimdışı görüntüleme sınırlı.",
            );
          }
        if (coldAllowed || asAdmin) {
          const coldNext = await fetchCold();
          setCold(coldNext);
          if (userId)
            try {
              localStorage.setItem(
                `${STATE_CACHE_KEY}:${userId}:cold`,
                JSON.stringify(coldNext),
              );
            } catch {
              setSyncNotice(
                "Cihaz önbelleği dolu; Soğuk Hava çevrimdışı görüntülenemeyebilir.",
              );
            }
        } else setCold(EMPTY_COLD);
      } catch (e) {
        try {
          const cached = userId
            ? JSON.parse(
                localStorage.getItem(`${STATE_CACHE_KEY}:${userId}`) || "",
              )
            : null;
          if (cached?.products) {
            setState({ ...EMPTY, ...cached });
            if (coldAllowed || asAdmin) {
              const coldCached = JSON.parse(
                localStorage.getItem(`${STATE_CACHE_KEY}:${userId}:cold`) ||
                  "null",
              );
              setCold(
                coldCached ? { ...EMPTY_COLD, ...coldCached } : EMPTY_COLD,
              );
            } else setCold(EMPTY_COLD);
            setSyncNotice("Bu hesaba ait çevrimdışı kayıtlar gösteriliyor.");
            return;
          }
        } catch {}
        setError(
          e instanceof Error ? e.message : "Bulut verileri yüklenemedi.",
        );
      } finally {
        setLoading(false);
      }
    },
    [fetchState, fetchCold],
  );
  const reload = useCallback(
    () =>
      load(
        access.role === "admin",
        session?.user.id || "",
        access.permissions.cold_storage?.can_view || false,
      ),
    [
      access.role,
      access.permissions.cold_storage?.can_view,
      load,
      session?.user.id,
    ],
  );
  useEffect(() => {
    let active = true;
    const apply = async (next: Session | null) => {
      if (!active) return;
      setFinanceUnlocked(false);
      setSession(next);
      setAuthReady(true);
      setAccessReady(false);
      if (next) {
        try {
          await refreshBusinessEpoch(next.user.id);
          const nextAccess = await fetchAccess();
          if (!active) return;
          setAccess(nextAccess);
          setAccessReady(true);
          if (
            nextAccess.is_active &&
            (nextAccess.role === "admin" ||
              MODULE_IDS.some((id) => nextAccess.permissions[id]?.can_view))
          )
            await load(
              nextAccess.role === "admin",
              next.user.id,
              nextAccess.permissions.cold_storage?.can_view || false,
            );
          else {
            setState(EMPTY);
            setCold(EMPTY_COLD);
          }
        } catch (e) {
          setAccess(NO_ACCESS);
          setAccessReady(true);
          setState(EMPTY);
          setCold(EMPTY_COLD);
          setError(e instanceof Error ? e.message : "Yetkiler okunamadı.");
        }
      } else {
        setAccess(NO_ACCESS);
        setAccessReady(true);
        setState(EMPTY);
        setCold(EMPTY_COLD);
      }
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      void apply(next);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [fetchAccess, load, refreshBusinessEpoch]);
  const executeMutation = useCallback(
    async (action: string, data: Record<string, unknown>) => {
      let result;
      if (action === "addProduct")
        result = await supabase
          .from("products")
          .upsert(
            {
              id: data.id,
              name: String(data.name),
              icon: String(data.icon || "●"),
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "addPurchase")
        result = await supabase
          .from("purchases")
          .upsert(
            {
              id: data.id,
              product_id: data.productId,
              supplier_name: String(data.person),
              vehicle_plate: String(data.plate).toLocaleUpperCase("tr-TR"),
              quantity_kg: Number(data.kg),
              unit_buy_price: Number(data.buyPrice),
              transaction_at: new Date(String(data.dateTime)).toISOString(),
              status: "active",
              is_paid: data.isPaid !== "false",
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "editPurchase")
        result = await supabase
          .from("purchases")
          .update({
            product_id: data.productId,
            supplier_name: String(data.person),
            vehicle_plate: String(data.plate).toLocaleUpperCase("tr-TR"),
            quantity_kg: Number(data.kg),
            unit_buy_price: Number(data.buyPrice),
            transaction_at: new Date(String(data.dateTime)).toISOString(),
            is_paid: data.isPaid !== "false",
          })
          .eq("id", data.id);
      else if (action === "togglePurchase")
        result = await supabase
          .from("purchases")
          .update({ status: data.status })
          .eq("id", data.id);
      else if (action === "addSale")
        result = await supabase
          .from("sales")
          .upsert(
            {
              id: data.id,
              product_id: data.productId,
              buyer_name: String(data.buyer),
              driver_name: String(data.driver || ""),
              vehicle_plate: String(data.plate || "").toLocaleUpperCase(
                "tr-TR",
              ),
              quantity_kg: Number(data.kg),
              unit_sale_price: Number(data.sellPrice),
              transaction_at: new Date(String(data.dateTime)).toISOString(),
              status: "active",
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "editSale")
        result = await supabase
          .from("sales")
          .update({
            product_id: data.productId,
            buyer_name: String(data.buyer),
            driver_name: String(data.driver || ""),
            vehicle_plate: String(data.plate || "").toLocaleUpperCase("tr-TR"),
            quantity_kg: Number(data.kg),
            unit_sale_price: Number(data.sellPrice),
            transaction_at: new Date(String(data.dateTime)).toISOString(),
          })
          .eq("id", data.id);
      else if (action === "toggleSale")
        result = await supabase
          .from("sales")
          .update({ status: data.status })
          .eq("id", data.id);
      else if (action === "archiveProduct")
        result = await supabase
          .from("products")
          .update({ is_active: false })
          .eq("id", data.id);
      else if (action === "addExpense")
        result = await supabase
          .from("expenses")
          .upsert(
            {
              id: data.id,
              title: String(data.title),
              category: String(data.category),
              amount: Number(data.amount),
              transaction_at: new Date(String(data.dateTime)).toISOString(),
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "deleteExpense")
        result = await supabase.from("expenses").delete().eq("id", data.id);
      else if (action === "addCategory")
        result = await supabase
          .from("expense_categories")
          .upsert(
            { id: data.id, name: String(data.name) },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "addContactCategory")
        result = await supabase
          .from("contact_categories")
          .upsert(
            { id: data.id, name: String(data.name) },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "addContact")
        result = await supabase
          .from("contacts")
          .upsert(
            {
              id: data.id,
              name: String(data.name),
              phone: String(data.phone),
              notes: String(data.note || ""),
              contact_type: String(data.category || "Diğer"),
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "deleteContact")
        result = await supabase.from("contacts").delete().eq("id", data.id);
      else if (action === "addAccountPayment")
        result = await supabase
          .from("account_payments")
          .upsert(
            {
              id: data.id,
              company_name: String(data.company),
              amount: Number(data.amount),
              payment_at: new Date(String(data.dateTime)).toISOString(),
              description: String(data.description || ""),
              payment_method: String(data.method || ""),
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "editAccountPayment")
        result = await supabase
          .from("account_payments")
          .update({
            company_name: String(data.company),
            amount: Number(data.amount),
            payment_at: new Date(String(data.dateTime)).toISOString(),
            description: String(data.description || ""),
            payment_method: String(data.method || ""),
          })
          .eq("id", data.id);
      else if (action === "deleteAccountPayment")
        result = await supabase
          .from("account_payments")
          .delete()
          .eq("id", data.id);
      else if (action === "addColdPurchase" || action === "editColdPurchase") {
        const row = {
          product_id: data.productId || null,
          product_name: String(data.product).trim(),
          supplier_name: String(data.person).trim(),
          vehicle_plate: String(data.plate || "").toLocaleUpperCase("tr-TR"),
          quantity_kg: Number(data.kg),
          unit_buy_price: Number(data.price),
          transaction_at: new Date(String(data.dateTime)).toISOString(),
          notes: String(data.note || ""),
        };
        result =
          action === "addColdPurchase"
            ? await supabase
                .from("cold_storage_purchases")
                .upsert(
                  { id: data.id, ...row },
                  { onConflict: "id", ignoreDuplicates: true },
                )
            : await supabase
                .from("cold_storage_purchases")
                .update(row)
                .eq("id", data.id);
      } else if (action === "toggleColdPurchase")
        result = await supabase
          .from("cold_storage_purchases")
          .update({ status: data.status })
          .eq("id", data.id);
      else if (action === "addColdSale" || action === "editColdSale") {
        const row = {
          product_id: data.productId || null,
          product_name: String(data.product).trim(),
          buyer_name: String(data.buyer).trim(),
          quantity_kg: Number(data.kg),
          unit_sale_price: Number(data.price),
          transaction_at: new Date(String(data.dateTime)).toISOString(),
          notes: String(data.note || ""),
        };
        result =
          action === "addColdSale"
            ? await supabase
                .from("cold_storage_sales")
                .upsert(
                  { id: data.id, ...row },
                  { onConflict: "id", ignoreDuplicates: true },
                )
            : await supabase
                .from("cold_storage_sales")
                .update(row)
                .eq("id", data.id);
      } else if (action === "toggleColdSale")
        result = await supabase
          .from("cold_storage_sales")
          .update({ status: data.status })
          .eq("id", data.id);
      else if (action === "addColdExpense" || action === "editColdExpense") {
        const row = {
          title: String(data.title).trim(),
          category: String(data.category).trim(),
          amount: Number(data.amount || 0),
          product_name: String(data.product || "").trim() || null,
          product_id: data.productId || null,
          expense_scope: String(data.scope || "general"),
          loss_kg:
            data.lossKg === "" || data.lossKg === undefined
              ? null
              : Number(data.lossKg),
          transaction_at: new Date(String(data.dateTime)).toISOString(),
          notes: String(data.note || ""),
        };
        result =
          action === "addColdExpense"
            ? await supabase
                .from("cold_storage_expenses")
                .upsert(
                  { id: data.id, ...row },
                  { onConflict: "id", ignoreDuplicates: true },
                )
            : await supabase
                .from("cold_storage_expenses")
                .update(row)
                .eq("id", data.id);
      } else if (action === "deleteColdExpense")
        result = await supabase
          .from("cold_storage_expenses")
          .delete()
          .eq("id", data.id);
      else if (action === "addColdCategory")
        result = await supabase
          .from("cold_storage_expense_categories")
          .upsert(
            { id: data.id, name: String(data.name).trim() },
            { onConflict: "id", ignoreDuplicates: true },
          );
      else if (action === "addColdProduct")
        result = await supabase.from("cold_storage_products").upsert({id:data.id,name:String(data.name).trim(),is_active:true},{onConflict:"id",ignoreDuplicates:true});
      else if (action === "archiveColdProduct")
        result = await supabase.from("cold_storage_products").update({is_active:false}).eq("id",data.id);
      else if (action === "reactivateColdProduct")
        result = await supabase.from("cold_storage_products").update({is_active:true}).eq("id",data.id);
      else if (action === "addFavorite")
        result = await supabase
          .from("favorites")
          .insert({
            id: data.id,
            person_name: String(data.person),
            phone: String(data.phone || ""),
            vehicle_plate: String(data.plate || "").toLocaleUpperCase("tr-TR"),
            last_product_id: data.lastProductId || null,
            last_buy_price:
              data.lastBuyPrice === null || data.lastBuyPrice === ""
                ? null
                : Number(data.lastBuyPrice),
            notes: String(data.notes || ""),
          });
      else if (action === "deleteFavorite")
        result = await supabase.from("favorites").delete().eq("id", data.id);
      else if (action === "importBackup") {
        result = await supabase.rpc("restore_gurminik_backup_v4", {
          payload: data,
          restore_mode: "merge",
        });
      } else throw new Error("Geçersiz işlem.");
      if (result.error) throw result.error;
    },
    [],
  );
  function applyLocalColdMutation(
    action: string,
    data: Record<string, unknown>,
  ) {
    const dateTime = new Date(
      String(data.dateTime || new Date().toISOString()),
    ).toISOString();
    setCold((prev) => {
      const next = { ...prev };
      if (action === "addColdPurchase" || action === "editColdPurchase") {
        const row: ColdPurchase = {
          id: String(data.id),
          productId: String(data.productId || ""),
          product: String(data.product),
          person: String(data.person),
          plate: String(data.plate || ""),
          kg: Number(data.kg),
          price: Number(data.price),
          dateTime,
          note: String(data.note || ""),
          status: "active",
          cancelledAt: null,
        };
        next.purchases =
          action === "addColdPurchase"
            ? [row, ...prev.purchases]
            : prev.purchases.map((x) =>
                x.id === row.id
                  ? { ...row, status: x.status, cancelledAt: x.cancelledAt }
                  : x,
              );
      } else if (action === "toggleColdPurchase")
        next.purchases = prev.purchases.map((x) =>
          x.id === data.id
            ? {
                ...x,
                status: String(data.status),
                cancelledAt:
                  data.status === "cancelled" ? new Date().toISOString() : null,
              }
            : x,
        );
      else if (action === "addColdSale" || action === "editColdSale") {
        const row: ColdSale = {
          id: String(data.id),
          productId: String(data.productId || ""),
          product: String(data.product),
          buyer: String(data.buyer),
          kg: Number(data.kg),
          price: Number(data.price),
          dateTime,
          note: String(data.note || ""),
          status: "active",
          cancelledAt: null,
        };
        next.sales =
          action === "addColdSale"
            ? [row, ...prev.sales]
            : prev.sales.map((x) =>
                x.id === row.id
                  ? { ...row, status: x.status, cancelledAt: x.cancelledAt }
                  : x,
              );
      } else if (action === "toggleColdSale")
        next.sales = prev.sales.map((x) =>
          x.id === data.id
            ? {
                ...x,
                status: String(data.status),
                cancelledAt:
                  data.status === "cancelled" ? new Date().toISOString() : null,
              }
            : x,
        );
      else if (action === "addColdExpense" || action === "editColdExpense") {
        const row: ColdExpense = {
          id: String(data.id),
          productId: String(data.productId || ""),
          title: String(data.title),
          category: String(data.category),
          amount: Number(data.amount || 0),
          product: String(data.product || ""),
          lossKg: Number(data.lossKg || 0),
          scope: data.scope === "purchase" || data.scope === "sale" ? data.scope : "general",
          dateTime,
          note: String(data.note || ""),
        };
        next.expenses =
          action === "addColdExpense"
            ? [row, ...prev.expenses]
            : prev.expenses.map((x) => (x.id === row.id ? row : x));
      } else if (action === "deleteColdExpense")
        next.expenses = prev.expenses.filter((x) => x.id !== data.id);
      else if (action === "addColdCategory")
        next.categories = [
          ...prev.categories,
          { id: String(data.id), name: String(data.name) } as ColdCategory,
        ];
      else if (action === "addColdProduct") next.products=[...(prev.products||[]),{id:String(data.id),name:String(data.name),isActive:true}];
      else if (action === "archiveColdProduct") next.products=(prev.products||[]).map((x)=>x.id===data.id?{...x,isActive:false}:x);
      else if (action === "reactivateColdProduct") next.products=(prev.products||[]).map((x)=>x.id===data.id?{...x,isActive:true}:x);
      if (session?.user.id)
        try {
          localStorage.setItem(
            `${STATE_CACHE_KEY}:${session.user.id}:cold`,
            JSON.stringify(next),
          );
        } catch {
          setSyncNotice(
            "Soğuk Hava cihaz önbelleği dolu; bulut senkronunu kontrol edin.",
          );
        }
      return next;
    });
  }
  function applyLocalMutation(action: string, data: Record<string, unknown>) {
    if (action.includes("Cold")) {
      applyLocalColdMutation(action, data);
      return;
    }
    const iso = () =>
      new Date(String(data.dateTime || new Date().toISOString())).toISOString();
    setState((prev) => {
      const next = { ...prev };
      if (action === "addProduct")
        next.products = [
          ...prev.products,
          {
            id: String(data.id),
            name: String(data.name),
            icon: String(data.icon || "●"),
            isActive: true,
          },
        ];
      else if (action === "addPurchase")
        next.purchases = [
          {
            id: String(data.id),
            productId: String(data.productId),
            person: String(data.person),
            plate: String(data.plate).toLocaleUpperCase("tr-TR"),
            kg: Number(data.kg),
            buyPrice: Number(data.buyPrice),
            dateTime: iso(),
            status: "active",
            cancelledAt: null,
            isPaid: data.isPaid !== "false",
          },
          ...prev.purchases,
        ];
      else if (action === "editPurchase")
        next.purchases = prev.purchases.map((x) =>
          x.id === data.id
            ? {
                ...x,
                productId: String(data.productId),
                person: String(data.person),
                plate: String(data.plate).toLocaleUpperCase("tr-TR"),
                kg: Number(data.kg),
                buyPrice: Number(data.buyPrice),
                dateTime: iso(),
                isPaid: data.isPaid !== "false",
              }
            : x,
        );
      else if (action === "togglePurchase")
        next.purchases = prev.purchases.map((x) =>
          x.id === data.id
            ? {
                ...x,
                status: String(data.status),
                cancelledAt:
                  data.status === "cancelled" ? new Date().toISOString() : null,
              }
            : x,
        );
      else if (action === "addSale")
        next.sales = [
          {
            id: String(data.id),
            productId: String(data.productId),
            buyer: String(data.buyer),
            driver: String(data.driver || ""),
            plate: String(data.plate || "").toLocaleUpperCase("tr-TR"),
            kg: Number(data.kg),
            sellPrice: Number(data.sellPrice),
            dateTime: iso(),
            status: "active",
            cancelledAt: null,
            createdBy: session?.user.id,
          },
          ...prev.sales,
        ];
      else if (action === "editSale")
        next.sales = prev.sales.map((x) =>
          x.id === data.id
            ? {
                ...x,
                productId: String(data.productId),
                buyer: String(data.buyer),
                driver: String(data.driver || ""),
                plate: String(data.plate || "").toLocaleUpperCase("tr-TR"),
                kg: Number(data.kg),
                sellPrice: Number(data.sellPrice),
                dateTime: iso(),
              }
            : x,
        );
      else if (action === "toggleSale")
        next.sales = prev.sales.map((x) =>
          x.id === data.id
            ? {
                ...x,
                status: String(data.status),
                cancelledAt:
                  data.status === "cancelled" ? new Date().toISOString() : null,
              }
            : x,
        );
      else if (action === "archiveProduct")
        next.products = prev.products.map((x) =>
          x.id === data.id ? { ...x, isActive: false } : x,
        );
      else if (action === "addExpense")
        next.expenses = [
          {
            id: String(data.id),
            title: String(data.title),
            category: String(data.category),
            amount: Number(data.amount),
            dateTime: iso(),
          },
          ...prev.expenses,
        ];
      else if (action === "deleteExpense")
        next.expenses = prev.expenses.filter((x) => x.id !== data.id);
      else if (action === "addCategory")
        next.categories = [
          ...prev.categories,
          { id: String(data.id), name: String(data.name) },
        ];
      else if (action === "addContactCategory")
        next.contactCategories = [
          ...prev.contactCategories,
          { id: String(data.id), name: String(data.name) },
        ];
      else if (action === "addContact")
        next.contacts = [
          ...prev.contacts,
          {
            id: String(data.id),
            name: String(data.name),
            phone: String(data.phone),
            category: String(data.category || "Diğer"),
            note: String(data.note || ""),
          },
        ];
      else if (action === "deleteContact")
        next.contacts = prev.contacts.filter((x) => x.id !== data.id);
      else if (action === "addAccountPayment")
        next.accountPayments = [
          {
            id: String(data.id),
            company: String(data.company),
            amount: Number(data.amount),
            dateTime: iso(),
            description: String(data.description || ""),
            method: String(data.method || ""),
          },
          ...prev.accountPayments,
        ];
      else if (action === "editAccountPayment")
        next.accountPayments = prev.accountPayments.map((x) =>
          x.id === data.id
            ? {
                ...x,
                company: String(data.company),
                amount: Number(data.amount),
                dateTime: iso(),
                description: String(data.description || ""),
                method: String(data.method || ""),
              }
            : x,
        );
      else if (action === "deleteAccountPayment")
        next.accountPayments = prev.accountPayments.filter(
          (x) => x.id !== data.id,
        );
      else if (action === "addFavorite")
        next.favorites = [
          {
            id: String(data.id),
            person: String(data.person),
            phone: String(data.phone || ""),
            plate: String(data.plate || "").toLocaleUpperCase("tr-TR"),
            lastProductId: String(data.lastProductId || ""),
            lastBuyPrice:
              data.lastBuyPrice === null || data.lastBuyPrice === ""
                ? null
                : Number(data.lastBuyPrice),
            notes: String(data.notes || ""),
          },
          ...prev.favorites,
        ];
      else if (action === "deleteFavorite")
        next.favorites = prev.favorites.filter((x) => x.id !== data.id);
      if (session?.user.id)
        try {
          localStorage.setItem(
            `${STATE_CACHE_KEY}:${session.user.id}`,
            JSON.stringify(next),
          );
        } catch {
          setSyncNotice(
            "Cihaz önbelleği dolu; kayıt gönderme durumunu kontrol edin.",
          );
        }
      return next;
    });
  }
  async function mutate(action: string, data: Record<string, unknown>) {
    const requirement: Partial<Record<string, [ModuleId, keyof Permission]>> = {
      addProduct: ["dashboard", "can_create"],
      archiveProduct: ["dashboard", "can_delete"],
      addPurchase: ["purchases", "can_create"],
      editPurchase: ["purchases", "can_update"],
      togglePurchase: ["purchases", "can_delete"],
      addSale: ["sales", "can_create"],
      editSale: ["sales", "can_update"],
      toggleSale: ["sales", "can_delete"],
      addExpense: ["expenses", "can_create"],
      deleteExpense: ["expenses", "can_delete"],
      addCategory: ["expenses", "can_create"],
      addContactCategory: ["contacts", "can_create"],
      addContact: ["contacts", "can_create"],
      deleteContact: ["contacts", "can_delete"],
      addAccountPayment: ["accounts", "can_create"],
      editAccountPayment: ["accounts", "can_update"],
      deleteAccountPayment: ["accounts", "can_delete"],
      addFavorite: ["favorites", "can_create"],
      deleteFavorite: ["favorites", "can_delete"],
      importBackup: ["backup", "can_create"],
      addColdPurchase: ["cold_storage", "can_create"],
      editColdPurchase: ["cold_storage", "can_update"],
      toggleColdPurchase: ["cold_storage", "can_delete"],
      addColdSale: ["cold_storage", "can_create"],
      editColdSale: ["cold_storage", "can_update"],
      toggleColdSale: ["cold_storage", "can_delete"],
      addColdExpense: ["cold_storage", "can_create"],
      editColdExpense: ["cold_storage", "can_update"],
      deleteColdExpense: ["cold_storage", "can_delete"],
      addColdCategory: ["cold_storage", "can_create"],
      addColdProduct: ["cold_storage", "can_create"],
      archiveColdProduct: ["cold_storage", "can_delete"],
      reactivateColdProduct: ["cold_storage", "can_update"],
    };
    const needed = requirement[action];
    if (needed && !permissionFor(needed[0])[needed[1]]) {
      const message = "Bu işlem için yetkiniz bulunmuyor.";
      setError(message);
      throw new Error(message);
    }
    if (action === "addPurchase" || action === "addSale") {
      const candidate = {
        id: String(data.id),
        productId: String(data.productId),
        kg: Number(data.kg),
        dateTime: new Date(String(data.dateTime)).toISOString(),
        status: "active",
      };
      const similar =
        action === "addPurchase"
          ? findRecentDuplicate(
              state.purchases,
              {
                ...candidate,
                person: String(data.person),
                plate: String(data.plate || ""),
                buyPrice: Number(data.buyPrice),
                isPaid: data.isPaid !== "false",
              },
              "purchase",
            )
          : findRecentDuplicate(
              state.sales,
              {
                ...candidate,
                buyer: String(data.buyer),
                driver: String(data.driver || ""),
                plate: String(data.plate || ""),
                sellPrice: Number(data.sellPrice),
              },
              "sale",
            );
      if (
        similar &&
        !window.confirm(
          `Bu kayda çok benzeyen yakın tarihli bir ${action === "addPurchase" ? "alış" : "satış"} kaydı bulundu. Yine de kaydetmek istiyor musunuz?`,
        )
      )
        throw new Error("Kayıt işlemi iptal edildi.");
    }
    if (action === "addColdPurchase" || action === "addColdSale") {
      const row = {
        id: String(data.id),
        productId: String(data.productId || ""),
        product: String(data.product),
        kg: Number(data.kg),
        price: Number(data.price),
        dateTime: new Date(String(data.dateTime)).toISOString(),
        status: "active",
        person: String(data.person || ""),
        plate: String(data.plate || ""),
        buyer: String(data.buyer || ""),
        note: String(data.note || ""),
      };
      const similar =
        action === "addColdPurchase"
          ? coldDuplicate(cold.purchases, row)
          : coldDuplicate(cold.sales, row);
      if (
        similar &&
        !window.confirm(
          "Bu kayda çok benzeyen yakın tarihli bir Soğuk Hava işlemi bulundu. Yine de Kaydet?",
        )
      )
        throw new Error("Kayıt işlemi iptal edildi.");
    }
    setError("");
    const userId = session?.user.id || "";
    const queueOperation = () => {
      const items = readQueue(userId);
      if (
        items.some((item) => item.action === action && item.data.id === data.id)
      )
        return;
      items.push({
        id: crypto.randomUUID(),
        action,
        data,
        createdAt: new Date().toISOString(),
        epoch: businessEpoch,
      });
      saveQueue(userId, items);
      setPendingCount(items.length);
      applyLocalMutation(action, data);
      setSyncNotice(
        "Kayıt cihazda bekliyor. İnternet gelince otomatik gönderilecek.",
      );
    };
    if (!navigator.onLine && OFFLINE_ACTIONS.has(action)) {
      queueOperation();
      return;
    }
    try {
      await executeMutation(action, data);
      await reload();
      setSyncNotice("Bulutla senkronize edildi.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "İşlem tamamlanamadı.";
      if (isPermanentCancellationError(e)) {
        await reload();
        const permanentMessage =
          "Bu kaydın 7 günlük geri alma süresi dolmuş ve kayıt kalıcı silme sürecine alınmış.";
        setError(permanentMessage);
        throw new Error(permanentMessage);
      }
      if (
        OFFLINE_ACTIONS.has(action) &&
        (/fetch|network|internet/i.test(message) || !navigator.onLine)
      ) {
        queueOperation();
        return;
      }
      setError(message);
      throw e;
    }
  }
  const flushQueue = useCallback(async () => {
    const userId = session?.user.id || "",
      queued = readQueue(userId);
    let currentEpoch = businessEpoch;
    try {
      currentEpoch = await refreshBusinessEpoch(userId);
    } catch {
      return;
    }
    const items = queued.filter(
      (item) => !!item.epoch && item.epoch === currentEpoch,
    );
    if (items.length !== queued.length) {
      saveQueue(userId, items);
      setPendingCount(items.length);
      setSyncNotice(
        "Eski sezona ait bekleyen kayıtlar güvenlik nedeniyle yeniden gönderilmedi.",
      );
    }
    if (!items.length || !navigator.onLine) return;
    setSyncing(true);
    let remaining = [...items];
    try {
      for (const item of items) {
        try {
          await executeMutation(item.action, item.data);
        } catch (error) {
          if (!isPermanentCancellationError(error)) throw error;
          // A compact server-side audit tombstone proves that this id was
          // already purged or its restore window expired. Discard the stale
          // offline operation so it cannot recreate the deleted record.
        }
        remaining = remaining.filter((x) => x.id !== item.id);
        saveQueue(userId, remaining);
        setPendingCount(remaining.length);
      }
      await reload();
      setSyncNotice(
        "Bekleyen kayıtlar işlendi; süresi dolmuş eski işlemler yeniden oluşturulmadı.",
      );
    } catch {
      setSyncNotice("Bazı kayıtlar hâlâ cihazda bekliyor.");
    } finally {
      setSyncing(false);
    }
  }, [businessEpoch, executeMutation, refreshBusinessEpoch, reload, session?.user.id]);
  useEffect(() => {
    const userId = session?.user.id || "",
      initialize = window.setTimeout(() => {
        setOnline(navigator.onLine);
        setPendingCount(readQueue(userId).length);
        if (navigator.onLine && session) void flushQueue();
      }, 0);
    const onOnline = () => {
        setOnline(true);
        void flushQueue();
      },
      onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearTimeout(initialize);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushQueue, session]);
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const refreshPermissions = async () => {
      try {
        const next = await fetchAccess();
        setAccess(next);
        const permitted =
          next.role === "admin" ||
          MODULE_IDS.some((id) => next.permissions[id]?.can_view);
        if (!permitted) {
          setState(EMPTY);
          setCold(EMPTY_COLD);
          return;
        }
        if (
          view !== "authorization" &&
          next.role !== "admin" &&
          !next.permissions[view as ModuleId]?.can_view
        ) {
          setView(
            MODULE_IDS.find((id) => next.permissions[id]?.can_view) ||
              "dashboard",
          );
        }
        await load(
          next.role === "admin",
          session.user.id,
          next.permissions.cold_storage?.can_view || false,
        );
      } catch {
        setError("Yetkiler yenilenemedi.");
      }
    };
    const channel = supabase
      .channel("gurminik-live-sync")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (
            payload.table === "profiles" ||
            payload.table === "user_permissions"
          )
            void refreshPermissions();
          else void reload();
        }, 500);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [fetchAccess, load, reload, session, view]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js");
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      return;
    }
    window.alert(
      "Telefonda tarayıcının Paylaş veya Menü bölümünden ‘Ana Ekrana Ekle’ seçeneğine dokunun.",
    );
  }
  async function createBackup(): Promise<BackupPayload> {
    if (!session) throw new Error("Bulut oturumu bulunamadı.");
    if (!navigator.onLine)
      throw new Error("Eksiksiz yedek almak için internet bağlantısı gerekir.");
    const { data, error: backupError } = await supabase.rpc(
      "export_gurminik_backup_v4",
    );
    if (backupError) throw backupError;
    return normalizeBackupPayload({
      ...(data as Record<string, unknown>),
      settings: readBackupSettings(session.user.id),
    });
  }
  async function importBackup(
    payload: BackupPayload,
    mode: RestoreMode,
  ): Promise<RestoreReport> {
    if (!session) throw new Error("Bulut oturumu bulunamadı.");
    if (!navigator.onLine)
      throw new Error("Yedek geri yükleme için internet bağlantısı gerekir.");
    const summary = backupSummary(payload);
    if (
      (summary.coldPurchases || summary.coldSales || summary.coldExpenses) &&
      !permissionFor("cold_storage").can_create
    )
      throw new Error(
        "Soğuk Hava yedeğini aktarmak için bu modülde ekleme yetkisi gerekir.",
      );
    const { data, error: restoreError } = await supabase.rpc(
      "restore_gurminik_backup_v4",
      { payload, restore_mode: mode },
    );
    if (restoreError) throw restoreError;
    restoreBackupSettings(session.user.id, payload.settings);
    await reload();
    setError("");
    return data as RestoreReport;
  }
  async function logPdfExport(
    exportModule: "reports" | "cold_storage",
    reportName: string,
    start?: string | null,
    end?: string | null,
  ) {
    const { error: logError } = await supabase.rpc("log_gurminik_export", {
      export_module: exportModule,
      report_name: reportName,
      date_start: start || null,
      date_end: end || null,
      filters: {},
    });
    if (logError) setSyncNotice("PDF indirildi; işlem geçmişi kaydı daha sonra yenilenecek.");
  }
  async function importVCardContacts(
    rows: ParsedVCardContact[],
  ): Promise<ContactImportResult> {
    if (!permissionFor("contacts").can_create)
      throw new Error("Telefon numarası ekleme yetkiniz bulunmuyor.");
    if (!navigator.onLine)
      throw new Error("Rehber aktarımı için internet bağlantısı gereklidir.");
    if (!session) throw new Error("Bulut oturumu bulunamadı.");
    const existing = await fetchAllRows((from, to) =>
      supabase
        .from("contacts")
        .select("phone,phone_normalized")
        .order("id")
        .range(from, to),
    );
    if (existing.error) throw existing.error;
    const existingKeys = new Set(
      (existing.data || [])
        .map((row) =>
          String(row.phone_normalized || normalizePhone(row.phone || "")),
        )
        .filter(Boolean),
    );
    const pending = rows.filter((row) => !existingKeys.has(row.phoneKey));
    if (!pending.length) return { added: 0, skipped: rows.length };
    const payload = pending.map((row) => ({
      id: crypto.randomUUID(),
      owner_id: session.user.id,
      name: row.name || "İsimsiz kişi",
      phone: formatPhone(row.phone),
      contact_type: "Diğer",
      notes: row.unnamed ? "vCard aktarımı · İsimsiz kayıt" : "vCard aktarımı",
    }));
    const inserted = await supabase
      .from("contacts")
      .upsert(payload, {
        onConflict: "owner_id,phone_normalized",
        ignoreDuplicates: true,
      })
      .select("id");
    if (inserted.error) throw inserted.error;
    const added = inserted.data?.length || 0;
    await supabase.rpc("log_gurminik_contact_import", {
      added_count: added,
      skipped_count: rows.length - added,
    });
    await reload();
    setSyncNotice("Rehber kişileri bulutla senkronize edildi.");
    return { added, skipped: rows.length - added };
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (password.length < 6) {
      setError("Şifre en az 6 karakter olmalıdır.");
      return;
    }
    if (authMode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) setError("E-posta veya şifre hatalı.");
    } else {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (signUpError) setError(signUpError.message);
      else if (!data.session)
        setNotice(
          "Onay bağlantısı e-posta adresinize gönderildi. E-postayı onayladıktan sonra giriş yapın.",
        );
    }
  }
  async function requestPasswordReset() {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Önce e-posta adresinizi yazın.");
      return;
    }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/` },
    );
    if (resetError) setError(resetError.message);
    else setNotice("Şifre yenileme bağlantısı e-posta adresinize gönderildi.");
  }
  async function updatePassword(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (password.length < 6) {
      setError("Yeni şifre en az 6 karakter olmalıdır.");
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await supabase.auth.signOut();
    setPasswordRecovery(false);
    setPassword("");
    setNotice("Şifreniz yenilendi. Yeni şifrenizle giriş yapabilirsiniz.");
  }
  async function unlockFinance(passwordToCheck: string) {
    const accountEmail = session?.user.email;
    if (!accountEmail) return false;
    const { error: unlockError } = await supabase.auth.signInWithPassword({
      email: accountEmail,
      password: passwordToCheck,
    });
    if (unlockError) return false;
    setFinanceUnlocked(true);
    return true;
  }
  if (!authReady)
    return (
      <main className="gurminik-login text-zinc-400">
        Güvenli oturum hazırlanıyor…
      </main>
    );
  if (passwordRecovery)
    return (
      <main className="gurminik-login">
        <form onSubmit={updatePassword} className="gurminik-login-card">
          <p className="gurminik-eyebrow">GÜVENLİ BULUT HESABI</p>
          <h1>GURMİNİK</h1>
          <p className="gurminik-login-copy">
            Hesabınız için yeni bir şifre belirleyin.
          </p>
          <label className="gurminik-field-label">Yeni şifre</label>
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            minLength={6}
            autoComplete="new-password"
            required
            className="gurminik-login-input"
          />
          <Button className="gurminik-primary-button mt-5 h-12 w-full">
            Şifreyi yenile
          </Button>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </form>
      </main>
    );
  if (!session)
    return (
      <main className="gurminik-login">
        <form onSubmit={login} className="gurminik-login-card">
          <p className="gurminik-eyebrow">GÜVENLİ BULUT HESABI</p>
          <h1>GURMİNİK</h1>
          <p className="gurminik-login-copy">
            {authMode === "signin"
              ? "Bulut kayıtlarınıza giriş yapın."
              : "İlk kullanım için güvenli hesabınızı oluşturun."}
          </p>
          <label className="gurminik-field-label">E-posta</label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
            className="gurminik-login-input"
          />
          <label className="gurminik-field-label mt-4">Şifre</label>
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            minLength={6}
            autoComplete={
              authMode === "signin" ? "current-password" : "new-password"
            }
            required
            className="gurminik-login-input"
          />
          <Button className="gurminik-primary-button mt-5 h-12 w-full">
            {authMode === "signin" ? "Giriş yap" : "Güvenli hesap oluştur"}
          </Button>
          {authMode === "signin" && (
            <button
              type="button"
              onClick={() => void requestPasswordReset()}
              className="gurminik-login-switch"
            >
              Şifremi unuttum
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setAuthMode(authMode === "signin" ? "signup" : "signin");
              setError("");
              setNotice("");
            }}
            className="gurminik-login-switch"
          >
            {authMode === "signin"
              ? "İlk kez kullanıyorum — hesap oluştur"
              : "Zaten hesabım var — giriş yap"}
          </button>
          {notice && (
            <p className="mt-4 rounded-lg bg-emerald-950 p-3 text-sm text-emerald-300">
              {notice}
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </form>
      </main>
    );
  if (!accessReady)
    return (
      <main className="gurminik-login text-zinc-400">
        Kullanıcı yetkileri denetleniyor…
      </main>
    );

  const live = state.purchases.filter((x) => x.status !== "cancelled");
  const liveSales = state.sales.filter((x) => x.status !== "cancelled");
  const visibleNav = NAV.filter(([id]) => canView(id));
  const title =
    view === "authorization"
      ? "Yetkilendirme"
      : view === "activity_logs"
        ? "İşlem Geçmişi"
      : NAV.find((x) => x[0] === view)?.[1] || "Erişim Bekleniyor";
  const productName = (id: string) =>
    state.products.find((p) => p.id === id)?.name || "Ürün";
  function openPurchase(productId: string) {
    setSelectedProduct(productId);
    setDialog("purchase");
  }
  function openSale(productId: string) {
    setSelectedProduct(productId);
    setDialog("sale");
  }
  function requestFinanceUnlock() {
    setDialog("unlockFinance");
  }
  function openActivityTarget(row: ActivityLog) {
    if (row.action_type === "delete" || row.action_type === "auto_delete") {
      window.alert(
        row.action_type === "auto_delete"
          ? "Bu kayıt 7 günlük iptal süresi sonunda kalıcı olarak silinmiş. Küçük işlem özeti geçmişte korunuyor."
          : "Bu kayıt daha sonra silinmiş. İşlem özeti geçmişte korunuyor.",
      );
      return;
    }
    if (row.entity_type === "purchases") {
      const record = state.purchases.find((x) => x.id === row.entity_id);
      if (!record) return void window.alert("Bu kayıt daha sonra silinmiş.");
      setSelectedPurchase(record); setSelectedProduct(record.productId); setDialog("editPurchase");
    } else if (row.entity_type === "sales") {
      const record = state.sales.find((x) => x.id === row.entity_id);
      if (!record) return void window.alert("Bu kayıt daha sonra silinmiş.");
      setSelectedSale(record); setSelectedProduct(record.productId); setDialog("editSale");
    } else if (row.module === "expenses") setView("expenses");
    else if (row.module === "accounts") setView("accounts");
    else if (row.module === "contacts") { setContactSearch(row.person_name || ""); setView("contacts"); }
    else if (row.module === "favorites") setView("favorites");
    else if (row.module === "cold_storage") setView("cold_storage");
    else if (row.module === "backup") setView("backup");
    else if (row.module === "reports") setView("reports");
    else if (row.module === "dashboard") setView("dashboard");
  }
  async function finishApplicationReset(result: Record<string, unknown>) {
    const userId = session?.user.id;
    if (!userId) return;
    localStorage.removeItem(queueKey(userId));
    localStorage.removeItem(`${STATE_CACHE_KEY}:${userId}`);
    localStorage.removeItem(`${STATE_CACHE_KEY}:${userId}:cold`);
    const epoch = String(result.epoch || "");
    if (epoch) {
      localStorage.setItem(`gurminik_business_epoch:${userId}`, epoch);
      setBusinessEpoch(epoch);
    }
    if ("databases" in indexedDB) {
      try {
        const databases = await indexedDB.databases();
        databases.forEach((db) => {
          if (db.name?.toLocaleLowerCase("tr-TR").startsWith("gurminik")) indexedDB.deleteDatabase(db.name);
        });
      } catch {}
    }
    setPendingCount(0); setState(EMPTY); setCold(EMPTY_COLD); setView("dashboard");
    setSyncNotice("Uygulama başarıyla sıfırlandı. Yeni sezon kayıtlarına başlayabilirsiniz.");
  }

  return (
    <div className={`gurminik-shell ${mobile ? "is-menu-open" : ""}`}>
      {mobile && (
        <button
          className="gurminik-mobile-backdrop lg:hidden"
          onClick={() => setMobile(false)}
          aria-label="Menüyü kapat"
        />
      )}
      <aside
        className={`gurminik-sidebar transition-transform lg:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="gurminik-brand">
          <strong>GURMİNİK</strong>
          <button
            onClick={() => setMobile(false)}
            className="lg:hidden"
            aria-label="Menüyü kapat"
          >
            <X />
          </button>
        </div>
        <div className="gurminik-sidebar-scroll">
          <nav className="gurminik-nav">
            {visibleNav.map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  setView(id);
                  setMobile(false);
                  setQuery("");
                  setPage(1);
                }}
                className={`gurminik-nav-item ${view === id ? "is-active" : ""}`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
            {access.role === "admin" && (
              <button
                onClick={() => {
                  setView("authorization");
                  setMobile(false);
                }}
                className={`gurminik-nav-item ${view === "authorization" ? "is-active" : ""}`}
              >
                <ShieldCheck className="size-4" />
                Yetkilendirme
              </button>
            )}
          </nav>
          <div className="gurminik-cloud-box">
            <div>
              <Cloud className="size-4" />
              Bulut bağlantısı aktif
            </div>
            <span>Supabase kayıtları ve Dropbox gece yedeği korunuyor.</span>
          </div>
          <button onClick={installApp} className="gurminik-logout">
            <Download className="size-4" />
            Telefona yükle
          </button>
          {financeUnlocked && (
            <button
              onClick={() => setFinanceUnlocked(false)}
              className="gurminik-logout"
            >
              <LockKeyhole className="size-4" />
              Finansı kilitle
            </button>
          )}
          {canView("activity_logs") && (
            <button
              onClick={() => { setView("activity_logs"); setMobile(false); }}
              className={`gurminik-logout ${view === "activity_logs" ? "is-active" : ""}`}
            >
              <History className="size-4" />
              İşlem Geçmişi
            </button>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="gurminik-logout"
          >
            <LogOut className="size-4" />
            Çıkış yap
          </button>
        </div>
      </aside>
      <main className="gurminik-main">
        <header className="gurminik-topbar">
          <button
            className="gurminik-menu-button lg:hidden"
            onClick={() => setMobile(true)}
            aria-label="Menüyü aç"
          >
            <Menu />
          </button>
          <div>
            <p>GURMİNİK</p>
            <h2>{title}</h2>
          </div>
          <button
            className={`gurminik-sync-status ${online ? "is-online" : "is-offline"}`}
            onClick={() => void flushQueue()}
            disabled={syncing}
          >
            {!online ? (
              <WifiOff />
            ) : syncing ? (
              <RefreshCw className="animate-spin" />
            ) : (
              <Cloud />
            )}
            <span>
              {!online
                ? `Çevrimdışı · ${pendingCount} bekliyor`
                : pendingCount
                  ? `${pendingCount} kayıt gönderilecek`
                  : "Senkronize"}
            </span>
          </button>
        </header>
        <div className="gurminik-content">
          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}
          {loading && (
            <div className="mb-5 rounded-xl border bg-white p-4 text-sm text-zinc-500">
              Bulut kayıtları yükleniyor…
            </div>
          )}
          {syncNotice && (
            <div className="gurminik-sync-notice">
              {syncNotice}
              <button onClick={() => setSyncNotice("")}>
                <X />
              </button>
            </div>
          )}
          {!access.is_active && <AccessWaiting inactive />}
          {access.is_active &&
            visibleNav.length === 0 &&
            !canView("activity_logs") &&
            access.role !== "admin" && <AccessWaiting />}
          {access.is_active && canView("dashboard") && view === "dashboard" && (
            <Dashboard
              userId={session.user.id}
              state={state}
              live={live}
              liveSales={liveSales}
              financeUnlocked={financeUnlocked}
              requestFinanceUnlock={requestFinanceUnlock}
              productName={productName}
              openPurchase={openPurchase}
              openSale={openSale}
              setSelectedProduct={setSelectedProduct}
              setDialog={setDialog}
              query={query}
              setQuery={setQuery}
              permission={permissionFor("dashboard")}
              purchasePermission={permissionFor("purchases")}
              salePermission={permissionFor("sales")}
            />
          )}
          {canView("purchases") && view === "purchases" && (
            <PurchaseList
              userId={session.user.id}
              rows={state.purchases}
              products={state.products}
              productName={productName}
              query={query}
              setQuery={(v) => {
                setQuery(v);
                setPage(1);
              }}
              page={page}
              setPage={setPage}
              mutate={mutate}
              onEdit={(r) => {
                setSelectedPurchase(r);
                setSelectedProduct(r.productId);
                setDialog("editPurchase");
              }}
              permission={permissionFor("purchases")}
              financeUnlocked={financeUnlocked}
              requestFinanceUnlock={requestFinanceUnlock}
            />
          )}
          {canView("sales") && view === "sales" && (
            <SalesList
              userId={session.user.id}
              rows={state.sales}
              products={state.products}
              productName={productName}
              financeUnlocked={financeUnlocked}
              requestFinanceUnlock={requestFinanceUnlock}
              page={salePage}
              setPage={setSalePage}
              mutate={mutate}
              onEdit={(r) => {
                if (!financeUnlocked) {
                  requestFinanceUnlock();
                  return;
                }
                setSelectedSale(r);
                setSelectedProduct(r.productId);
                setDialog("editSale");
              }}
              openSale={openSale}
              permission={permissionFor("sales")}
            />
          )}
          {canView("ranking") && view === "ranking" && (
            <Ranking
              state={state}
              live={live}
              mutate={mutate}
              favoritePermission={permissionFor("favorites")}
            />
          )}
          {canView("expenses") && view === "expenses" && (
            <Expenses
              userId={session.user.id}
              state={state}
              page={expensePage}
              setPage={setExpensePage}
              mutate={mutate}
              permission={permissionFor("expenses")}
            />
          )}
          {canView("contacts") && view === "contacts" && (
            <Contacts
              state={state}
              search={contactSearch}
              setSearch={(v) => {
                setContactSearch(v);
                setContactPage(1);
              }}
              page={contactPage}
              setPage={setContactPage}
              mutate={mutate}
              importContacts={importVCardContacts}
              permission={permissionFor("contacts")}
            />
          )}
          {canView("accounts") && view === "accounts" && (
            <Accounts
              userId={session.user.id}
              state={state}
              mutate={mutate}
              permission={permissionFor("accounts")}
              financeUnlocked={financeUnlocked}
              requestFinanceUnlock={requestFinanceUnlock}
            />
          )}
          {canView("favorites") && view === "favorites" && (
            <Favorites
              state={state}
              userId={session.user.id}
              mutate={mutate}
              permission={permissionFor("favorites")}
              purchasePermission={permissionFor("purchases")}
            />
          )}
          {canView("cold_storage") && view === "cold_storage" && (
            <ColdStorage
              userId={session.user.id}
              state={cold}
              financeUnlocked={financeUnlocked}
              requestFinanceUnlock={requestFinanceUnlock}
              permission={permissionFor("cold_storage")}
              mutate={mutate}
            />
          )}
          {canView("reports") && view === "reports" && (
            <>
              <Reports
                state={state}
                coldState={canView("cold_storage") ? cold : undefined}
                financeUnlocked={financeUnlocked}
                requestFinanceUnlock={requestFinanceUnlock}
                period={period}
                setPeriod={setPeriod}
                date={reportDate}
                setDate={setReportDate}
                rangeStart={rangeStart}
                setRangeStart={setRangeStart}
                rangeEnd={rangeEnd}
                setRangeEnd={setRangeEnd}
                onPdfExport={logPdfExport}
              />
              {canView("cold_storage") && (
                <ColdReport
                  state={cold}
                  financeUnlocked={financeUnlocked}
                  requestFinanceUnlock={requestFinanceUnlock}
                  onPdfExport={(name, start, end) => logPdfExport("cold_storage", name, start, end)}
                />
              )}
            </>
          )}
          {canView("backup") && view === "backup" && (
            <Backup
              createBackup={createBackup}
              importBackup={importBackup}
              financeUnlocked={financeUnlocked}
              requestFinanceUnlock={requestFinanceUnlock}
              permission={permissionFor("backup")}
            />
          )}
          {canView("activity_logs") && view === "activity_logs" && (
            <ActivityLogs
              userId={session.user.id}
              onOpen={openActivityTarget}
              financeUnlocked={financeUnlocked}
              requestFinanceUnlock={requestFinanceUnlock}
            />
          )}
          {access.role === "admin" && view === "authorization" && (
            <AuthorizationPanel
              currentUserId={session.user.id}
              createBackup={createBackup}
              onReset={finishApplicationReset}
            />
          )}
        </div>
      </main>
      <EntryDialog
        type={dialog}
        close={() => {
          setDialog(null);
          setSelectedPurchase(null);
          setSelectedSale(null);
        }}
        state={state}
        productId={selectedProduct}
        productName={productName}
        mutate={mutate}
        selectedPurchase={selectedPurchase}
        selectedSale={selectedSale}
        accountEmail={session.user.email || email}
        userId={session.user.id}
        financeUnlocked={financeUnlocked}
        unlockFinance={unlockFinance}
      />
    </div>
  );
}

function AccessWaiting({ inactive = false }: { inactive?: boolean }) {
  return (
    <section className="gurminik-access-waiting gurminik-panel">
      <ShieldCheck />
      <div>
        <p>GÜVENLİ ERİŞİM</p>
        <h3>
          {inactive ? "Hesabınız pasif durumda" : "Yetki onayı bekleniyor"}
        </h3>
        <span>
          {inactive
            ? "Yönetici hesabınızı yeniden etkinleştirdiğinde erişiminiz otomatik açılır."
            : "Hesabınız oluşturuldu. Yönetici bölüm yetkisi verene kadar işletme verileri gösterilmez."}
        </span>
      </div>
    </section>
  );
}

function AuthorizationPanel({
  currentUserId,
  createBackup,
  onReset,
}: {
  currentUserId: string;
  createBackup: () => Promise<BackupPayload>;
  onReset: (result: Record<string, unknown>) => Promise<void>;
}) {
  const [verified, setVerified] = useState(false),
    [password, setPassword] = useState(""),
    [users, setUsers] = useState<AdminUser[]>([]),
    [drafts, setDrafts] = useState<Record<string, AdminUser>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [panelError, setPanelError] = useState("");
  const [resetOpen, setResetOpen] = useState(false),
    [resetPassword, setResetPassword] = useState(""),
    [resetPhrase, setResetPhrase] = useState(""),
    [resetReport, setResetReport] = useState<Record<string, number> | null>(null);
  async function loadUsers() {
    const { data, error } = await supabase.rpc("admin_list_gurminik_users");
    if (error) throw error;
    const list = (data || []) as unknown as AdminUser[];
    setUsers(list);
    setDrafts(
      Object.fromEntries(list.map((user) => [user.id, structuredClone(user)])),
    );
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setPanelError("");
    setMessage("");
    try {
      const { data, error } = await supabase.rpc(
        "verify_gurminik_admin_password",
        { input_password: password },
      );
      if (error) throw error;
      if (!data)
        throw new Error(
          "Yönetici doğrulaması başarısız. Beş hatalı denemeden sonra 15 dakika bekleme uygulanır.",
        );
      setPassword("");
      await loadUsers();
      setVerified(true);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Yönetici doğrulanamadı.",
      );
    } finally {
      setBusy(false);
    }
  }
  function updateActive(userId: string, value: boolean) {
    setDrafts((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], is_active: value },
    }));
  }
  function updatePermission(
    userId: string,
    module: ModuleId,
    field: keyof Permission,
    value: boolean,
  ) {
    setDrafts((prev) => {
      const user = prev[userId],
        permission = user.permissions[module] || {
          can_view: false,
          can_create: false,
          can_update: false,
          can_delete: false,
        };
      return {
        ...prev,
        [userId]: {
          ...user,
          permissions: {
            ...user.permissions,
            [module]: { ...permission, [field]: value },
          },
        },
      };
    });
  }
  async function save(userId: string) {
    const user = drafts[userId];
    if (!user) return;
    setBusy(true);
    setPanelError("");
    setMessage("");
    try {
      const permission_set = Object.fromEntries(
        MODULE_IDS.map((module) => [
          module,
          user.permissions[module] || {
            can_view: false,
            can_create: false,
            can_update: false,
            can_delete: false,
          },
        ]),
      );
      const { error } = await supabase.rpc("admin_set_gurminik_user_access", {
        target_user_id: userId,
        active: user.is_active,
        permission_set,
      });
      if (error) throw error;
      await loadUsers();
      setMessage(
        `${user.email} için yetkiler kaydedildi ve hemen etkinleştirildi.`,
      );
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : "Yetkiler kaydedilemedi.",
      );
      if (String(error).includes("doğrulaması")) setVerified(false);
    } finally {
      setBusy(false);
    }
  }
  async function downloadBeforeReset() {
    setBusy(true); setPanelError("");
    try {
      const payload = await createBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
      const link = document.createElement("a");
      link.href=url; link.download=`gurminik-sifirlama-oncesi-${new Date().toISOString().slice(0,10)}.json`; link.click();
      URL.revokeObjectURL(url);
      setMessage("Sıfırlama öncesi tam JSON yedeği indirildi.");
    } catch (error) { setPanelError(error instanceof Error ? error.message : "Yedek indirilemedi."); }
    finally { setBusy(false); }
  }
  async function resetApplication() {
    if (resetPhrase !== "TÜM VERİLERİ SİL") {
      setPanelError("Onay alanına TÜM VERİLERİ SİL yazın."); return;
    }
    setBusy(true); setPanelError(""); setMessage("");
    try {
      const { data, error } = await supabase.rpc("reset_gurminik_application_v2", {
        input_password: resetPassword,
        confirmation_text: resetPhrase,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Sıfırlama doğrulanamadı.");
      const deleted = (data.deleted || {}) as Record<string, number>;
      setResetReport(deleted);
      setResetPassword(""); setResetPhrase("");
      await onReset(data as Record<string, unknown>);
      setMessage("Uygulama başarıyla sıfırlandı. Yeni sezon kayıtlarına başlayabilirsiniz.");
    } catch (error) { setPanelError(error instanceof Error ? error.message : "Sıfırlama tamamlanamadı."); }
    finally { setBusy(false); }
  }
  if (!verified)
    return (
      <section className="gurminik-auth-gate gurminik-panel">
        <div className="gurminik-auth-gate-icon">
          <ShieldCheck />
        </div>
        <p>YÖNETİCİ KONTROLÜ</p>
        <h3>Yetkilendirme panelini aç</h3>
        <span>
          Supabase yönetici rolünüze ek olarak geçici yönetici şifresi sunucuda
          doğrulanır. Doğrulama 15 dakika geçerlidir.
        </span>
        <form onSubmit={verify}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Yönetici şifresi"
            required
            autoFocus
          />
          <Button disabled={busy}>
            {busy ? <RefreshCw className="animate-spin" /> : <ShieldCheck />}
            Doğrula
          </Button>
        </form>
        {panelError && (
          <div className="gurminik-permission-error">{panelError}</div>
        )}
      </section>
    );
  return (
    <div className="gurminik-permissions">
      <section className="gurminik-permission-intro gurminik-panel">
        <div>
          <p>KULLANICI YETKİLERİ</p>
          <h3>Modül ve işlem erişimleri</h3>
          <span>
            Yeni hesaplar sıfır yetkiyle başlar. Değişiklikler kaydedildiği anda
            arayüzde ve Supabase RLS kurallarında geçerli olur.
          </span>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setVerified(false);
            setUsers([]);
          }}
        >
          <LockKeyhole />
          Paneli kilitle
        </Button>
      </section>
      {message && <div className="gurminik-permission-success">{message}</div>}
      {panelError && (
        <div className="gurminik-permission-error">{panelError}</div>
      )}
      <div className="gurminik-user-list">
        {users.map((user) => {
          const draft = drafts[user.id] || user,
            isAdmin = user.role === "admin";
          return (
            <article
              className="gurminik-user-card gurminik-panel"
              key={user.id}
            >
              <header>
                <div className="gurminik-user-avatar">
                  <Users />
                </div>
                <div>
                  <h4>{user.display_name || user.email}</h4>
                  <span>
                    {user.email}
                    {user.id === currentUserId ? " · Siz" : ""}
                  </span>
                  <small>
                    Kayıt: {new Date(user.created_at).toLocaleString("tr-TR")}
                  </small>
                </div>
                <div
                  className={`gurminik-user-status ${draft.is_active ? "is-active" : ""}`}
                >
                  {draft.is_active ? "Aktif" : "Pasif"}
                </div>
              </header>
              {isAdmin ? (
                <div className="gurminik-admin-full-access">
                  <ShieldCheck />
                  <span>
                    <strong>Yönetici</strong>Tüm modüllerde tam yetki
                  </span>
                </div>
              ) : (
                <>
                  <label className="gurminik-active-toggle">
                    <input
                      type="checkbox"
                      checked={draft.is_active}
                      onChange={(e) => updateActive(user.id, e.target.checked)}
                    />
                    <span>Hesap aktif</span>
                  </label>
                  <div className="gurminik-permission-table">
                    <div className="gurminik-permission-row is-header">
                      <strong>Modül</strong>
                      <span>Görüntüle</span>
                      <span>Ekle</span>
                      <span>Düzenle</span>
                      <span>Sil / İptal</span>
                    </div>
                    {MODULE_IDS.map((module) => (
                      <div className="gurminik-permission-row" key={module}>
                        <strong>{MODULE_LABELS[module]}</strong>
                        {(
                          [
                            "can_view",
                            "can_create",
                            "can_update",
                            "can_delete",
                          ] as const
                        ).map((field) => (
                          <label key={field}>
                            <input
                              type="checkbox"
                              checked={
                                draft.permissions[module]?.[field] || false
                              }
                              onChange={(e) =>
                                updatePermission(
                                  user.id,
                                  module,
                                  field,
                                  e.target.checked,
                                )
                              }
                            />
                            <span aria-hidden="true" />
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="gurminik-user-save">
                    <Button onClick={() => void save(user.id)} disabled={busy}>
                      <Save />
                      Yetkileri kaydet
                    </Button>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
      <section className="gurminik-danger-zone gurminik-panel">
        <div>
          <p>TEHLİKELİ İŞLEMLER</p>
          <h3>Uygulamayı yeni sezon için sıfırla</h3>
          <span>Auth hesapları, yetkiler, Supabase yapısı ve uygulama yayını korunur; işletme kayıtları kalıcı olarak silinir.</span>
        </div>
        <Button variant="destructive" onClick={() => { setResetOpen(true); setResetReport(null); }}>
          <Trash2 />Uygulamayı Sıfırla
        </Button>
      </section>
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="gurminik-dialog gurminik-reset-dialog">
          <DialogHeader>
            <DialogTitle>Uygulamayı tamamen sıfırla</DialogTitle>
            <DialogDescription>Bu işlem işletmeye ait kayıtları kalıcı olarak silecektir. Bu işlem geri alınamaz.</DialogDescription>
          </DialogHeader>
          {resetReport ? <div className="gurminik-reset-report">
            <h4>Uygulama başarıyla sıfırlandı</h4>
            {Object.entries(resetReport).map(([key,value]) => <p key={key}><span>{key}</span><b>{Number(value).toLocaleString("tr-TR")} kayıt</b></p>)}
            <Button onClick={() => setResetOpen(false)}>Tamam</Button>
          </div> : <div className="gurminik-reset-steps">
            <div className="gurminik-reset-warning"><strong>1. Önce yedek alın</strong><span>Zorunlu değildir; geri dönüş için önerilir.</span><Button variant="outline" onClick={() => void downloadBeforeReset()} disabled={busy}><Download />Sıfırlamadan Önce Tam JSON Yedeğini İndir</Button></div>
            <label><b>2. Özel sıfırlama şifresi</b><Input type="password" autoComplete="off" value={resetPassword} onChange={(e)=>setResetPassword(e.target.value)} placeholder="Sunucuda doğrulanır" /></label>
            <label><b>3. Son onay</b><span>Devam etmek için aşağıya TÜM VERİLERİ SİL yazın.</span><Input value={resetPhrase} onChange={(e)=>setResetPhrase(e.target.value)} placeholder="TÜM VERİLERİ SİL" /></label>
            <Button variant="destructive" disabled={busy || !resetPassword || resetPhrase!=="TÜM VERİLERİ SİL"} onClick={() => void resetApplication()}>{busy?<RefreshCw className="animate-spin"/>:<Trash2/>}{busy?"Güvenli şekilde sıfırlanıyor…":"Bütün işletme verilerini kalıcı sil"}</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="gurminik-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="gurminik-searchbox">
      <Search className="size-4" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
function Pager({
  page,
  setPage,
  total,
}: {
  page: number;
  setPage: (p: number) => void;
  total: number;
}) {
  const max = Math.ceil(total / PAGE_SIZE);
  if (max <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-t p-4">
      <Button
        size="icon-sm"
        variant="outline"
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
      >
        <ChevronLeft />
      </Button>
      <span className="text-sm font-bold">
        {page} / {max}
      </span>
      <Button
        size="icon-sm"
        variant="outline"
        disabled={page === max}
        onClick={() => setPage(page + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

function SortDirectionIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: "asc" | "desc";
}) {
  if (!active) return null;
  return direction === "desc" ? (
    <ArrowDown className="size-3.5" />
  ) : (
    <ArrowUp className="size-3.5" />
  );
}

function Dashboard({
  userId,
  state,
  live,
  liveSales,
  financeUnlocked,
  requestFinanceUnlock,
  productName,
  openPurchase,
  openSale,
  setSelectedProduct,
  setDialog,
  query,
  setQuery,
  permission,
  purchasePermission,
  salePermission,
}: {
  userId: string;
  state: State;
  live: Purchase[];
  liveSales: Sale[];
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
  productName: (id: string) => string;
  openPurchase: (id: string) => void;
  openSale: (id: string) => void;
  setSelectedProduct: (id: string) => void;
  setDialog: (v: DialogType) => void;
  query: string;
  setQuery: (v: string) => void;
  permission: Permission;
  purchasePermission: Permission;
  salePermission: Permission;
}) {
  const { range, setRange } = useRememberedDateRange(userId, "dashboard", true),
    filteredPurchases = live.filter((x) =>
      inRememberedDateRange(x.dateTime, range),
    ),
    filteredSales = liveSales.filter((x) =>
      inRememberedDateRange(x.dateTime, range),
    ),
    filteredExpenses = state.expenses.filter((x) =>
      inRememberedDateRange(x.dateTime, range),
    );
  const totalKg = filteredPurchases.reduce((s, x) => s + Number(x.kg), 0),
    cost = filteredPurchases.reduce(
      (s, x) => s + Number(x.kg) * Number(x.buyPrice),
      0,
    ),
    expense = filteredExpenses.reduce((s, x) => s + Number(x.amount), 0),
    salesKg = filteredSales.reduce((s, x) => s + Number(x.kg), 0),
    salesAmount = filteredSales.reduce(
      (s, x) => s + Number(x.kg) * Number(x.sellPrice),
      0,
    ),
    profit = salesAmount - cost - expense;
  const results = query
    ? filteredPurchases
        .filter((r) =>
          [r.person, r.plate, productName(r.productId)].some((v) =>
            norm(v).includes(norm(query)),
          ),
        )
        .slice(0, 15)
    : [];
  return (
    <>
      <DateRangeFilter
        range={range}
        onChange={setRange}
        title="Ana Sayfa tarih aralığı"
        showToday
      />
      <div className="gurminik-search-panel">
        <p>Tüm kayıtlarda ara</p>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="İsim, plaka veya ürün yazın…"
        />
      </div>
      {query && (
        <div className="gurminik-table-panel mb-6">
          <PurchaseTable rows={results} productName={productName} />
        </div>
      )}
      <div className="gurminik-summary-grid gurminik-dashboard-stats">
        <Stat label="Toplam alış kg" value={kg(totalKg)} />
        <Stat label="Toplam alış tutarı" value={money(cost)} />
        <Stat label="Toplam gider" value={money(expense)} />
        <Stat label="Toplam satış kg" value={kg(salesKg)} />
        <ProtectedStat
          label="Toplam satış tutarı"
          value={money(salesAmount)}
          unlocked={financeUnlocked}
          onUnlock={requestFinanceUnlock}
        />
        <ProtectedStat
          label="Tahmini kâr"
          value={money(profit)}
          unlocked={financeUnlocked}
          onUnlock={requestFinanceUnlock}
        />
      </div>
      <div className="gurminik-section-heading">
        <div>
          <p>ÜRÜN YÖNETİMİ</p>
          <h3>Ürünler</h3>
        </div>
        {permission.can_create && (
          <Button variant="outline" onClick={() => setDialog("product")}>
            <Plus />
            Yeni ürün
          </Button>
        )}
      </div>
      <div className="gurminik-product-grid">
        {state.products
          .filter((p) => p.isActive !== false)
          .map((p) => {
            const rows = filteredPurchases.filter((x) => x.productId === p.id),
              sum = rows.reduce((s, x) => s + Number(x.kg), 0),
              sold = filteredSales
                .filter((x) => x.productId === p.id)
                .reduce((s, x) => s + Number(x.kg), 0),
              custom = !DEFAULT_PRODUCTS.some(
                (d) => norm(d.name) === norm(p.name),
              );
            return (
              <article key={p.id} className="gurminik-product-card">
                {custom && permission.can_delete && (
                  <button
                    className="gurminik-product-delete"
                    title={`${p.name} ürününü sil`}
                    aria-label={`${p.name} ürününü sil`}
                    onClick={() => {
                      setSelectedProduct(p.id);
                      setDialog("deleteProduct");
                    }}
                  >
                    <Trash2 />
                  </button>
                )}
                <span>{p.icon}</span>
                <h4>{p.name}</h4>
                <p>
                  Alış {kg(sum)} · Satış {kg(sold)}
                </p>
                <div className="gurminik-product-actions">
                  {purchasePermission.can_create && (
                    <Button onClick={() => openPurchase(p.id)}>
                      <Plus />
                      Alış
                    </Button>
                  )}
                  {salePermission.can_create && (
                    <Button
                      className="gurminik-sale-button"
                      onClick={() => openSale(p.id)}
                    >
                      <ShoppingCart />
                      Satış
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedProduct(p.id);
                      setDialog("detail");
                    }}
                  >
                    Detay
                  </Button>
                </div>
              </article>
            );
          })}
      </div>
    </>
  );
}

function ProtectedStat({
  label,
  value,
  unlocked,
  onUnlock,
}: {
  label: string;
  value: string;
  unlocked: boolean;
  onUnlock: () => void;
}) {
  return (
    <article className="gurminik-stat gurminik-protected-stat">
      <span>{label}</span>
      <strong>{unlocked ? value : "••••••"}</strong>
      <button onClick={onUnlock}>
        {unlocked ? <EyeOff /> : <LockKeyhole />}
        {unlocked ? "Görünür" : "Şifreyle göster"}
      </button>
    </article>
  );
}

function PaymentStatusField({ defaultPaid = true }: { defaultPaid?: boolean }) {
  return (
    <fieldset className="gurminik-payment-field">
      <legend>Ödeme Durumu</legend>
      <div className="gurminik-payment-options">
        <label>
          <input
            type="radio"
            name="isPaid"
            value="true"
            defaultChecked={defaultPaid}
          />
          <span>✓ Ödendi</span>
        </label>
        <label>
          <input
            type="radio"
            name="isPaid"
            value="false"
            defaultChecked={!defaultPaid}
          />
          <span>⏳ Ödenmedi</span>
        </label>
      </div>
    </fieldset>
  );
}

function PurchaseTable({
  rows,
  productName,
  mutate,
  onEdit,
  canUpdate = false,
  canDelete = false,
}: {
  rows: Purchase[];
  productName: (id: string) => string;
  mutate?: (a: string, d: Record<string, unknown>) => Promise<void>;
  onEdit?: (row: Purchase) => void;
  canUpdate?: boolean;
  canDelete?: boolean;
}) {
  const hasActions = !!mutate && (canUpdate || canDelete);
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-zinc-100">
          <TableHead>Kişi</TableHead>
          <TableHead>Ürün</TableHead>
          <TableHead>Plaka</TableHead>
          <TableHead>Kg</TableHead>
          <TableHead>TL/kg</TableHead>
          <TableHead>Toplam</TableHead>
          <TableHead>Tarih</TableHead>
          <TableHead>Ödeme</TableHead>
          <TableHead>Durum</TableHead>
          {hasActions && <TableHead>İşlem</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length ? (
          rows.map((r) => (
            <TableRow
              key={r.id}
              className={
                r.status === "cancelled" ? "opacity-45 line-through" : ""
              }
            >
              <TableCell className="font-bold">{r.person}</TableCell>
              <TableCell>{productName(r.productId)}</TableCell>
              <TableCell>{r.plate}</TableCell>
              <TableCell>{kg(r.kg)}</TableCell>
              <TableCell>{money(r.buyPrice)}</TableCell>
              <TableCell>{money(r.kg * r.buyPrice)}</TableCell>
              <TableCell>{dateTime(r.dateTime)}</TableCell>
              <TableCell>
                <span
                  className={`gurminik-payment-badge ${r.isPaid === false ? "is-unpaid" : "is-paid"}`}
                >
                  {r.isPaid === false ? "Ödenmedi" : "Ödendi"}
                </span>
              </TableCell>
              <TableCell>
                <div className="gurminik-cancellation-state">
                  <span>{r.status === "cancelled" ? "İptal" : "Aktif"}</span>
                  {r.status === "cancelled" && (
                    <small>{cancellationNotice(r.cancelledAt)}</small>
                  )}
                </div>
              </TableCell>
              {hasActions && (
                <TableCell>
                  <div className="gurminik-row-actions">
                    {canUpdate && onEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onEdit(r)}
                      >
                        <Pencil />
                        Düzenle
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          r.status === "cancelled" &&
                          cancellationExpired(r.cancelledAt)
                        }
                        onClick={() =>
                          mutate!("togglePurchase", {
                            id: r.id,
                            status:
                              r.status === "cancelled" ? "active" : "cancelled",
                          })
                        }
                      >
                        {r.status === "cancelled" ? "Etkinleştir" : "İptal et"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={hasActions ? 10 : 9}
              className="py-12 text-center text-zinc-500"
            >
              Kayıt bulunamadı.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
function PurchaseList({
  userId,
  rows,
  products,
  productName,
  query,
  setQuery,
  page,
  setPage,
  mutate,
  onEdit,
  permission,
  financeUnlocked,
  requestFinanceUnlock,
}: {
  userId: string;
  rows: Purchase[];
  products: Product[];
  productName: (id: string) => string;
  query: string;
  setQuery: (v: string) => void;
  page: number;
  setPage: (p: number) => void;
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  onEdit: (row: Purchase) => void;
  permission: Permission;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
}) {
  const [productFilter, setProductFilter] = useState("");
  const { range, setRange } = useRememberedDateRange(userId, "purchases");
  const filtered = rows.filter(
      (r) =>
        inRememberedDateRange(r.dateTime, range) &&
        (!productFilter || r.productId === productFilter) &&
        (!query ||
          [r.person, r.plate, productName(r.productId)].some((v) =>
            norm(v).includes(norm(query)),
          )),
    ),
    paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totals = summarizeTransactions(filtered, (r) => r.buyPrice);
  return (
    <>
      <DateRangeFilter
        range={range}
        onChange={(next) => {
          setRange(next);
          setPage(1);
        }}
        title="Tüm Alışlar tarih aralığı"
      />
      <div className="gurminik-record-toolbar gurminik-panel">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="İsim, plaka veya ürün ara…"
        />
        <select
          value={productFilter}
          onChange={(e) => {
            setProductFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm ürünler</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <p className="gurminik-filter-label">
        {query ? `Arama: ${query} · ` : ""}
        {products.find((p) => p.id === productFilter)?.name || "Tüm ürünler"} ·
        Aktif kayıtlar
      </p>
      <div className="gurminik-summary-grid gurminik-filter-summary">
        <Stat label="Aktif alış" value={totals.count} />
        <Stat label="Toplam alış kg" value={kg(totals.totalKg)} />
        <ProtectedStat
          label="Toplam alış tutarı"
          value={money(totals.totalAmount)}
          unlocked={financeUnlocked}
          onUnlock={requestFinanceUnlock}
        />
        <ProtectedStat
          label="Ort. alış fiyatı"
          value={`${money(totals.average)}/kg`}
          unlocked={financeUnlocked}
          onUnlock={requestFinanceUnlock}
        />
      </div>
      <section className="gurminik-table-panel">
        <PurchaseTable
          rows={paged}
          productName={productName}
          mutate={mutate}
          onEdit={onEdit}
          canUpdate={permission.can_update}
          canDelete={permission.can_delete}
        />
        <Pager page={page} setPage={setPage} total={filtered.length} />
      </section>
    </>
  );
}

function SaleTable({
  rows,
  productName,
  financeUnlocked,
  requestFinanceUnlock,
  mutate,
  onEdit,
  canUpdate = false,
  canDelete = false,
}: {
  rows: Sale[];
  productName: (id: string) => string;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
  mutate?: (a: string, d: Record<string, unknown>) => Promise<void>;
  onEdit?: (row: Sale) => void;
  canUpdate?: boolean;
  canDelete?: boolean;
}) {
  const hidden = (
    <button
      className="gurminik-masked-value"
      onClick={requestFinanceUnlock}
      title="Şifreyle göster"
    >
      <LockKeyhole />
      Gizli
    </button>
  );
  const hasActions = !!mutate && (canUpdate || canDelete);
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-zinc-100">
          <TableHead>Alıcı / Fabrika</TableHead>
          <TableHead>Kamyoncu</TableHead>
          <TableHead>Kamyon plakası</TableHead>
          <TableHead>Ürün</TableHead>
          <TableHead>Kg</TableHead>
          <TableHead>Satış TL/kg</TableHead>
          <TableHead>Toplam</TableHead>
          <TableHead>Tarih</TableHead>
          <TableHead>Durum</TableHead>
          {hasActions && <TableHead>İşlem</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length ? (
          rows.map((r) => (
            <TableRow
              key={r.id}
              className={
                r.status === "cancelled" ? "opacity-45 line-through" : ""
              }
            >
              <TableCell className="font-bold">{r.buyer}</TableCell>
              <TableCell>{r.driver || "—"}</TableCell>
              <TableCell>{r.plate || "—"}</TableCell>
              <TableCell>{productName(r.productId)}</TableCell>
              <TableCell>{kg(r.kg)}</TableCell>
              <TableCell>
                {financeUnlocked ? money(r.sellPrice) : hidden}
              </TableCell>
              <TableCell>
                {financeUnlocked ? money(r.kg * r.sellPrice) : hidden}
              </TableCell>
              <TableCell>{dateTime(r.dateTime)}</TableCell>
              <TableCell>
                <div className="gurminik-cancellation-state">
                  <span>{r.status === "cancelled" ? "İptal" : "Aktif"}</span>
                  {r.status === "cancelled" && (
                    <small>{cancellationNotice(r.cancelledAt)}</small>
                  )}
                </div>
              </TableCell>
              {hasActions && (
                <TableCell>
                  <div className="gurminik-row-actions">
                    {canUpdate && onEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onEdit(r)}
                      >
                        <Pencil />
                        Düzenle
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          r.status === "cancelled" &&
                          cancellationExpired(r.cancelledAt)
                        }
                        onClick={() =>
                          mutate!("toggleSale", {
                            id: r.id,
                            status:
                              r.status === "cancelled" ? "active" : "cancelled",
                          })
                        }
                      >
                        {r.status === "cancelled" ? "Etkinleştir" : "İptal et"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={hasActions ? 10 : 9}
              className="py-12 text-center text-zinc-500"
            >
              Satış kaydı bulunamadı.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
function SalesList({
  userId,
  rows,
  products,
  productName,
  financeUnlocked,
  requestFinanceUnlock,
  page,
  setPage,
  mutate,
  onEdit,
  openSale,
  permission,
}: {
  userId: string;
  rows: Sale[];
  products: Product[];
  productName: (id: string) => string;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
  page: number;
  setPage: (p: number) => void;
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  onEdit: (row: Sale) => void;
  openSale: (id: string) => void;
  permission: Permission;
}) {
  const [search, setSearch] = useState(""),
    [productFilter, setProductFilter] = useState("");
  const { range, setRange } = useRememberedDateRange(userId, "sales");
  const filtered = rows.filter(
      (r) =>
        inRememberedDateRange(r.dateTime, range) &&
        (!productFilter || r.productId === productFilter) &&
        (!search ||
          [
            r.buyer,
            r.driver || "",
            r.plate || "",
            productName(r.productId),
          ].some((v) => norm(v).includes(norm(search)))),
    ),
    paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totals = summarizeTransactions(filtered, (r) => r.sellPrice);
  return (
    <>
      <DateRangeFilter
        range={range}
        onChange={(next) => {
          setRange(next);
          setPage(1);
        }}
        title="Satışlar tarih aralığı"
      />
      <div className="gurminik-toolbar">
        <div className="gurminik-summary-grid gurminik-sales-summary">
          <Stat label="Aktif satış / sefer" value={totals.count} />
          <Stat label="Toplam satış kg" value={kg(totals.totalKg)} />
          <ProtectedStat
            label="Toplam satış tutarı"
            value={money(totals.totalAmount)}
            unlocked={financeUnlocked}
            onUnlock={requestFinanceUnlock}
          />
          <ProtectedStat
            label="Ort. satış fiyatı"
            value={`${money(totals.average)}/kg`}
            unlocked={financeUnlocked}
            onUnlock={requestFinanceUnlock}
          />
        </div>
        {permission.can_create && (
          <Button
            onClick={() =>
              openSale(
                productFilter ||
                  products.find((p) => p.isActive !== false)?.id ||
                  "",
              )
            }
            disabled={!products.some((p) => p.isActive !== false)}
          >
            <ShoppingCart />
            Yeni satış
          </Button>
        )}
      </div>
      <div className="gurminik-record-toolbar gurminik-panel">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Fabrika, kamyoncu, plaka veya ürün ara…"
        />
        <select
          value={productFilter}
          onChange={(e) => {
            setProductFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm ürünler</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <p className="gurminik-filter-label">
        {search ? `Arama: ${search} · ` : ""}
        {products.find((p) => p.id === productFilter)?.name || "Tüm ürünler"} ·
        Aktif kayıtlar
      </p>
      <section className="gurminik-table-panel">
        <SaleTable
          rows={paged}
          productName={productName}
          financeUnlocked={financeUnlocked}
          requestFinanceUnlock={requestFinanceUnlock}
          mutate={mutate}
          onEdit={onEdit}
          canUpdate={permission.can_update}
          canDelete={permission.can_delete}
        />
        <Pager page={page} setPage={setPage} total={filtered.length} />
      </section>
    </>
  );
}

function Ranking({
  state,
  live,
  mutate,
  favoritePermission,
}: {
  state: State;
  live: Purchase[];
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  favoritePermission: Permission;
}) {
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
      key: "total",
      direction: "desc",
    }),
    [selected, setSelected] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      live.filter((row) => {
        const stamp = new Date(row.dateTime).getTime();
        return (
          (!start || stamp >= new Date(start + "T00:00:00").getTime()) &&
          (!end || stamp < new Date(end + "T00:00:00").getTime() + 86400000)
        );
      }),
    [live, start, end],
  );
  const products = useMemo(
    () =>
      state.products.filter(
        (product) =>
          product.isActive !== false ||
          filtered.some((row) => row.productId === product.id),
      ),
    [state.products, filtered],
  );
  const rows = useMemo(() => {
    const grouped = filtered.reduce<
      Record<
        string,
        {
          key: string;
          name: string;
          total: number;
          amount: number;
          byProduct: Record<string, number>;
          plate: string;
          lastAt: number;
        }
      >
    >((map, row) => {
      const key = norm(row.person),
        stamp = new Date(row.dateTime).getTime();
      map[key] ??= {
        key,
        name: row.person,
        total: 0,
        amount: 0,
        byProduct: {},
        plate: "",
        lastAt: 0,
      };
      map[key].total += Number(row.kg);
      map[key].amount += Number(row.kg) * Number(row.buyPrice);
      map[key].byProduct[row.productId] =
        (map[key].byProduct[row.productId] || 0) + Number(row.kg);
      if (stamp >= map[key].lastAt) {
        map[key].lastAt = stamp;
        map[key].plate = row.plate;
      }
      return map;
    }, {});
    return Object.values(grouped).sort((a, b) => {
      const av = sort.key === "total" ? a.total : a.byProduct[sort.key] || 0,
        bv = sort.key === "total" ? b.total : b.byProduct[sort.key] || 0,
        delta = av - bv;
      return sort.direction === "asc" ? delta : -delta;
    });
  }, [filtered, sort]);
  const person = rows.find((row) => row.key === selected) || null;
  const contact = person
    ? state.contacts.find((item) => norm(item.name) === person.key)
    : undefined;
  const favorite = person
    ? state.favorites.find((item) => norm(item.person) === person.key)
    : undefined;
  function changeSort(key: string) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" },
    );
  }
  async function toggleFavorite() {
    if (!person) return;
    if (favorite) {
      await mutate("deleteFavorite", { id: favorite.id });
      return;
    }
    const latest = live.find((row) => norm(row.person) === person.key);
    await mutate("addFavorite", {
      id: crypto.randomUUID(),
      person: person.name,
      phone: contact?.phone || "",
      plate: latest?.plate || person.plate,
      lastProductId: latest?.productId || "",
      lastBuyPrice: latest?.buyPrice ?? null,
      notes: "Sıralamalar ekranından eklendi",
    });
  }
  return (
    <div className="grid gap-5">
      <section className="gurminik-panel gurminik-ranking-toolbar">
        <div>
          <p className="gurminik-eyebrow">TEDARİKÇİ MATRİSİ</p>
          <h3>Ürün bazında tek sıralama</h3>
          <span>
            Bir sütun başlığına dokunarak büyükten küçüğe veya küçükten büyüğe
            sıralayın.
          </span>
        </div>
        <div className="gurminik-range-inputs">
          <label>
            Başlangıç
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Bitiş
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          {(start || end) && (
            <Button
              variant="outline"
              onClick={() => {
                setStart("");
                setEnd("");
              }}
            >
              Tüm zamanlar
            </Button>
          )}
        </div>
      </section>
      <section className="gurminik-table-panel gurminik-ranking-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kişi</TableHead>
              {products.map((product) => (
                <TableHead key={product.id}>
                  <button
                    className="gurminik-sort-button"
                    onClick={() => changeSort(product.id)}
                  >
                    {product.name}
                    <SortDirectionIcon
                      active={sort.key === product.id}
                      direction={sort.direction}
                    />
                  </button>
                </TableHead>
              ))}
              <TableHead>
                <button
                  className="gurminik-sort-button"
                  onClick={() => changeSort("total")}
                >
                  Toplam KG
                  <SortDirectionIcon
                    active={sort.key === "total"}
                    direction={sort.direction}
                  />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.key}
                  className="gurminik-clickable-row"
                  onClick={() => setSelected(row.key)}
                >
                  <TableCell className="font-bold">{row.name}</TableCell>
                  {products.map((product) => (
                    <TableCell key={product.id}>
                      {kg(row.byProduct[product.id] || 0)}
                    </TableCell>
                  ))}
                  <TableCell className="font-black">{kg(row.total)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={products.length + 2}
                  className="py-12 text-center text-zinc-500"
                >
                  Seçilen dönemde alış kaydı bulunamadı.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      <Dialog
        open={!!person}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="gurminik-dialog sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{person?.name || "Kişi"} önizlemesi</DialogTitle>
            <DialogDescription>
              Seçilen tarih aralığındaki alış özeti ve kayıtlı iletişim
              bilgileri.
            </DialogDescription>
          </DialogHeader>
          {person && (
            <div className="grid gap-5">
              <div className="gurminik-summary-grid">
                <Stat label="Toplam miktar" value={kg(person.total)} />
                <Stat label="Toplam alış tutarı" value={money(person.amount)} />
                <Stat label="Araç plakası" value={person.plate || "—"} />
              </div>
              <div className="gurminik-person-products">
                {products.map((product) => (
                  <div className="gurminik-metric-row" key={product.id}>
                    <span>{product.name}</span>
                    <strong>{kg(person.byProduct[product.id] || 0)}</strong>
                  </div>
                ))}
              </div>
              <div className="gurminik-person-contact">
                <PhoneCall />
                <div>
                  <span>Telefon numarası</span>
                  {contact?.phone ? (
                    <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                  ) : (
                    <strong>Kayıtlı numara yok</strong>
                  )}
                </div>
              </div>
              {(favorite && favoritePermission.can_delete) ||
              (!favorite && favoritePermission.can_create) ? (
                <Button
                  onClick={() => void toggleFavorite()}
                  variant={favorite ? "outline" : "default"}
                >
                  <Star className={favorite ? "fill-current" : ""} />
                  {favorite ? "Favorilerden Çıkar" : "Favorilere Ekle"}
                </Button>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Accounts({
  userId,
  state,
  mutate,
  permission,
  financeUnlocked,
  requestFinanceUnlock,
}: {
  userId: string;
  state: State;
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  permission: Permission;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<AccountPayment | null>(null);
  const { range, setRange } = useRememberedDateRange(userId, "accounts"),
    periodRows = state.accountPayments.filter((row) =>
      inRememberedDateRange(row.dateTime, range),
    ),
    filtered = periodRows.filter(
      (row) =>
        !search ||
        [row.company, row.description, row.method].some((value) =>
          norm(value).includes(norm(search)),
        ),
    ),
    rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total = periodRows.reduce((sum, row) => sum + Number(row.amount), 0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = Object.fromEntries(new FormData(form).entries()) as Record<
        string,
        unknown
      >;
    data.id = editing?.id || crypto.randomUUID();
    try {
      await mutate(editing ? "editAccountPayment" : "addAccountPayment", data);
      setEditing(null);
      form.reset();
      setPage(1);
    } catch {}
  }
  if (!financeUnlocked)
    return (
      <section className="gurminik-auth-gate gurminik-panel">
        <div className="gurminik-auth-gate-icon">
          <LockKeyhole />
        </div>
        <p>ŞİFRELİ FİNANS BÖLÜMÜ</p>
        <h3>Cari hesabı aç</h3>
        <span>
          Yetkiniz RLS ile denetlenir. Ödeme hareketlerini görüntülemek için
          ayrıca uygulama giriş şifrenizi doğrulayın.
        </span>
        <Button onClick={requestFinanceUnlock}>
          <Eye />
          Şifreyle aç
        </Button>
      </section>
    );
  return (
    <div className="grid gap-5">
      <DateRangeFilter
        range={range}
        onChange={(next) => {
          setRange(next);
          setPage(1);
        }}
        title="Cari Hesap tarih aralığı"
      />
      <div className="gurminik-summary-grid">
        <Stat label="Toplam tahsilat" value={money(total)} />
        <Stat label="Ödeme kaydı" value={periodRows.length} />
        <Stat
          label="Firma sayısı"
          value={new Set(periodRows.map((row) => norm(row.company))).size}
        />
      </div>
      {(permission.can_create || editing) && (
        <form
          key={editing?.id || "new"}
          onSubmit={submit}
          className="gurminik-panel gurminik-inline-form"
        >
          <div className="gurminik-block-heading">
            <p>{editing ? "KAYIT DÜZENLE" : "YENİ TAHSİLAT"}</p>
            <h3>{editing ? "Cari hareketi güncelle" : "Ödeme Kaydı Ekle"}</h3>
          </div>
          <div className="gurminik-form-grid">
            <Field
              name="company"
              label="Firma / Fabrika adı"
              defaultValue={editing?.company}
            />
            <Field
              name="amount"
              label="Ödeme miktarı (TL)"
              type="number"
              defaultValue={editing ? String(editing.amount) : undefined}
            />
            <Field
              name="dateTime"
              label="Ödeme tarihi"
              type="datetime-local"
              defaultValue={editing ? localInput(editing.dateTime) : localNow()}
            />
            <label>
              Ödeme yöntemi
              <select name="method" defaultValue={editing?.method || ""}>
                <option value="">Belirtilmedi</option>
                <option>Nakit</option>
                <option>Havale / EFT</option>
                <option>Çek</option>
                <option>Kredi kartı</option>
                <option>Diğer</option>
              </select>
            </label>
            <Field
              name="description"
              label="Açıklama / Not"
              required={false}
              defaultValue={editing?.description}
            />
          </div>
          <div className="gurminik-form-actions">
            {editing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Vazgeç
              </Button>
            )}
            <Button type="submit">
              <Save />
              {editing ? "Değişiklikleri kaydet" : "Ödemeyi kaydet"}
            </Button>
          </div>
        </form>
      )}
      <div className="gurminik-record-toolbar gurminik-panel">
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Firma, yöntem veya açıklama ara…"
        />
      </div>
      <section className="gurminik-table-panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Firma / Fabrika</TableHead>
              <TableHead>Ödeme</TableHead>
              <TableHead>Yöntem</TableHead>
              <TableHead>Açıklama</TableHead>
              <TableHead>Tarih</TableHead>
              {(permission.can_update || permission.can_delete) && (
                <TableHead>İşlem</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-bold">{row.company}</TableCell>
                  <TableCell>{money(row.amount)}</TableCell>
                  <TableCell>{row.method || "—"}</TableCell>
                  <TableCell>{row.description || "—"}</TableCell>
                  <TableCell>{dateTime(row.dateTime)}</TableCell>
                  {(permission.can_update || permission.can_delete) && (
                    <TableCell>
                      <div className="gurminik-row-actions">
                        {permission.can_update && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing(row)}
                          >
                            <Pencil />
                            Düzenle
                          </Button>
                        )}
                        {permission.can_delete && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Bu cari hesap kaydı silinsin mi?",
                                )
                              )
                                void mutate("deleteAccountPayment", {
                                  id: row.id,
                                });
                            }}
                          >
                            <Trash2 />
                            Sil
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={
                    permission.can_update || permission.can_delete ? 6 : 5
                  }
                  className="py-12 text-center text-zinc-500"
                >
                  Cari hesap hareketi bulunamadı.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <Pager page={page} setPage={setPage} total={filtered.length} />
      </section>
    </div>
  );
}

function Favorites({
  state,
  userId,
  mutate,
  permission,
  purchasePermission,
}: {
  state: State;
  userId: string;
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  permission: Permission;
  purchasePermission: Permission;
}) {
  const [selectedId, setSelectedId] = useState<string>(""),
    [message, setMessage] = useState(""),
    [sort, setSort] = useState<"weight" | "recent" | "name">(() => {
      const saved =
        typeof window === "undefined"
          ? null
          : localStorage.getItem(`gurminik_favorite_sort:${userId}`);
      return saved === "recent" || saved === "name" ? saved : "weight";
    }),
    [search, setSearch] = useState("");
  const supplierStats = useMemo(() => {
    const map = new Map<string, { total: number; last: number }>();
    for (const purchase of state.purchases) {
      if (purchase.status === "cancelled") continue;
      const id = norm(purchase.person),
        previous = map.get(id) || { total: 0, last: 0 };
      previous.total += Number(purchase.kg);
      previous.last = Math.max(
        previous.last,
        new Date(purchase.dateTime).getTime(),
      );
      map.set(id, previous);
    }
    return map;
  }, [state.purchases]);
  const favorites = state.favorites
    .filter(
      (item) =>
        norm(item.person).includes(norm(search)) ||
        norm(item.phone).includes(norm(search)),
    )
    .sort((a, b) => {
      const first = supplierStats.get(norm(a.person)),
        second = supplierStats.get(norm(b.person));
      const value =
        sort === "weight"
          ? (second?.total || 0) - (first?.total || 0)
          : sort === "recent"
            ? (second?.last || 0) - (first?.last || 0)
            : 0;
      return value || a.person.localeCompare(b.person, "tr-TR");
    });
  const selected =
    state.favorites.find((item) => item.id === selectedId) || null;
  return (
    <div className="grid gap-5">
      <section className="gurminik-panel gurminik-favorites-header">
        <div>
          <p className="gurminik-eyebrow">HIZLI ALIŞ</p>
          <h3>Favori tedarikçiler</h3>
          <span>
            Kişiyi seçin; son ürün, plaka ve fiyat hazır gelsin. Alanların
            tamamını kaydetmeden önce değiştirebilirsiniz.
          </span>
        </div>
        <Stat label="Favori kişi" value={state.favorites.length} />
      </section>
      <div className="gurminik-panel cold-search">
        <Input
          aria-label="Favori ara"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="İsim veya telefon ara…"
        />
        <select
          aria-label="Favorileri sırala"
          value={sort}
          onChange={(e) => {
            const value = e.target.value as typeof sort;
            setSort(value);
            localStorage.setItem(`gurminik_favorite_sort:${userId}`, value);
          }}
        >
          <option value="weight">En Çok Ürün Getiren</option>
          <option value="recent">En Son Ürün Getiren</option>
          <option value="name">İsim A-Z</option>
        </select>
      </div>
      {message && <div className="gurminik-import-result">{message}</div>}
      <div className="gurminik-favorite-grid">
        {favorites.map((item) => {
          const product = state.products.find(
              (p) => p.id === item.lastProductId,
            ),
            stats = supplierStats.get(norm(item.person));
          return (
            <article
              className={`gurminik-panel gurminik-favorite-card ${selectedId === item.id ? "is-selected" : ""}`}
              key={item.id}
            >
              <button
                className="gurminik-favorite-select"
                onClick={() => {
                  setSelectedId(item.id);
                  setMessage("");
                }}
              >
                <span className="gurminik-favorite-star">
                  <Star className="fill-current" />
                </span>
                <strong>{item.person}</strong>
                <small>
                  {product?.name || "Son ürün yok"} ·{" "}
                  {item.lastBuyPrice === null
                    ? "Fiyat yok"
                    : money(item.lastBuyPrice) + "/kg"}
                </small>
                <span>{item.plate || "Plaka yok"}</span>
                <small>
                  {stats
                    ? `${kg(stats.total)} · Son geliş: ${new Date(stats.last).toLocaleDateString("tr-TR")}`
                    : "Henüz aktif alış yok"}
                </small>
              </button>
              <div className="gurminik-favorite-actions">
                {item.phone && (
                  <a href={`tel:${item.phone}`}>
                    <PhoneCall />
                    Ara
                  </a>
                )}
                {permission.can_delete && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          item.person + " favorilerden çıkarılsın mı?",
                        )
                      )
                        void mutate("deleteFavorite", { id: item.id });
                    }}
                  >
                    <Trash2 />
                    Çıkar
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!state.favorites.length && (
        <div className="gurminik-panel gurminik-empty">
          Sıralamalar ekranından kişileri favorilere ekleyebilirsiniz.
        </div>
      )}
      {selected && purchasePermission.can_create && (
        <QuickFavoritePurchase
          key={selected.id}
          favorite={selected}
          state={state}
          mutate={mutate}
          onSaved={() =>
            setMessage(selected.person + " için alış kaydı buluta kaydedildi.")
          }
        />
      )}{" "}
      {selected && !purchasePermission.can_create && (
        <div className="gurminik-permission-error">
          Hızlı alış kaydetmek için “Tüm Alışlar → Ekle” yetkisi gereklidir.
        </div>
      )}
    </div>
  );
}

function QuickFavoritePurchase({
  favorite,
  state,
  mutate,
  onSaved,
}: {
  favorite: Favorite;
  state: State;
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  onSaved: () => void;
}) {
  const submitLock = useRef(false),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState("");
  const latest = state.purchases.find(
      (row) =>
        norm(row.person) === norm(favorite.person) &&
        row.status !== "cancelled",
    ),
    initialProduct =
      favorite.lastProductId ||
      latest?.productId ||
      state.products.find((p) => p.isActive !== false)?.id ||
      "";
  const [person, setPerson] = useState(favorite.person),
    [plate, setPlate] = useState(favorite.plate || latest?.plate || ""),
    [productId, setProductId] = useState(initialProduct),
    [price, setPrice] = useState(
      favorite.lastBuyPrice === null
        ? String(latest?.buyPrice || "")
        : String(favorite.lastBuyPrice),
    ),
    [amount, setAmount] = useState(""),
    [when, setWhen] = useState(localNow());
  function productChanged(id: string) {
    setProductId(id);
    const remembered =
      state.purchases.find(
        (row) =>
          row.productId === id &&
          norm(row.person) === norm(person) &&
          row.status !== "cancelled",
      ) ||
      state.purchases.find(
        (row) => row.productId === id && row.status !== "cancelled",
      );
    setPrice(remembered ? String(remembered.buyPrice) : "");
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSaving(true);
    setFormError("");
    try {
      await mutate("addPurchase", {
        id: crypto.randomUUID(),
        person,
        plate,
        productId,
        kg: amount,
        buyPrice: price,
        dateTime: when,
        isPaid: true,
      });
      setAmount("");
      setWhen(localNow());
      onSaved();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Kayıt yapılamadı.",
      );
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="gurminik-panel gurminik-quick-purchase">
      <div className="gurminik-block-heading">
        <p>FAVORİDEN HIZLI ALIŞ</p>
        <h3>{favorite.person}</h3>
      </div>
      <div className="gurminik-form-grid">
        <label>
          Getiren kişi
          <Input
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            required
          />
        </label>
        <label>
          Araç plakası
          <Input
            value={plate}
            onChange={(e) =>
              setPlate(e.target.value.toLocaleUpperCase("tr-TR"))
            }
            required
          />
        </label>
        <label>
          Ürün
          <select
            value={productId}
            onChange={(e) => productChanged(e.target.value)}
            required
          >
            {state.products
              .filter((p) => p.isActive !== false || p.id === productId)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Alış fiyatı (TL/kg)
          <Input
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </label>
        <label className="gurminik-quick-kg">
          Yeni miktar (kg)
          <Input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label>
          Tarih ve saat
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </label>
      </div>
      {formError && (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      )}
      <div className="gurminik-form-actions">
        {favorite.phone && (
          <a className="gurminik-tel-button" href={`tel:${favorite.phone}`}>
            <PhoneCall />
            {favorite.phone}
          </a>
        )}
        <Button type="submit" disabled={saving}>
          <Save />
          {saving ? "Kaydediliyor…" : "Alışı buluta kaydet"}
        </Button>
      </div>
    </form>
  );
}

function Expenses({
  userId,
  state,
  page,
  setPage,
  mutate,
  permission,
}: {
  userId: string;
  state: State;
  page: number;
  setPage: (p: number) => void;
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  permission: Permission;
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("");
  const { range, setRange } = useRememberedDateRange(userId, "expenses"),
    periodRows = state.expenses.filter((x) =>
      inRememberedDateRange(x.dateTime, range),
    ),
    categoryRows = periodRows.filter(
      (x) => !category || x.category === category,
    ),
    filtered = categoryRows.filter(
      (x) =>
        !search ||
        [x.title, x.category].some((v) => norm(v).includes(norm(search))),
    ),
    rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    allTotal = periodRows.reduce((s, x) => s + Number(x.amount), 0),
    total = categoryRows.reduce((s, x) => s + Number(x.amount), 0),
    share = allTotal ? (100 * total) / allTotal : 0;
  const categoryTotals = state.categories
    .map((c) => ({
      name: c.name,
      total: periodRows
        .filter((x) => x.category === c.name)
        .reduce((s, x) => s + Number(x.amount), 0),
    }))
    .sort((a, b) => b.total - a.total);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = Object.fromEntries(new FormData(form).entries()) as Record<
        string,
        unknown
      >;
    data.id = crypto.randomUUID();
    try {
      await mutate("addExpense", data);
      form.reset();
    } catch {}
  }
  async function addCategory() {
    const name = window.prompt("Yeni gider kategorisinin adı:")?.trim();
    if (!name) return;
    if (state.categories.some((c) => norm(c.name) === norm(name))) {
      window.alert("Bu kategori zaten mevcut.");
      return;
    }
    await mutate("addCategory", { id: crypto.randomUUID(), name });
  }
  return (
    <>
      <DateRangeFilter
        range={range}
        onChange={(next) => {
          setRange(next);
          setPage(1);
        }}
        title="Giderler tarih aralığı"
      />
      <div className="gurminik-record-toolbar gurminik-panel">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Gider veya kategori ara…"
        />
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm kategoriler</option>
          {state.categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <p className="gurminik-filter-label">
        {state.categories.find((c) => c.name === category)?.name ||
          "Tüm kategoriler"}
        {search ? ` · Liste araması: ${search}` : ""}
      </p>
      <div className="gurminik-summary-grid gurminik-expense-summary">
        <Stat
          label={category ? "Kategori gideri" : "Toplam gider"}
          value={money(total)}
        />
        <Stat label="Seçili dönem" value={money(total)} />
        <Stat label="Gider kaydı" value={categoryRows.length} />
        <Stat
          label="Tüm giderlerdeki payı"
          value={`%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(share)}`}
        />
      </div>
      <div className="gurminik-expense-layout">
        {permission.can_create && (
          <form
            onSubmit={submit}
            className="gurminik-panel gurminik-inline-form"
          >
            <div className="gurminik-block-heading">
              <p>YENİ GİDER</p>
              <h3>Gider Kaydı Ekle</h3>
            </div>
            <div className="gurminik-form-grid">
              <Field
                name="title"
                label="Açıklama"
                placeholder="Örn. 10 adet yemek"
              />
              <Field name="amount" label="Tutar (TL)" type="number" />
              <label>
                Kategori
                <select
                  name="category"
                  required
                  defaultValue={state.categories[0]?.name || ""}
                >
                  {state.categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                name="dateTime"
                label="Tarih ve saat"
                type="datetime-local"
                defaultValue={localNow()}
              />
            </div>
            <div className="gurminik-form-actions">
              <Button type="button" variant="outline" onClick={addCategory}>
                <Plus />
                Yeni kategori
              </Button>
              <Button type="submit">Gideri kaydet</Button>
            </div>
          </form>
        )}
        <aside className="gurminik-panel gurminik-category-panel">
          <div className="gurminik-block-heading">
            <p>KATEGORİ DAĞILIMI</p>
            <h3>Kategori Toplamları</h3>
          </div>
          {categoryTotals.map((x) => (
            <div className="gurminik-metric-row" key={x.name}>
              <span>{x.name}</span>
              <strong>{money(x.total)}</strong>
            </div>
          ))}
        </aside>
      </div>
      <div className="gurminik-table-panel">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-100">
              <TableHead>Açıklama</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Tutar</TableHead>
              <TableHead>Tarih</TableHead>
              {permission.can_delete && <TableHead>İşlem</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-bold">{x.title}</TableCell>
                  <TableCell>{x.category}</TableCell>
                  <TableCell>{money(x.amount)}</TableCell>
                  <TableCell>{dateTime(x.dateTime)}</TableCell>
                  {permission.can_delete && (
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (window.confirm("Bu gider kaydı silinsin mi?"))
                            mutate("deleteExpense", { id: x.id });
                        }}
                      >
                        Sil
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={permission.can_delete ? 5 : 4}
                  className="py-12 text-center text-zinc-500"
                >
                  Gösterilecek gider bulunamadı.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <Pager page={page} setPage={setPage} total={filtered.length} />
      </div>
    </>
  );
}

function Contacts({
  state,
  search,
  setSearch,
  page,
  setPage,
  mutate,
  importContacts,
  permission,
}: {
  state: State;
  search: string;
  setSearch: (v: string) => void;
  page: number;
  setPage: (p: number) => void;
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  importContacts: (rows: ParsedVCardContact[]) => Promise<ContactImportResult>;
  permission: Permission;
}) {
  const [category, setCategory] = useState(""),
    [previewOpen, setPreviewOpen] = useState(false),
    [previewRows, setPreviewRows] = useState<ParsedVCardContact[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [invalid, setInvalid] = useState(0),
    [fileDuplicates, setFileDuplicates] = useState(0),
    [fileName, setFileName] = useState(""),
    [importing, setImporting] = useState(false),
    [importMessage, setImportMessage] = useState("");
  const contacts = state.contacts,
    existingKeys = new Set(
      contacts.map((x) => normalizePhone(x.phone)).filter(Boolean),
    ),
    searchDigits = search.replace(/\D/g, ""),
    phoneQuery = searchDigits.startsWith("0")
      ? "90" + searchDigits.slice(1)
      : searchDigits,
    filtered = contacts.filter(
      (x) =>
        (!category || x.category === category) &&
        (!search ||
          [x.name, x.phone, x.category, x.note].some((v) =>
            norm(v).includes(norm(search)),
          ) ||
          (phoneQuery && normalizePhone(x.phone).includes(phoneQuery))),
    ),
    rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const newPreviewRows = previewRows.filter(
      (row) => !existingKeys.has(row.phoneKey),
    ),
    alreadyExisting = previewRows.length - newPreviewRows.length,
    selectedRows = newPreviewRows.filter((row) => selected.has(row.id));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = Object.fromEntries(new FormData(form).entries()) as Record<
        string,
        unknown
      >;
    const phone = formatPhone(String(data.phone || ""));
    if (!normalizePhone(phone)) {
      setImportMessage("Telefon numarası geçerli değil.");
      return;
    }
    if (existingKeys.has(normalizePhone(phone))) {
      setImportMessage("Bu telefon numarası rehberde zaten kayıtlı.");
      return;
    }
    data.id = crypto.randomUUID();
    data.phone = phone;
    try {
      await mutate("addContact", data);
      form.reset();
      setPage(1);
      setImportMessage("Telefon numarası kaydedildi.");
    } catch {}
  }
  async function addContactCategory() {
    const name = window.prompt("Yeni kişi kategorisinin adı:")?.trim();
    if (!name) return;
    if (state.contactCategories.some((c) => norm(c.name) === norm(name))) {
      window.alert("Bu kategori zaten mevcut.");
      return;
    }
    await mutate("addContactCategory", { id: crypto.randomUUID(), name });
  }
  async function chooseVCard(file: File) {
    setImportMessage("");
    try {
      const parsed = parseVCard(decodeVCardBuffer(await file.arrayBuffer()));
      if (!parsed.cards) throw new Error("Dosyada vCard kaydı bulunamadı.");
      setFileName(file.name);
      setPreviewRows(parsed.contacts);
      setInvalid(parsed.invalid);
      setFileDuplicates(parsed.duplicatesInFile);
      setSelected(
        new Set(
          parsed.contacts
            .filter((row) => !existingKeys.has(row.phoneKey))
            .map((row) => row.id),
        ),
      );
      setPreviewOpen(true);
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "VCF dosyası okunamadı.",
      );
    }
  }
  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(
      selectedRows.length === newPreviewRows.length
        ? new Set()
        : new Set(newPreviewRows.map((row) => row.id)),
    );
  }
  async function confirmImport() {
    if (!selectedRows.length) return;
    setImporting(true);
    try {
      const result = await importContacts(selectedRows);
      setPreviewOpen(false);
      setImportMessage(
        `${result.added} numara eklendi · ${result.skipped + alreadyExisting + fileDuplicates} mükerrer atlandı · ${invalid} hatalı kayıt bulundu.`,
      );
      setPage(1);
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "Rehber buluta aktarılamadı.",
      );
    } finally {
      setImporting(false);
    }
  }
  return (
    <>
      <div className="gurminik-contact-summary">
        <Stat label="Kayıtlı numara" value={contacts.length} />
        <Stat label="Kategori" value={state.contactCategories.length} />
      </div>
      {importMessage && (
        <div className="gurminik-import-result" role="status">
          {importMessage}
        </div>
      )}
      {permission.can_create && (
        <form
          onSubmit={submit}
          className="gurminik-panel gurminik-inline-form gurminik-contact-form"
        >
          <div className="gurminik-block-heading">
            <p>YENİ TELEFON KAYDI</p>
            <h3>Kişi Ekle</h3>
          </div>
          <div className="gurminik-contact-fields">
            <Field name="name" label="Adı soyadı" placeholder="Örn. Murat" />
            <Field
              name="phone"
              label="Telefon numarası"
              type="tel"
              placeholder="Örn. 0532 000 00 00"
            />
            <label>
              Kategori
              <select
                name="category"
                required
                defaultValue={state.contactCategories[0]?.name || "Diğer"}
              >
                {state.contactCategories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              name="note"
              label="Not"
              required={false}
              placeholder="Örn. Limon tedarikçisi"
            />
          </div>
          <div className="gurminik-form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={addContactCategory}
            >
              <Plus />
              Yeni kategori
            </Button>
            <label className="gurminik-vcard-button">
              <Upload />
              Rehberden İçe Aktar
              <input
                type="file"
                accept=".vcf,text/vcard,text/x-vcard"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await chooseVCard(file);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <Button type="submit">Numarayı kaydet</Button>
          </div>
        </form>
      )}
      <div className="gurminik-record-toolbar gurminik-panel">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="İsim veya telefon numarası ara…"
        />
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tüm kategoriler</option>
          {state.contactCategories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="gurminik-table-panel">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-100">
              <TableHead>İsim</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead>Not</TableHead>
              {permission.can_delete && <TableHead>İşlem</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-bold">{x.name}</TableCell>
                  <TableCell>
                    <span className="gurminik-contact-badge">{x.category}</span>
                  </TableCell>
                  <TableCell>
                    <div className="gurminik-contact-actions">
                      <a href={`tel:${x.phone}`}>
                        <PhoneCall />
                        {x.phone}
                      </a>
                      <a
                        href={`https://wa.me/${whatsAppNumber(x.phone)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MessageCircle />
                        WhatsApp
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>{x.note || "—"}</TableCell>
                  {permission.can_delete && (
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (window.confirm("Bu telefon kaydı silinsin mi?"))
                            mutate("deleteContact", { id: x.id });
                        }}
                      >
                        Sil
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={permission.can_delete ? 5 : 4}
                  className="py-12 text-center text-zinc-500"
                >
                  Telefon kaydı bulunamadı.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <Pager page={page} setPage={setPage} total={filtered.length} />
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="gurminik-vcard-dialog sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Rehber aktarım önizlemesi</DialogTitle>
            <DialogDescription>
              {fileName} içindeki numaraları kontrol edin. Yalnızca işaretli ve
              yeni numaralar kaydedilir.
            </DialogDescription>
          </DialogHeader>
          <div className="gurminik-vcard-summary">
            <span>
              <strong>{newPreviewRows.length}</strong> eklenebilir
            </span>
            <span>
              <strong>{alreadyExisting + fileDuplicates}</strong> mükerrer
            </span>
            <span>
              <strong>{invalid}</strong> hatalı
            </span>
          </div>
          <div className="gurminik-vcard-toolbar">
            <Button
              type="button"
              variant="outline"
              onClick={toggleAll}
              disabled={!newPreviewRows.length}
            >
              {selectedRows.length === newPreviewRows.length &&
              newPreviewRows.length
                ? "Tüm seçimi kaldır"
                : "Tümünü seç"}
            </Button>
            <span>{selectedRows.length} numara seçildi</span>
          </div>
          <div className="gurminik-vcard-list">
            {previewRows.length ? (
              previewRows.map((row) => {
                const duplicate = existingKeys.has(row.phoneKey);
                return (
                  <label
                    key={row.id}
                    className={`gurminik-vcard-row ${duplicate ? "is-duplicate" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={!duplicate && selected.has(row.id)}
                      disabled={duplicate}
                      onChange={() => toggleRow(row.id)}
                    />
                    <span className="gurminik-vcard-avatar">
                      <Users />
                    </span>
                    <span>
                      <strong>{row.name}</strong>
                      <small>
                        {row.phone}
                        {row.unnamed ? " · İsim bulunamadı" : ""}
                      </small>
                    </span>
                    <b>{duplicate ? "Zaten kayıtlı" : "Yeni"}</b>
                  </label>
                );
              })
            ) : (
              <div className="gurminik-vcard-empty">
                Aktarılabilecek geçerli telefon numarası bulunamadı.
              </div>
            )}
          </div>
          <div className="gurminik-vcard-footer">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreviewOpen(false)}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              onClick={confirmImport}
              disabled={importing || !selectedRows.length}
            >
              {importing ? <RefreshCw className="animate-spin" /> : <Upload />}
              {importing
                ? "Buluta aktarılıyor…"
                : `${selectedRows.length} numarayı aktar`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function pdfAscii(v: unknown) {
  return String(v ?? "")
    .replace(
      /[çÇğĞıİöÖşŞüÜ]/g,
      (c) =>
        ({
          ç: "c",
          Ç: "C",
          ğ: "g",
          Ğ: "G",
          ı: "i",
          İ: "I",
          ö: "o",
          Ö: "O",
          ş: "s",
          Ş: "S",
          ü: "u",
          Ü: "U",
        })[c] || c,
    )
    .replace(/[^\x20-\x7E]/g, "?");
}
function pdfEsc(v: unknown) {
  return pdfAscii(v).replace(/([\\()])/g, "\\$1");
}
function pdfMoney(n: number) {
  return (
    new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(n) || 0) + " TL"
  );
}
function assemblePdf(pages: string[][]) {
  const objects: Record<number, string> = {
      1: "<< /Type /Catalog /Pages 2 0 R >>",
      3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    },
    kids: string[] = [];
  pages.forEach((commands, index) => {
    const pageId = 5 + index * 2,
      contentId = pageId + 1,
      content = commands.join("\n");
    kids.push(`${pageId} 0 R`);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0],
    max = Math.max(...Object.keys(objects).map(Number));
  for (let i = 1; i <= max; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= max; i++)
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  return (
    pdf +
    `trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  );
}
export function createStyledPdf(
  state: State,
  title: string,
  label: string,
  sourceRecords: Purchase[],
  sourceExpenses: Expense[],
  sourceSales: Sale[] = [],
  sourceAccounts: AccountPayment[] = [],
  coldReport?: { state: ColdState; start: number; end: number },
) {
  const pages: string[][] = [[]];
  let page = 0,
    y = 515;
  const cmd = (s: string) => pages[page].push(s),
    text = (
      x: number,
      py: number,
      size: number,
      value: unknown,
      bold = false,
      color = "0 0 0",
    ) =>
      cmd(
        `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg ${x} ${py} Td (${pdfEsc(value)}) Tj ET`,
      ),
    fill = (x: number, py: number, w: number, h: number, color: string) =>
      cmd(`${color} rg ${x} ${py} ${w} ${h} re f`),
    stroke = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color = ".82 .82 .82",
    ) => cmd(`${color} RG ${x1} ${y1} m ${x2} ${y2} l S`);
  function header() {
    fill(0, 535, 842, 60, ".07 .075 .08");
    text(30, 567, 16, "GURMINIK", true, "1 1 1");
    text(30, 548, 9, title + "  |  " + label, false, ".78 .78 .78");
  }
  function newPage() {
    page++;
    pages.push([]);
    y = 515;
    header();
  }
  function ensure(h: number) {
    if (y - h < 38) newPage();
  }
  function section(name: string) {
    ensure(62);
    y -= 11;
    text(30, y, 12, name, true, ".14 .14 .14");
    y -= 9;
    fill(30, y, 782, 2, ".76 .51 .29");
    y -= 13;
  }
  function fit(value: unknown, width: number, size = 8) {
    const s = pdfAscii(value),
      max = Math.max(3, Math.floor(width / (size * 0.53)));
    return s.length > max ? s.slice(0, max - 3) + "..." : s;
  }
  function table(headers: string[], widths: number[], rows: unknown[][]) {
    const total = widths.reduce((a, b) => a + b, 0),
      rowH = 20,
      tableHeader = () => {
        ensure(rowH * 2);
        fill(30, y - rowH, total, rowH, ".16 .17 .18");
        let x = 34;
        headers.forEach((h, i) => {
          text(x, y - 14, 7.5, fit(h, widths[i] - 8, 7.5), true, "1 1 1");
          x += widths[i];
        });
        y -= rowH;
      };
    tableHeader();
    if (!rows.length) {
      text(34, y - 14, 8, "Kayit bulunamadi.", false, ".45 .45 .45");
      y -= rowH;
      return;
    }
    rows.forEach((row, index) => {
      if (y - rowH < 38) {
        newPage();
        tableHeader();
      }
      if (index % 2 === 1) fill(30, y - rowH, total, rowH, ".96 .96 .95");
      let x = 34;
      row.forEach((cell, i) => {
        text(x, y - 14, 7.5, fit(cell, widths[i] - 8, 7.5));
        x += widths[i];
      });
      stroke(30, y - rowH, 30 + total, y - rowH);
      y -= rowH;
    });
    y -= 5;
  }
  header();
  const live = sourceRecords.filter((r) => r.status !== "cancelled"),
    liveSales = sourceSales.filter((r) => r.status !== "cancelled"),
    totalKg = live.reduce((s, r) => s + Number(r.kg), 0),
    salesKg = liveSales.reduce((s, r) => s + Number(r.kg), 0),
    cost = live.reduce((s, r) => s + Number(r.kg) * Number(r.buyPrice), 0),
    salesAmount = liveSales.reduce(
      (s, r) => s + Number(r.kg) * Number(r.sellPrice),
      0,
    ),
    expense = sourceExpenses.reduce((s, x) => s + Number(x.amount), 0),
    profit = salesAmount - cost - expense,
    cards: [
      [string, unknown],
      [string, unknown],
      [string, unknown],
      [string, unknown],
      [string, unknown],
      [string, unknown],
    ] = [
      ["ALIS KG", new Intl.NumberFormat("tr-TR").format(totalKg)],
      ["SATIS KG", new Intl.NumberFormat("tr-TR").format(salesKg)],
      ["ALIS TUTARI", pdfMoney(cost)],
      ["SATIS TUTARI", pdfMoney(salesAmount)],
      ["GIDER", pdfMoney(expense)],
      ["TAHMINI KAR", pdfMoney(profit)],
    ];
  cards.forEach((c, i) => {
    const x = 30 + (i % 3) * 264,
      cy = y - Math.floor(i / 3) * 61;
    fill(x, cy - 55, 250, 55, ".94 .93 .91");
    text(x + 12, cy - 20, 7.5, c[0], true, ".42 .42 .42");
    text(x + 12, cy - 42, 13, c[1], true, ".10 .10 .10");
  });
  y -= 132;
  section("URUN OZETLERI");
  const productRows = state.products
    .map((p) => {
      const r = live.filter((x) => x.productId === p.id),
        pk = r.reduce((s, x) => s + Number(x.kg), 0),
        pc = r.reduce((s, x) => s + Number(x.kg) * Number(x.buyPrice), 0);
      return [
        p.name,
        pk + " kg",
        pdfMoney(pk ? pc / pk : 0) + " / kg",
        pdfMoney(pc),
        r.length,
      ];
    })
    .filter((r) => Number.parseFloat(String(r[1])) > 0);
  table(
    ["Urun", "Miktar", "Ortalama maliyet", "Toplam alis", "Kayit"],
    [190, 130, 165, 165, 90],
    productRows,
  );
  section("TEDARIKCI TOPLAMLARI");
  const suppliers = Object.values(
    live.reduce<Record<string, { name: string; kg: number }>>((m, r) => {
      const key = norm(r.person);
      m[key] ??= { name: r.person, kg: 0 };
      m[key].kg += Number(r.kg);
      return m;
    }, {}),
  ).sort((a, b) => b.kg - a.kg);
  table(
    ["Sira", "Kisi", "Toplam miktar"],
    [70, 360, 210],
    suppliers.map((x, i) => [i + 1, x.name, x.kg + " kg"]),
  );
  section("ALIS KAYITLARI");
  table(
    [
      "Tarih",
      "Kisi",
      "Urun",
      "Plaka",
      "Kg",
      "TL / kg",
      "Toplam",
      "Odeme",
      "Durum",
    ],
    [90, 112, 88, 88, 68, 80, 100, 88, 66],
    [...sourceRecords]
      .sort(
        (a, b) =>
          new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
      )
      .map((r) => [
        dateTime(r.dateTime),
        r.person,
        state.products.find((p) => p.id === r.productId)?.name || "Urun",
        r.plate,
        r.kg,
        pdfMoney(r.buyPrice),
        pdfMoney(r.kg * r.buyPrice),
        r.isPaid === false ? "ODENMEDI" : "ODENDI",
        r.status === "cancelled" ? "IPTAL" : "AKTIF",
      ]),
  );
  section("SATIS URUN OZETLERI");
  const saleProductRows = state.products
    .map((p) => {
      const r = liveSales.filter((x) => x.productId === p.id),
        sk = r.reduce((s, x) => s + Number(x.kg), 0),
        sa = r.reduce((s, x) => s + Number(x.kg) * Number(x.sellPrice), 0);
      return [
        p.name,
        sk + " kg",
        pdfMoney(sk ? sa / sk : 0) + " / kg",
        pdfMoney(sa),
        r.length,
      ];
    })
    .filter((r) => Number.parseFloat(String(r[1])) > 0);
  table(
    ["Urun", "Satilan miktar", "Ort. satis fiyati", "Toplam satis", "Kayit"],
    [190, 135, 165, 160, 90],
    saleProductRows,
  );
  section("SATIS KAYITLARI");
  table(
    [
      "Tarih",
      "Alici / Fabrika",
      "Sofor",
      "Kamyon plakasi",
      "Urun",
      "Kg",
      "TL / kg",
      "Toplam",
      "Durum",
    ],
    [88, 120, 93, 92, 80, 60, 74, 92, 70],
    [...sourceSales]
      .sort(
        (a, b) =>
          new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
      )
      .map((r) => [
        dateTime(r.dateTime),
        r.buyer,
        r.driver || "-",
        r.plate || "-",
        state.products.find((p) => p.id === r.productId)?.name || "Urun",
        r.kg,
        pdfMoney(r.sellPrice),
        pdfMoney(r.kg * r.sellPrice),
        r.status === "cancelled" ? "IPTAL" : "AKTIF",
      ]),
  );
  section("GIDER KATEGORI OZETI");
  table(
    ["Kategori", "Toplam"],
    [390, 250],
    state.categories
      .map((c) => [
        c.name,
        pdfMoney(
          sourceExpenses
            .filter((x) => x.category === c.name)
            .reduce((s, x) => s + Number(x.amount), 0),
        ),
      ])
      .filter((r) => r[1] !== "0,00 TL"),
  );
  section("GIDER KAYITLARI");
  table(
    ["Tarih", "Aciklama", "Kategori", "Tutar"],
    [120, 300, 150, 150],
    [...sourceExpenses]
      .sort(
        (a, b) =>
          new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
      )
      .map((x) => [
        dateTime(x.dateTime),
        x.title,
        x.category,
        pdfMoney(x.amount),
      ]),
  );
  section("CARI HESAP HAREKETLERI");
  table(
    ["Odeme tarihi", "Firma / Fabrika", "Odeme yontemi", "Aciklama", "Tutar"],
    [125, 185, 120, 215, 135],
    [...sourceAccounts]
      .sort(
        (a, b) =>
          new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime(),
      )
      .map((x) => [
        dateTime(x.dateTime),
        x.company,
        x.method || "Belirtilmedi",
        x.description || "-",
        pdfMoney(x.amount),
      ]),
  );
  if (coldReport) {
    newPage();
    const cs = coldReport.state,
      c = coldSummary(cs, coldReport.start, coldReport.end);
    section("SOGUK HAVA DEPOSU - AYRI ISLETME");
    table(
      [
        "Alis KG",
        "Alis tutari",
        "Ort. alis",
        "Satis KG",
        "Satis tutari",
        "Ort. satis",
      ],
      [125, 145, 120, 125, 145, 120],
      [
        [
          kg(c.buyKg),
          pdfMoney(c.buyCost),
          pdfMoney(c.averageBuy),
          kg(c.saleKg),
          pdfMoney(c.revenue),
          pdfMoney(c.averageSale),
        ],
      ],
    );
    section("SOGUK HAVA GIDER VE KAR");
    table(
      ["Gider", "Fire KG", "Satilan mal maliyeti", "Gerceklesmis kar", "Kar / KG"],
      [145, 125, 185, 180, 145],
      [
        [
          pdfMoney(c.expenses),
          kg(c.fireKg),
          pdfMoney(c.costOfGoods),
          pdfMoney(c.profit),
          pdfMoney(c.profitPerKg),
        ],
      ],
    );
    section("SOGUK HAVA URUN DAGILIMI");
    table(
      ["Urun", "Alis KG", "Satis KG", "Fire KG", "Kar"],
      [170, 145, 145, 145, 175],
      coldProducts(cs).map((name) => {
        const x = coldSummary(cs, coldReport.start, coldReport.end, name);
        return [
          name,
          kg(x.buyKg),
          kg(x.saleKg),
          kg(x.fireKg),
          pdfMoney(x.profit),
        ];
      }),
    );
    section("SOGUK HAVA GIDER KATEGORILERI");
    const coldPeriodExpenses = cs.expenses.filter((x) => {
        const stamp = new Date(x.dateTime).getTime();
        return stamp >= coldReport.start && stamp < coldReport.end;
      }),
      coldExpenseTotal = coldPeriodExpenses.reduce((a, x) => a + x.amount, 0);
    table(
      ["Kategori", "Tutar", "Pay"],
      [320, 280, 180],
      [...new Set(coldPeriodExpenses.map((x) => x.category))].map((name) => {
        const amount = coldPeriodExpenses
          .filter((x) => x.category === name)
          .reduce((a, x) => a + x.amount, 0);
        return [
          name,
          pdfMoney(amount),
          `%${coldExpenseTotal ? ((amount * 100) / coldExpenseTotal).toFixed(1) : "0"}`,
        ];
      }),
    );
    section("SOGUK HAVA FIRE HAREKETLERI");
    table(
      ["Tarih", "Urun", "Fire KG", "TL Karsiligi", "Aciklama"],
      [120, 155, 120, 155, 230],
      coldPeriodExpenses
        .filter((x) => norm(x.category) === "fire")
        .map((x) => [
          dateTime(x.dateTime),
          x.product || "-",
          kg(x.lossKg),
          pdfMoney(x.amount),
          x.note || "-",
        ]),
    );
  }
  pages.forEach((p, i) => {
    p.push(
      `BT /F1 7.5 Tf .45 .45 .45 rg 30 17 Td (Olusturma: ${pdfEsc(new Date().toLocaleString("tr-TR"))}) Tj ET`,
    );
    p.push(
      `BT /F2 7.5 Tf .25 .25 .25 rg 755 17 Td (Sayfa ${i + 1} / ${pages.length}) Tj ET`,
    );
  });
  return assemblePdf(pages);
}
function downloadPdf(filename: string, content: string) {
  const url = URL.createObjectURL(
      new Blob([content], { type: "application/pdf" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Reports({
  state,
  coldState,
  financeUnlocked,
  requestFinanceUnlock,
  period,
  setPeriod,
  date,
  setDate,
  rangeStart,
  setRangeStart,
  rangeEnd,
  setRangeEnd,
  onPdfExport,
}: {
  state: State;
  coldState?: ColdState;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
  period: "daily" | "weekly" | "monthly" | "range" | "full";
  setPeriod: (v: "daily" | "weekly" | "monthly" | "range" | "full") => void;
  date: string;
  setDate: (v: string) => void;
  rangeStart: string;
  setRangeStart: (v: string) => void;
  rangeEnd: string;
  setRangeEnd: (v: string) => void;
  onPdfExport: (module: "reports" | "cold_storage", name: string, start?: string | null, end?: string | null) => Promise<void>;
}) {
  const { start, end, label } = useMemo(
    () => getRange(period, date, rangeStart, rangeEnd),
    [period, date, rangeStart, rangeEnd],
  );
  const inRange = (v: string) => {
      const d = new Date(v);
      return d >= start && d < end;
    },
    rows = state.purchases.filter(
      (x) => x.status !== "cancelled" && inRange(x.dateTime),
    ),
    sales = state.sales.filter(
      (x) => x.status !== "cancelled" && inRange(x.dateTime),
    ),
    exps = state.expenses.filter((x) => inRange(x.dateTime)),
    accounts = state.accountPayments.filter((x) => inRange(x.dateTime));
  const totalKg = rows.reduce((s, x) => s + Number(x.kg), 0),
    salesKg = sales.reduce((s, x) => s + Number(x.kg), 0),
    cost = rows.reduce((s, x) => s + Number(x.kg) * Number(x.buyPrice), 0),
    salesAmount = sales.reduce(
      (s, x) => s + Number(x.kg) * Number(x.sellPrice),
      0,
    ),
    expense = exps.reduce((s, x) => s + Number(x.amount), 0),
    accountTotal = accounts.reduce((s, x) => s + Number(x.amount), 0),
    profit = salesAmount - cost - expense;
  const products = state.products
    .map((p) => {
      const r = rows.filter((x) => x.productId === p.id),
        k = r.reduce((s, x) => s + Number(x.kg), 0),
        c = r.reduce((s, x) => s + Number(x.kg) * Number(x.buyPrice), 0);
      return { name: p.name, kg: k, cost: c, avg: k ? c / k : 0 };
    })
    .filter((x) => x.kg);
  async function print(full = false) {
    if (!financeUnlocked) {
      requestFinanceUnlock();
      return;
    }
    const reportRows = full ? state.purchases : rows,
      reportSales = full ? state.sales : sales,
      reportExps = full ? state.expenses : exps,
      reportAccounts = full ? state.accountPayments : accounts,
      reportLabel = full ? "Tum zamanlar" : label,
      reportTitle = full
        ? "TAM ISLETME RAPORU"
        : period === "daily"
          ? "GUNLUK RAPOR"
          : period === "weekly"
            ? "HAFTALIK RAPOR"
            : period === "monthly"
              ? "AYLIK RAPOR"
              : "TARIH ARALIGI RAPORU",
      suffix = full
        ? new Date().toISOString().slice(0, 10)
        : period === "range"
          ? `${rangeStart}-${rangeEnd}`
          : date;
    downloadPdf(
      `gurminik-${full ? "tam-rapor" : period + "-rapor"}-${suffix}.pdf`,
      createStyledPdf(
        state,
        reportTitle,
        reportLabel,
        reportRows,
        reportExps,
        reportSales,
        reportAccounts,
        coldState
          ? {
              state: coldState,
              start: full ? -Infinity : start.getTime(),
              end: full ? Infinity : end.getTime(),
            }
          : undefined,
      ),
    );
    await onPdfExport(
      "reports",
      full ? "Tam İşletme Raporu PDF" : `${label} İşletme Raporu PDF`,
      full ? null : start.toISOString().slice(0,10),
      full ? null : new Date(end.getTime()-1).toISOString().slice(0,10),
    );
  }
  return (
    <>
      <section className="gurminik-report-hero gurminik-panel">
        <div>
          <p>TAM VERİ DÖKÜMÜ</p>
          <h3>İşletme Raporu</h3>
          <span>
            Alışlar, satışlar, giderler ve cari hesap tahsilatlarıyla düzenli
            tam işletme raporu. Finansal tutarlar için şifre gerekir.
          </span>
        </div>
        <Button onClick={() => void print(true)}>
          {financeUnlocked ? <BarChart3 /> : <LockKeyhole />}Tam PDF raporunu
          indir
        </Button>
      </section>
      <section className="gurminik-period-panel gurminik-panel">
        <div className="gurminik-block-heading">
          <p>DÖNEM RAPORLARI</p>
          <h3>Günlük, Haftalık ve Aylık Rapor</h3>
        </div>
        <div className="gurminik-period-toolbar">
          <div className="gurminik-period-tabs">
            {(["daily", "weekly", "monthly", "range"] as const).map((x) => (
              <button
                key={x}
                className={period === x ? "is-active" : ""}
                onClick={() => setPeriod(x)}
              >
                {x === "daily"
                  ? "Günlük"
                  : x === "weekly"
                    ? "Haftalık"
                    : x === "monthly"
                      ? "Aylık"
                      : "Tarih aralığı"}
              </button>
            ))}
          </div>
          {period === "range" ? (
            <div className="gurminik-range-inputs">
              <label>
                Başlangıç
                <Input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                />
              </label>
              <label>
                Bitiş
                <Input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <label className="gurminik-date-input">
              Rapor tarihi
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          )}
          <Button variant="outline" onClick={() => void print(false)}>
            {financeUnlocked ? <BarChart3 /> : <LockKeyhole />}Bu dönemi PDF
            indir
          </Button>
        </div>
        <div className="gurminik-period-label">{label}</div>
        <div className="gurminik-summary-grid gurminik-report-stats">
          <Stat label="Alınan ürün" value={kg(totalKg)} />
          <Stat label="Alış tutarı" value={money(cost)} />
          <Stat label="Giderler" value={money(expense)} />
          <ProtectedStat
            label="Cari tahsilat"
            value={money(accountTotal)}
            unlocked={financeUnlocked}
            onUnlock={requestFinanceUnlock}
          />
          <Stat label="Satılan ürün" value={kg(salesKg)} />
          <ProtectedStat
            label="Satış tutarı"
            value={money(salesAmount)}
            unlocked={financeUnlocked}
            onUnlock={requestFinanceUnlock}
          />
          <ProtectedStat
            label="Tahmini kâr"
            value={money(profit)}
            unlocked={financeUnlocked}
            onUnlock={requestFinanceUnlock}
          />
        </div>
        <div className="gurminik-period-breakdown">
          <article>
            <h4>Ürün özeti</h4>
            {products.length ? (
              products.map((x) => (
                <div className="gurminik-metric-row" key={x.name}>
                  <span>
                    {x.name} · {kg(x.kg)}
                  </span>
                  <strong>Ort. {money(x.avg)}/kg</strong>
                </div>
              ))
            ) : (
              <p className="gurminik-empty">Bu dönemde alış yok.</p>
            )}
          </article>
          <article>
            <h4>Gider özeti</h4>
            {state.categories.map((c) => {
              const amount = exps
                .filter((x) => x.category === c.name)
                .reduce((s, x) => s + Number(x.amount), 0);
              return amount ? (
                <div className="gurminik-metric-row" key={c.id}>
                  <span>{c.name}</span>
                  <strong>{money(amount)}</strong>
                </div>
              ) : null;
            })}
          </article>
          <article>
            <h4>Cari hesap tahsilatları</h4>
            {accounts.length ? (
              accounts.map((x) => (
                <div className="gurminik-metric-row" key={x.id}>
                  <span>
                    {x.company} · {dateTime(x.dateTime)}
                  </span>
                  <strong>{money(x.amount)}</strong>
                </div>
              ))
            ) : (
              <p className="gurminik-empty">Bu dönemde cari hareket yok.</p>
            )}
          </article>
        </div>
      </section>
      <PriceHistory
        state={state}
        financeUnlocked={financeUnlocked}
        requestFinanceUnlock={requestFinanceUnlock}
      />
    </>
  );
}

function PriceHistory({
  state,
  financeUnlocked,
  requestFinanceUnlock,
}: {
  state: State;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
}) {
  const [productId, setProductId] = useState(""),
    [page, setPage] = useState(1);
  const selected = productId || state.products[0]?.id || "";
  const points = useMemo(
    () => buildPriceHistory(state.purchases, state.sales, selected),
    [state.purchases, state.sales, selected],
  );
  const latest = points.slice(-60),
    prices = latest
      .flatMap((point) => [point.buyPrice, point.sellPrice])
      .filter((price): price is number => price !== null);
  const low = prices.length ? Math.min(...prices) : 0,
    high = prices.length ? Math.max(...prices) : 0,
    span = high - low || 1;
  const start = latest.length ? Date.parse(latest[0].dateTime) : 0,
    end = latest.length ? Date.parse(latest[latest.length - 1].dateTime) : 0;
  function line(kind: "buyPrice" | "sellPrice") {
    return latest
      .map((point) =>
        point[kind] === null
          ? null
          : `${40 + ((Date.parse(point.dateTime) - start) * 720) / (end - start || 1)},${178 - ((point[kind] - low) * 140) / span}`,
      )
      .filter(Boolean)
      .join(" ");
  }
  return (
    <section className="gurminik-panel gurminik-price-history">
      <div className="gurminik-price-heading">
        <div className="gurminik-block-heading">
          <p>FİYAT TAKİBİ</p>
          <h3>Ürün Fiyat Geçmişi</h3>
        </div>
        <label>
          Ürün
          <select
            value={selected}
            onChange={(e) => {
              setProductId(e.target.value);
              setPage(1);
            }}
          >
            {state.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="gurminik-price-note">
        Aktif işlemlerde fiyat değiştiğinde yeni nokta oluşur. Miktarlar, o ana
        kadarki toplamları gösterir.
      </p>
      {!financeUnlocked ? (
        <div className="gurminik-price-locked">
          <LockKeyhole />
          <span>
            Alış ve satış fiyatlarını görmek için finans şifrenizi girin.
          </span>
          <Button onClick={requestFinanceUnlock}>Şifreyle göster</Button>
        </div>
      ) : (
        <>
          {points.length ? (
            <>
              <div className="gurminik-price-chart">
                <div className="gurminik-price-legend">
                  <span>● Alış fiyatı</span>
                  <span>● Satış fiyatı</span>
                </div>
                <svg
                  viewBox="0 0 800 210"
                  role="img"
                  aria-label="Alış ve satış fiyatı geçmişi"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <line x1="40" y1="178" x2="760" y2="178" stroke="#c7c5c0" />
                  <line x1="40" y1="38" x2="760" y2="38" stroke="#e7e5e1" />
                  <text x="40" y="27" fontSize="13" fill="#60605d">
                    {money(high)}/kg
                  </text>
                  <text x="40" y="200" fontSize="13" fill="#60605d">
                    {money(low)}/kg
                  </text>
                  <polyline
                    points={line("buyPrice")}
                    fill="none"
                    stroke="#b96330"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={line("sellPrice")}
                    fill="none"
                    stroke="#257a5b"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                </svg>
                <small>Grafik en son 60 fiyat değişimini gösterir.</small>
              </div>
              <div className="gurminik-table-panel">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tarih ve saat</TableHead>
                      <TableHead>Alış fiyatı</TableHead>
                      <TableHead>Satış fiyatı</TableHead>
                      <TableHead>O ana kadar alış</TableHead>
                      <TableHead>O ana kadar satış</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {points
                      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                      .map((point, index) => (
                        <TableRow key={`${point.dateTime}-${index}`}>
                          <TableCell>{dateTime(point.dateTime)}</TableCell>
                          <TableCell>
                            {point.buyPrice === null
                              ? "—"
                              : `${money(point.buyPrice)}/kg`}
                          </TableCell>
                          <TableCell>
                            {point.sellPrice === null
                              ? "—"
                              : `${money(point.sellPrice)}/kg`}
                          </TableCell>
                          <TableCell>{kg(point.purchaseKg)}</TableCell>
                          <TableCell>{kg(point.saleKg)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <Pager page={page} setPage={setPage} total={points.length} />
              </div>
            </>
          ) : (
            <p className="gurminik-empty">
              Bu ürün için fiyat geçmişi bulunamadı.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Backup({
  createBackup,
  importBackup,
  financeUnlocked,
  requestFinanceUnlock,
  permission,
}: {
  createBackup: () => Promise<BackupPayload>;
  importBackup: (
    payload: BackupPayload,
    mode: RestoreMode,
  ) => Promise<RestoreReport>;
  financeUnlocked: boolean;
  requestFinanceUnlock: () => void;
  permission: Permission;
}) {
  const [preview, setPreview] = useState<{
      name: string;
      payload: BackupPayload;
      summary: ReturnType<typeof backupSummary>;
    } | null>(null),
    [mode, setMode] = useState<RestoreMode>("merge"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function exportBackup() {
    if (!financeUnlocked) {
      requestFinanceUnlock();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const payload = await createBackup();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = `gurminik-json-yedek-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Eksiksiz JSON yedeği oluşturuldu.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Yedek oluşturulamadı.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function chooseFile(file: File) {
    setMessage("");
    try {
      const payload = normalizeBackupPayload(JSON.parse(await file.text()));
      setPreview({ name: file.name, payload, summary: backupSummary(payload) });
      setMode("merge");
    } catch (error) {
      setPreview(null);
      setMessage(
        error instanceof Error ? error.message : "Geçersiz JSON yedeği.",
      );
    }
  }
  async function restore() {
    if (!preview) return;
    if (
      mode === "replace" &&
      !window.confirm(
        "TAM GERİ YÜKLEME mevcut hesabınıza ait işletme kayıtlarını silip yedekteki kayıtlarla değiştirebilir. Bu işlem açıkça onaylanmadan başlamaz. Devam edilsin mi?",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const report = await importBackup(preview.payload, mode);
      setMessage(
        `Geri yükleme başarıyla tamamlandı.\n${formatRestoreReport(report)}`,
      );
      setPreview(null);
    } catch (error) {
      setMessage(
        `Geri yükleme tamamlanmadı; hiçbir bölüm tamamlanmış sayılmadı.\n${
          error instanceof Error ? error.message : "Bilinmeyen hata"
        }`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="gurminik-backup-notice gurminik-panel">
        <Cloud />
        <div>
          <strong>Bulut kayıtlarına ek güvence</strong>
          <p>
            Bulut alanı dolmadan düzenli olarak JSON yedeği indirin. Bu dosya
            alışları, satışları, ürünleri, giderleri, cari hesap hareketlerini,
            favorileri, rehber kategorilerini ve telefon numaralarını birlikte
            saklar.
          </p>
        </div>
      </div>
      <div className="gurminik-backup-grid">
        <article className="gurminik-backup-card gurminik-panel">
          <div className="gurminik-backup-icon">
            <Download />
          </div>
          <h3>JSON Yedek İndir</h3>
          <p>
            Uygulamadaki bütün bilgilerin güncel bir kopyasını bilgisayarınıza
            kaydedin.
          </p>
          <Button onClick={exportBackup} disabled={busy}>
            {busy ? <RefreshCw className="animate-spin" /> : <Download />}
            {busy ? "Hazırlanıyor…" : "JSON yedeği indir"}
          </Button>
        </article>
        {permission.can_create && (
          <article className="gurminik-backup-card gurminik-panel">
            <div className="gurminik-backup-icon">
              <Upload />
            </div>
            <h3>JSON Yedek Yükle</h3>
            <p>
              Daha önce indirdiğiniz GURMİNİK JSON yedeğini seçerek bilgileri
              buluta geri aktarın.
            </p>
            <label className="gurminik-upload-button">
              <Upload className="size-4" />
              JSON dosyası seç
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await chooseFile(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {preview && (
              <div className="gurminik-backup-preview">
                <strong>Yedek önizlemesi</strong>
                <span>{preview.name}</span>
                <small>
                  Sürüm {preview.payload.backupVersion} · Oluşturulma: {" "}
                  {preview.payload.createdAt
                    ? dateTime(preview.payload.createdAt)
                    : "Eski yedek"}
                </small>
                <div className="gurminik-backup-summary">
                  <span>{preview.summary.products} ürün</span>
                  <span>{preview.summary.purchases} alış</span>
                  <span>{preview.summary.sales} satış</span>
                  <span>{preview.summary.expenses} gider</span>
                  <span>{preview.summary.accountPayments} cari hareket</span>
                  <span>{preview.summary.contacts} kişi</span>
                  <span>{preview.summary.favorites} favori</span>
                  <span>{preview.summary.shipments} sevkiyat</span>
                  <span>{preview.summary.coldPurchases} Soğuk Hava alış</span>
                  <span>{preview.summary.coldSales} Soğuk Hava satış</span>
                  <span>{preview.summary.coldExpenses} Soğuk Hava gider</span>
                  <span>{preview.summary.coldFire} Fire kaydı</span>
                </div>
                <div className="gurminik-restore-modes">
                  <label>
                    <input
                      type="radio"
                      name="restoreMode"
                      checked={mode === "merge"}
                      onChange={() => setMode("merge")}
                    />
                    <span>
                      <b>Mevcut verilerle birleştir</b>
                      <small>Güvenli varsayılan; mevcut kayıtları silmez.</small>
                    </span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="restoreMode"
                      checked={mode === "replace"}
                      onChange={() => setMode("replace")}
                    />
                    <span>
                      <b>Yedeği tam geri yükle</b>
                      <small>Mevcut verileri değiştirebilir; ayrıca onay ister.</small>
                    </span>
                  </label>
                </div>
                <Button onClick={restore} disabled={busy}>
                  {busy ? <RefreshCw className="animate-spin" /> : <Upload />}
                  {busy ? "Geri yükleniyor…" : "Onayla ve geri yükle"}
                </Button>
              </div>
            )}
          </article>
        )}
      </div>
      {message && (
        <div className="gurminik-import-result gurminik-backup-result" role="status">
          {message}
        </div>
      )}
    </>
  );
}
function getRange(
  period: "daily" | "weekly" | "monthly" | "range" | "full",
  date: string,
  a: string,
  b: string,
) {
  const parse = (v: string) => {
      const [y, m, d] = v.split("-").map(Number);
      return new Date(y, m - 1, d);
    },
    base = parse(date);
  let start = base,
    end = new Date(base),
    label = "";
  if (period === "weekly") {
    start = new Date(base);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  } else if (period === "monthly") {
    start = new Date(base.getFullYear(), base.getMonth(), 1);
    end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  } else if (period === "range") {
    start = parse(a);
    end = parse(b);
    if (end < start) [start, end] = [end, start];
    end.setDate(end.getDate() + 1);
  } else if (period === "full") {
    start = new Date(0);
    end = new Date(8640000000000000);
    label = "Tüm zamanlar";
  } else end.setDate(end.getDate() + 1);
  if (!label)
    label =
      period === "monthly"
        ? start.toLocaleDateString("tr-TR", { month: "long", year: "numeric" })
        : start.toLocaleDateString("tr-TR") +
          " - " +
          new Date(end.getTime() - 1).toLocaleDateString("tr-TR");
  return { start, end, label };
}

function EntryDialog({
  type,
  close,
  state,
  productId,
  productName,
  mutate,
  selectedPurchase,
  selectedSale,
  accountEmail,
  userId,
  financeUnlocked,
  unlockFinance,
}: {
  type: DialogType;
  close: () => void;
  state: State;
  productId: string;
  productName: (id: string) => string;
  mutate: (a: string, d: Record<string, unknown>) => Promise<void>;
  selectedPurchase: Purchase | null;
  selectedSale: Sale | null;
  accountEmail: string;
  userId: string;
  financeUnlocked: boolean;
  unlockFinance: (password: string) => Promise<boolean>;
}) {
  const [dialogError, setDialogError] = useState(""),
    [detailUnlocking, setDetailUnlocking] = useState(false),
    [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSaving(true);
    setDialogError("");
    const fd = new FormData(e.currentTarget),
      data = Object.fromEntries(fd.entries()) as Record<string, unknown>;
    data.id =
      action === "editPurchase"
        ? selectedPurchase?.id
        : action === "editSale"
          ? selectedSale?.id
          : crypto.randomUUID();
    if ((action === "addPurchase" || action === "addSale") && !data.productId)
      data.productId = productId;
    try {
      await mutate(action, data);
      close();
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "Kayıt yapılamadı.",
      );
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  }
  async function verifyFinance(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDialogError("");
    const ok = await unlockFinance(
      String(new FormData(e.currentTarget).get("password") || ""),
    );
    if (ok) close();
    else setDialogError("Şifre hatalı. Finansal bilgiler açılmadı.");
  }
  async function verifyDetailFinance(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDialogError("");
    const ok = await unlockFinance(
      String(new FormData(e.currentTarget).get("password") || ""),
    );
    if (ok) setDetailUnlocking(false);
    else setDialogError("Şifre hatalı. Ortalama satış fiyatı açılmadı.");
  }
  async function archiveProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDialogError("");
    const password = String(
      new FormData(e.currentTarget).get("password") || "",
    );
    const { error } = await supabase.auth.signInWithPassword({
      email: accountEmail,
      password,
    });
    if (error) {
      setDialogError("Şifre hatalı. Ürün silinmedi.");
      return;
    }
    try {
      await mutate("archiveProduct", { id: productId });
      close();
    } catch {
      setDialogError("Ürün silinemedi. Lütfen tekrar deneyin.");
    }
  }
  const live = state.purchases.filter(
      (x) => x.productId === productId && x.status !== "cancelled",
    ),
    productSales = state.sales.filter(
      (x) => x.productId === productId && x.status !== "cancelled",
    ),
    sumKg = live.reduce((s, x) => s + Number(x.kg), 0),
    sumCost = live.reduce((s, x) => s + Number(x.kg) * Number(x.buyPrice), 0),
    soldKg = productSales.reduce((s, x) => s + Number(x.kg), 0),
    soldAmount = productSales.reduce(
      (s, x) => s + Number(x.kg) * Number(x.sellPrice),
      0,
    ),
    averageBuy = sumKg ? sumCost / sumKg : 0,
    averageSale = soldKg ? soldAmount / soldKg : 0,
    allSoldKg = state.sales.filter((x)=>x.status!=="cancelled").reduce((s,x)=>s+Number(x.kg),0),
    expenseShare = allSoldKg ? soldKg / allSoldKg : 0,
    allocatedExpenseRows = state.expenses.map((x)=>({...x,allocated:Number(x.amount)*expenseShare})),
    allocatedExpenses = allocatedExpenseRows.reduce((s,x)=>s+x.allocated,0),
    costOfSold = averageBuy * soldKg,
    grossProfit = soldAmount - costOfSold,
    netProfit = grossProfit - allocatedExpenses;
  return (
    <Dialog
      open={!!type}
      onOpenChange={(o) => {
        if (!o) {
          setDialogError("");
          close();
        }
      }}
    >
      <DialogContent
        className={
          type === "detail"
            ? "gurminik-dialog max-h-[90vh] overflow-auto sm:max-w-5xl"
            : ["purchase", "editPurchase", "sale", "editSale"].includes(
                  type || "",
                )
              ? "gurminik-dialog gurminik-purchase-dialog sm:max-w-lg"
              : "gurminik-dialog sm:max-w-xl"
        }
      >
        <DialogHeader>
          <DialogTitle>
            {type === "purchase"
              ? productName(productId) + " alış kaydı"
              : type === "editPurchase"
                ? "Alış kaydını düzenle"
                : type === "sale"
                  ? productName(productId) + " satış kaydı"
                  : type === "editSale"
                    ? "Satış kaydını düzenle"
                    : type === "unlockFinance"
                      ? "Finansal bilgileri aç"
                      : type === "product"
                        ? "Yeni ürün"
                        : type === "deleteProduct"
                          ? productName(productId) + " ürününü sil"
                          : type === "detail"
                            ? productName(productId) + " detayları"
                            : type === "expense"
                              ? "Yeni gider"
                              : type === "category"
                                ? "Yeni gider kategorisi"
                                : "Yeni telefon numarası"}
          </DialogTitle>
          <DialogDescription>
            {type === "deleteProduct"
              ? "Bu işlem ürünü ana sayfadan kaldırır. Eski alış ve satış geçmişi korunur."
              : type === "unlockFinance"
                ? "Satış tutarı ve tahmini kârı görmek için giriş şifrenizi yeniden yazın."
                : "Bilgiler kaydedildiği anda bulut veritabanına aktarılır."}
          </DialogDescription>
        </DialogHeader>
        {type === "purchase" && (
          <PurchaseEntryForm
            state={state}
            productId={productId}
            submit={submit}
            saving={saving}
          />
        )}
        {type === "editPurchase" && selectedPurchase && (
          <form
            key={selectedPurchase.id}
            onSubmit={(e) => submit(e, "editPurchase")}
            className="grid gap-4"
          >
            <label className="grid gap-2 text-sm font-bold">
              Ürün
              <select
                name="productId"
                defaultValue={selectedPurchase.productId}
                className="h-10 rounded-md border bg-white px-3"
              >
                {state.products
                  .filter(
                    (p) =>
                      p.isActive !== false ||
                      p.id === selectedPurchase.productId,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <Field
              name="person"
              label="Getiren kişinin adı"
              defaultValue={selectedPurchase.person}
            />
            <Field
              name="plate"
              label="Araç plakası"
              defaultValue={selectedPurchase.plate}
            />
            <Field
              name="kg"
              label="Miktar (kg)"
              type="number"
              defaultValue={String(selectedPurchase.kg)}
            />
            <Field
              name="buyPrice"
              label="Alış fiyatı (TL/kg)"
              type="number"
              defaultValue={String(selectedPurchase.buyPrice)}
            />
            <Field
              name="dateTime"
              label="Tarih ve saat"
              type="datetime-local"
              defaultValue={localInput(selectedPurchase.dateTime)}
            />
            <PaymentStatusField
              defaultPaid={selectedPurchase.isPaid !== false}
            />
            <Button disabled={saving}>
              <Pencil />
              {saving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
            </Button>
          </form>
        )}
        {type === "sale" && (
          <SaleEntryForm
            state={state}
            productId={productId}
            userId={userId}
            submit={submit}
            saving={saving}
          />
        )}
        {type === "editSale" && selectedSale && (
          <form onSubmit={(e) => submit(e, "editSale")} className="grid gap-4">
            <label className="grid gap-2 text-sm font-bold">
              Ürün
              <select
                name="productId"
                defaultValue={selectedSale.productId}
                className="h-11 rounded-md border bg-white px-3"
              >
                {state.products
                  .filter(
                    (p) =>
                      p.isActive !== false || p.id === selectedSale.productId,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <Field
              name="buyer"
              label="Fabrika / Müşteri adı"
              defaultValue={selectedSale.buyer}
            />
            <Field
              name="driver"
              label="Kamyoncu / Şoför adı"
              defaultValue={selectedSale.driver || ""}
              required={false}
            />
            <Field
              name="plate"
              label="Kamyon plakası"
              defaultValue={selectedSale.plate || ""}
              required={false}
            />
            <Field
              name="kg"
              label="Satış miktarı (kg)"
              type="number"
              defaultValue={String(selectedSale.kg)}
            />
            <Field
              name="sellPrice"
              label="Satış fiyatı (TL/kg)"
              type="number"
              defaultValue={String(selectedSale.sellPrice)}
            />
            <Field
              name="dateTime"
              label="Tarih ve saat"
              type="datetime-local"
              defaultValue={localInput(selectedSale.dateTime)}
            />
            <Button disabled={saving}>
              <Pencil />
              {saving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
            </Button>
          </form>
        )}
        {dialogError && (
          <p role="alert" className="text-sm font-bold text-red-600">
            {dialogError}
          </p>
        )}
        {type === "unlockFinance" && (
          <form onSubmit={verifyFinance} className="grid gap-4">
            <div className="gurminik-privacy-note">
              <LockKeyhole />
              <span>
                Doğrulama yalnızca bu açık sayfa için geçerlidir. Sayfa
                yenilenince finansal tutarlar tekrar gizlenir.
              </span>
            </div>
            <Field name="password" label="Uygulama şifresi" type="password" />
            {dialogError && (
              <p className="text-sm font-bold text-red-600">{dialogError}</p>
            )}
            <Button>
              <Eye />
              Şifreyi doğrula ve göster
            </Button>
          </form>
        )}
        {type === "product" && (
          <Form action="addProduct" submit={submit}>
            <Field name="name" label="Ürün adı" />
            <Field name="icon" label="Simge" placeholder="Örn. 🍎" />
          </Form>
        )}
        {type === "deleteProduct" && (
          <form onSubmit={archiveProduct} className="grid gap-4">
            <div className="gurminik-delete-warning">
              <Trash2 />
              <span>
                <strong>Ürünü kaldırmak üzeresiniz</strong>Devam etmek için
                uygulamaya giriş yaptığınız şifreyi yazın.
              </span>
            </div>
            <Field name="password" label="Uygulama şifresi" type="password" />
            {dialogError && (
              <p className="text-sm font-bold text-red-600">{dialogError}</p>
            )}
            <Button variant="destructive">
              <Trash2 />
              Şifreyi doğrula ve ürünü sil
            </Button>
          </form>
        )}
        {type === "expense" && (
          <form
            onSubmit={(e) => submit(e, "addExpense")}
            className="grid gap-4"
          >
            <Field name="title" label="Açıklama" />
            <Field name="amount" label="Tutar (TL)" type="number" />
            <label className="grid gap-2 text-sm font-bold">
              Kategori
              <Select name="category" defaultValue={state.categories[0]?.name}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Kategori seçin" />
                </SelectTrigger>
                <SelectContent>
                  {state.categories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Field
              name="dateTime"
              label="Tarih ve saat"
              type="datetime-local"
              defaultValue={localNow()}
            />
            <Button>Buluta kaydet</Button>
          </form>
        )}
        {type === "category" && (
          <Form action="addCategory" submit={submit}>
            <Field name="name" label="Kategori adı" />
          </Form>
        )}
        {type === "contact" && (
          <Form action="addContact" submit={submit}>
            <Field name="name" label="İsim" />
            <Field name="phone" label="Telefon numarası" type="tel" />
            <Field
              name="note"
              label="Not"
              required={false}
              placeholder="Örn. Limon tedarikçisi"
            />
          </Form>
        )}
        {type === "detail" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Toplam alış kg" value={kg(sumKg)} />
              <Stat label="Toplam satış kg" value={kg(soldKg)} />
              <ProtectedStat label="Ortalama alış fiyatı" value={money(averageBuy)+"/kg"} unlocked={financeUnlocked} onUnlock={() => setDetailUnlocking(true)} />
              <ProtectedStat
                label="Ortalama satış fiyatı"
                value={money(averageSale) + "/kg"}
                unlocked={financeUnlocked}
                onUnlock={() => setDetailUnlocking(true)}
              />
              <ProtectedStat label="Ürüne düşen gider" value={money(allocatedExpenses)} unlocked={financeUnlocked} onUnlock={()=>setDetailUnlocking(true)} />
              <ProtectedStat label="Kg başına gider" value={money(soldKg?allocatedExpenses/soldKg:0)+"/kg"} unlocked={financeUnlocked} onUnlock={()=>setDetailUnlocking(true)} />
              <ProtectedStat label="Brüt kâr" value={money(grossProfit)} unlocked={financeUnlocked} onUnlock={()=>setDetailUnlocking(true)} />
              <ProtectedStat label="Kg başına brüt kâr" value={money(soldKg?grossProfit/soldKg:0)+"/kg"} unlocked={financeUnlocked} onUnlock={()=>setDetailUnlocking(true)} />
              <ProtectedStat label="Giderler sonrası net kâr" value={money(netProfit)} unlocked={financeUnlocked} onUnlock={()=>setDetailUnlocking(true)} />
              <ProtectedStat label="Kg başına net kâr" value={money(soldKg?netProfit/soldKg:0)+"/kg"} unlocked={financeUnlocked} onUnlock={()=>setDetailUnlocking(true)} />
            </div>
            {detailUnlocking && !financeUnlocked && (
              <form
                onSubmit={verifyDetailFinance}
                className="gurminik-detail-unlock"
              >
                <div>
                  <LockKeyhole />
                  <span>
                    Ortalama satış fiyatını görmek için uygulama şifrenizi
                    yazın.
                  </span>
                </div>
                <Input
                  name="password"
                  type="password"
                  placeholder="Uygulama şifresi"
                  required
                  autoFocus
                />
                <Button type="submit">
                  <Eye />
                  Göster
                </Button>
                {dialogError && <p>{dialogError}</p>}
              </form>
            )}
            <div className="gurminik-panel gurminik-cost-allocation">
              <h3>Gider dağılımı</h3>
              <p>Genel işletme giderleri, her ürünün toplam satılan KG içindeki payına göre dağıtılır. Bu ürünün payı %{new Intl.NumberFormat("tr-TR",{maximumFractionDigits:1}).format(expenseShare*100)}.</p>
              {financeUnlocked && allocatedExpenseRows.length ? <div className="overflow-auto"><table><thead><tr><th>Gider</th><th>Kategori</th><th>Toplam</th><th>Bu ürüne düşen</th></tr></thead><tbody>{allocatedExpenseRows.map((x)=><tr key={x.id}><td>{x.title}</td><td>{x.category}</td><td>{money(x.amount)}</td><td>{money(x.allocated)}</td></tr>)}</tbody></table></div> : !allocatedExpenseRows.length ? <p>Dağıtılacak gider kaydı yok.</p> : null}
            </div>
            <div className="overflow-hidden rounded-xl border">
              <PurchaseTable
                rows={state.purchases.filter((x) => x.productId === productId)}
                productName={productName}
                mutate={mutate}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
function PurchaseEntryForm({
  state,
  productId,
  submit,
  saving,
}: {
  state: State;
  productId: string;
  submit: (e: FormEvent<HTMLFormElement>, a: string) => void;
  saving: boolean;
}) {
  const firstLast =
    state.purchases.find(
      (x) => x.productId === productId && x.status !== "cancelled",
    ) || state.purchases.find((x) => x.status !== "cancelled");
  const [selectedProduct, setSelectedProduct] = useState(productId),
    [person, setPerson] = useState(firstLast?.person || ""),
    [plate, setPlate] = useState(firstLast?.plate || ""),
    [amount, setAmount] = useState(""),
    [price, setPrice] = useState(firstLast ? String(firstLast.buyPrice) : ""),
    [when, setWhen] = useState(localNow());
  function lastPrice(id: string) {
    return state.purchases.find(
      (x) => x.productId === id && x.status !== "cancelled",
    )?.buyPrice;
  }
  function productChanged(id: string) {
    setSelectedProduct(id);
    const remembered = lastPrice(id);
    setPrice(remembered === undefined ? "" : String(remembered));
  }
  function personChanged(value: string) {
    setPerson(value);
    const match = state.purchases.find(
      (x) => norm(x.person) === norm(value) && x.plate,
    );
    if (match) setPlate(match.plate);
  }
  function plateChanged(value: string) {
    const upper = value.toLocaleUpperCase("tr-TR");
    setPlate(upper);
    const match = state.purchases.find((x) => norm(x.plate) === norm(upper));
    if (match) setPerson(match.person);
  }
  return (
    <form onSubmit={(e) => submit(e, "addPurchase")} className="grid gap-4">
      <label className="grid gap-2 text-sm font-bold">
        Ürün
        <select
          name="productId"
          value={selectedProduct}
          onChange={(e) => productChanged(e.target.value)}
          className="h-11 rounded-md border bg-white px-3"
          required
        >
          {state.products
            .filter((p) => p.isActive !== false)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-bold">
        Getiren kişinin adı
        <Input
          name="person"
          value={person}
          onChange={(e) => personChanged(e.target.value)}
          required
          autoComplete="off"
        />
      </label>
      <label className="grid gap-2 text-sm font-bold">
        Araç plakası
        <Input
          name="plate"
          value={plate}
          onChange={(e) => plateChanged(e.target.value)}
          required
          autoComplete="off"
        />
      </label>
      <label className="grid gap-2 text-sm font-bold">
        Miktar (kg)
        <MobileNumberInput
          name="kg"
          step="0.01"
          className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none md:text-sm"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold">
        Alış fiyatı (TL/kg)
        <MobileNumberInput
          name="buyPrice"
          step="0.01"
          className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none md:text-sm"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold">
        Tarih ve saat
        <Input
          name="dateTime"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          required
        />
      </label>
      <PaymentStatusField />
      <p className="gurminik-form-hint">
        Seçtiğiniz üründeki son alış fiyatı otomatik gelir; gerektiğinde
        değiştirebilirsiniz.
      </p>
      <Button disabled={saving}>
        {saving ? "Kaydediliyor…" : "Buluta kaydet"}
      </Button>
    </form>
  );
}
function SaleEntryForm({
  state,
  productId,
  userId,
  submit,
  saving,
}: {
  state: State;
  productId: string;
  userId: string;
  submit: (e: FormEvent<HTMLFormElement>, a: string) => void;
  saving: boolean;
}) {
  const lastOwn = state.sales.find(
    (row) => row.status !== "cancelled" && row.createdBy === userId,
  );
  const legacy = state.sales.find(
    (row) => row.status !== "cancelled" && !row.createdBy,
  );
  const initialBuyer = lastOwn?.buyer || legacy?.buyer || "";
  const [selectedProduct, setSelectedProduct] = useState(productId),
    [buyer, setBuyer] = useState(initialBuyer),
    [driver, setDriver] = useState(""),
    [plate, setPlate] = useState(""),
    [price, setPrice] = useState(
      String(latestSalePrice(state.sales, productId, initialBuyer) ?? ""),
    );
  const matches = useMemo(
    () => driverMatches(state.sales, driver),
    [state.sales, driver],
  );
  function changeBuyer(value: string) {
    setBuyer(value);
    setPrice(
      String(latestSalePrice(state.sales, selectedProduct, value) ?? ""),
    );
  }
  function changeProduct(id: string) {
    setSelectedProduct(id);
    setPrice(String(latestSalePrice(state.sales, id, buyer) ?? ""));
  }
  function changeDriver(value: string) {
    setDriver(value);
    const match = driverMatches(state.sales, value).find(
      (row) => norm(row.name) === norm(value),
    );
    if (match) setPlate(match.plate);
  }
  return (
    <form onSubmit={(e) => submit(e, "addSale")} className="grid gap-3">
      <label className="grid gap-2 text-sm font-bold">
        Ürün
        <select
          name="productId"
          value={selectedProduct}
          onChange={(e) => changeProduct(e.target.value)}
          className="h-11 rounded-md border bg-white px-3"
          required
        >
          {state.products
            .filter((p) => p.isActive !== false)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-bold">
        Fabrika / Müşteri adı
        <Input
          name="buyer"
          value={buyer}
          onChange={(e) => changeBuyer(e.target.value)}
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold">
        Kamyoncu / Şoför adı
        <Input
          name="driver"
          value={driver}
          onChange={(e) => changeDriver(e.target.value)}
          list="gurminik-driver-options"
          autoComplete="off"
          required
        />
        <datalist id="gurminik-driver-options">
          {matches.map((row) => (
            <option key={row.name} value={row.name}>
              {row.plate}
            </option>
          ))}
        </datalist>
      </label>
      <label className="grid gap-2 text-sm font-bold">
        Kamyon plakası
        <Input
          name="plate"
          value={plate}
          onChange={(e) => setPlate(e.target.value.toLocaleUpperCase("tr-TR"))}
          required
        />
      </label>
      <Field name="kg" label="Satış miktarı (kg)" type="number" />
      <label className="grid gap-2 text-sm font-bold">
        Satış fiyatı (TL/kg)
        <MobileNumberInput
          name="sellPrice"
          step="0.01"
          min="0"
          className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none md:text-sm"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </label>
      <Field
        name="dateTime"
        label="Tarih ve saat"
        type="datetime-local"
        defaultValue={localNow()}
      />
      <p className="gurminik-form-hint">
        Son fabrika ve bu fabrika ile üründe kullanılan son fiyat hazır gelir.
        Kamyoncuyu seçince son plakası dolar.
      </p>
      <Button disabled={saving}>
        {saving ? "Kaydediliyor…" : "Buluta kaydet"}
      </Button>
    </form>
  );
}
function Form({
  action,
  submit,
  children,
}: {
  action: string;
  submit: (e: FormEvent<HTMLFormElement>, a: string) => void;
  children: ReactNode;
}) {
  return (
    <form onSubmit={(e) => submit(e, action)} className="grid gap-4">
      {children}
      <Button>Buluta kaydet</Button>
    </form>
  );
}
function Field({
  name,
  label,
  type = "text",
  defaultValue,
  required = true,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold">
      {label}
      {type === "number" ? (
        <MobileNumberInput name={name} defaultValue={defaultValue} required={required} placeholder={placeholder} step="0.01" className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none md:text-sm" />
      ) : (
        <Input name={name} type={type} defaultValue={defaultValue} required={required} placeholder={placeholder} />
      )}
    </label>
  );
}

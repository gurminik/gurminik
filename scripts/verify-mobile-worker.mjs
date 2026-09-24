import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");
const activity = readFileSync("components/activity-logs.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260923181438_mobile_worker_mode.sql",
  "utf8",
);
const worker = readFileSync("public/sw.js", "utf8");

for (const token of [
  "effective_mobile_mode",
  "gurminik-worker-shell",
  "gurminik-worker-grid",
  'label: "Alış Gir"',
  'label: "Satış Gir"',
  'label: "Favoriler"',
  'label: "Gider Gir"',
  'label: "Telefon Numaraları"',
  'label: "Sıralamalar"',
  'label: "İşlem Geçmişi"',
  "MOBILE_STATE_CACHE_KEY",
  "fetchMobileState",
  "compactMobile",
  "onSaved?.(action)",
  "admin_set_gurminik_user_access_v2",
  '"get_mobile_ranking_rows"',
  "onFavoriteChanged",
  "INTERFACE_MODE_KEY",
  'type InterfaceMode = "normal" | "mobile"',
  'interfaceMode === "mobile"',
  'changeInterfaceMode("mobile")',
  'changeInterfaceMode("normal")',
  "Mobil Sürüme Geç",
  "Mobil Sürümden Çık",
  "if (!access.effective_mobile_mode)",
]) assert.ok(page.includes(token), `Eksik mobil uygulama işareti: ${token}`);

for (const token of [
  ".gurminik-worker-grid",
  "grid-template-columns:repeat(3",
  ".gurminik-worker-grid>button.is-logout",
  ".gurminik-worker-grid>button.is-interface-exit",
  ".gurminik-mobile-ranking",
  "grid-template-columns:repeat(3,minmax(0,1fr));gap:6px",
]) assert.ok(styles.includes(token), `Eksik mobil stil: ${token}`);

assert.ok(activity.includes("compact = false"), "İşlem geçmişi sade görünümü eksik");
assert.ok(activity.includes('compact ? "KENDİ İŞLEMLERİM"'), "Kendi işlem başlığı eksik");

for (const token of [
  "mobile_mode boolean not null default false",
  "full_access boolean not null default false",
  "activity_scope_all boolean not null default false",
  "private.is_gurminik_mobile_worker()",
  "owner_id = (select auth.uid())",
  "actor_user_id = (select auth.uid())",
  "not p.full_access",
  "p.role <> 'admin'",
  "jsonb_build_object('source','mobile_worker')",
]) assert.ok(migration.includes(token), `Eksik RLS/migration işareti: ${token}`);

const rankingMigration = readFileSync(
  "supabase/migrations/20260923192737_mobile_worker_ranking.sql",
  "utf8",
);
for (const token of [
  "get_mobile_ranking_rows",
  "private.has_gurminik_permission('ranking', 'view')",
  "quantity_kg numeric",
  "revoke all on function public.get_mobile_ranking_rows() from public, anon",
]) assert.ok(rankingMigration.includes(token), `Eksik mobil sıralama güvenliği: ${token}`);

assert.ok(worker.includes("gurminik-shell-v16"), "Service worker önbelleği güncellenmedi");
console.log("Sade mobil çalışan modu statik doğrulamaları başarılı.");

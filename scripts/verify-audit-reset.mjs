import fs from "node:fs";
import assert from "node:assert/strict";

const page = fs.readFileSync("app/page.tsx", "utf8");
const activity = fs.readFileSync("components/activity-logs.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260923120000_activity_log_and_safe_reset.sql", "utf8");
const sw = fs.readFileSync("public/sw.js", "utf8");

assert.match(page, /activity_logs: "İşlem Geçmişi"/);
assert.match(page, /reset_gurminik_application/);
assert.match(page, /TÜM VERİLERİ SİL/);
assert.match(page, /item\.epoch === currentEpoch/);
assert.match(activity, /PAGE_SIZE = 15/);
assert.match(activity, /PDF Olarak İndir/);
assert.match(migration, /create table if not exists public\.activity_logs/);
assert.match(migration, /enable row level security/);
assert.match(migration, /private\.gurminik_audit_row/);
assert.match(migration, /create or replace function public\.reset_gurminik_application/);
assert.match(migration, /private\.require_gurminik_admin_verification/);
assert.match(migration, /extensions\.crypt\(input_password, stored_hash\)/);
assert.doesNotMatch(page, /input_password:\s*["'][^"']+["']/);
assert.doesNotMatch(migration, /password_hash[^;]+crypt\s*\(\s*["'][^"']+["']/s);
assert.match(sw, /gurminik-shell-v17/);
console.log("Audit log, RLS, server-side reset, offline epoch and UI safety checks passed.");

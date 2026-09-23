import fs from "node:fs";
import assert from "node:assert/strict";
import {
  cancellationDeadline,
  cancellationExpired,
  cancellationNotice,
  isPermanentCancellationError,
} from "../lib/cancellation.ts";

const migration = fs.readFileSync(
  "supabase/migrations/20260923175123_cancelled_record_retention.sql",
  "utf8",
);
const page = fs.readFileSync("app/page.tsx", "utf8");
const cold = fs.readFileSync("components/cold-storage.tsx", "utf8");

const started = "2026-09-23T14:00:00.000Z";
assert.equal(cancellationDeadline(started)?.toISOString(), "2026-09-30T14:00:00.000Z");
assert.equal(cancellationExpired(started, Date.parse("2026-09-30T13:59:59.999Z")), false);
assert.equal(cancellationExpired(started, Date.parse("2026-09-30T14:00:00.000Z")), true);
assert.match(cancellationNotice(started, Date.parse("2026-09-24T14:00:00.000Z")), /6 gün kaldı/);
assert.equal(isPermanentCancellationError(new Error("GURMINIK_PURGED_RECORD")), true);
assert.equal(isPermanentCancellationError(new Error("GURMINIK_CANCELLATION_EXPIRED")), true);

for (const table of ["purchases", "sales", "cold_storage_purchases", "cold_storage_sales"]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} add column if not exists cancelled_at`));
  assert.match(migration, new RegExp(`delete from public\\.${table}`));
}
assert.match(migration, /clock_timestamp\(\) - interval '7 days'/);
assert.match(migration, /GURMINIK_CANCELLATION_EXPIRED/);
assert.match(migration, /GURMINIK_PURGED_RECORD/);
assert.match(migration, /'17 2 \* \* \*'/);
assert.match(migration, /action_type = 'auto_delete'/);
assert.match(page, /isPermanentCancellationError/);
assert.match(page, /cancellationNotice\(r\.cancelledAt\)/);
assert.match(cold, /cancellationNotice\(row\.cancelledAt\)/);
assert.match(cold, /cancellationExpired\(row\.cancelledAt\)/);

console.log("Seven-day cancellation, daily purge, offline guard and UI checks passed.");

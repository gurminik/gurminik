export const CANCELLATION_RETENTION_DAYS = 7;
export const CANCELLATION_RETENTION_MS =
  CANCELLATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function cancellationDeadline(cancelledAt?: string | null) {
  if (!cancelledAt) return null;
  const started = new Date(cancelledAt).getTime();
  if (!Number.isFinite(started)) return null;
  return new Date(started + CANCELLATION_RETENTION_MS);
}

export function cancellationExpired(
  cancelledAt?: string | null,
  now = Date.now(),
) {
  const deadline = cancellationDeadline(cancelledAt);
  return !!deadline && deadline.getTime() <= now;
}

export function cancellationNotice(cancelledAt?: string | null, now = Date.now()) {
  const deadline = cancellationDeadline(cancelledAt);
  if (!deadline) return "7 günlük geri alma süresi başladı";
  const remaining = deadline.getTime() - now;
  if (remaining <= 0) return "Geri alma süresi doldu · kalıcı silme bekleniyor";
  const days = Math.ceil(remaining / 86_400_000);
  return `${days} gün kaldı · ${deadline.toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  })} tarihinde silinecek`;
}

export function isPermanentCancellationError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message || "")
        : String(error || "");
  return /GURMINIK_(PURGED_RECORD|CANCELLATION_EXPIRED)/.test(message);
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");
const keypad = readFileSync("components/mobile-number-input.tsx", "utf8");

for (const token of [
  "MOBILE_LAST_PRODUCT_KEY",
  "mobileLastProductKey(session.user.id, type)",
  'mobileLastProductKey(userId, "purchase")',
  'mobileLastProductKey(userId, "sale")',
  "rememberedProductId",
  "onOpenAutoFocus",
  "onPointerDownOutside",
  "onFocusOutside",
  'target.closest(".gurminik-number-pad-backdrop")',
  "compactMobile",
]) assert.ok(page.includes(token), "Eksik mobil giriş koruması: " + token);

for (const token of [
  'type="button"',
  "onPointerDown",
  "onTouchStart",
  "onTouchEnd",
  "event.stopPropagation()",
  'onClick={()=>setOpen(false)}',
  'if (!current.includes("."))',
]) assert.ok(keypad.includes(token), "Eksik sayı klavyesi koruması: " + token);

assert.match(page, /Satış miktarı \(kg\)[\s\S]{0,180}<MobileNumberInput name="kg"/);
assert.match(readFileSync("app/globals.css", "utf8"), /\.gurminik-number-pad-backdrop\{[^}]*pointer-events:auto/);

assert.ok(
  !keypad.includes("ref.current?.blur()"),
  "Tamam tuşu sayısal alanı blur ederek form odağını değiştirmemeli.",
);
assert.ok(
  !/gurminik-number-pad-done[^>]*type="submit"/.test(keypad),
  "Sayı klavyesi Tamam tuşu submit olmamalı.",
);

console.log("Mobil ürün hafızası ve güvenli sayı klavyesi kontrolleri başarılı.");

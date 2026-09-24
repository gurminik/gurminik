import assert from "node:assert/strict";
import { parseVCard, decodeVCardBuffer, normalizePhone } from "../lib/vcard.ts";

const v21 = `BEGIN:VCARD\r\nVERSION:2.1\r\nN:Akdağ;Hasan;;;\r\nTEL;CELL:0532 123 45 67\r\nEND:VCARD\r\n`;
const v30 = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ayşe Yılmaz\r\nTEL;TYPE=CELL:+90 555 222 33 44\r\nEND:VCARD\r\n`;
const v40 = `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Deniz Örnek\r\nitem1.TEL;VALUE=uri;TYPE=cell:tel:+905330001122\r\nEND:VCARD\r\n`;
const repeated = `BEGIN:VCARD\nVERSION:3.0\nFN:Aynı Numara\nTEL;CELL:+905321234567\nEND:VCARD\n`;
const broken = `BEGIN:VCARD\nVERSION:3.0\nFN:Numarasız\nEND:VCARD\n`;
const input = `\uFEFF${v21}${v30}${v40}${repeated}${broken}`;
const parsed = parseVCard(decodeVCardBuffer(new TextEncoder().encode(input).buffer));
assert.equal(parsed.cards, 5);
assert.equal(parsed.contacts.length, 3);
assert.equal(parsed.duplicatesInFile, 1);
assert.equal(parsed.invalid, 1);
assert.deepEqual(parsed.contacts.map(x => x.name), ["Hasan Akdağ", "Ayşe Yılmaz", "Deniz Örnek"]);
assert.equal(normalizePhone("0532 123 45 67"), normalizePhone("+90 532 123 45 67"));
assert.equal(normalizePhone("905321234567"), parsed.contacts[0].phoneKey);

const quoted = `BEGIN:VCARD\nVERSION:2.1\nN;CHARSET=ISO-8859-9;ENCODING=QUOTED-PRINTABLE:Y=FDlmaz;Ay=FEe;;;\nTEL;CELL:05324567890\nEND:VCARD`;
assert.equal(parseVCard(quoted).contacts[0].name, "Ayşe Yılmaz");

const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from(v21, "utf16le")]);
assert.equal(parseVCard(decodeVCardBuffer(utf16.buffer)).contacts.length, 1);

const large = Array.from({ length: 150 }, (_, i) =>
  `BEGIN:VCARD\nVERSION:3.0\nFN:Kişi ${i}\nTEL;TYPE=CELL:+9053${String(i).padStart(8, "0")}\nEND:VCARD`
).join("\n");
assert.equal(parseVCard(large).contacts.length, 150);

console.log("vCard 2.1/3.0/4.0, UTF-8/UTF-16, mükerrer ve 150 kişilik rehber doğrulandı.");

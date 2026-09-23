export type ActivityPdfRow = {
  created_at: string;
  actor_name: string;
  action_type: string;
  person_name?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  description: string;
};

const actionLabel: Record<string, string> = {
  create: "Oluşturma",
  update: "Düzenleme",
  cancel: "İptal",
  restore: "Etkinleştirme",
  delete: "Silme",
  export: "Dışa aktarma",
  import: "Geri yükleme",
  permission: "Yetki değişikliği",
  system: "Sistem",
  auto_delete: "Otomatik silme",
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = String(text || "").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

const bytes = (value: string) => new TextEncoder().encode(value);
function base64Bytes(dataUrl: string) {
  const raw = atob(dataUrl.split(",")[1]);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function buildImagePdf(images: { data: Uint8Array; width: number; height: number }[]) {
  const objectCount = 2 + images.length * 3;
  const objects: Uint8Array[] = new Array(objectCount + 1);
  const pageIds: number[] = [];
  objects[1] = bytes("<< /Type /Catalog /Pages 2 0 R >>");
  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    pageIds.push(pageId);
    objects[pageId] = bytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const imageHead = bytes(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n`,
    );
    const imageTail = bytes("\nendstream");
    const merged = new Uint8Array(imageHead.length + image.data.length + imageTail.length);
    merged.set(imageHead, 0);
    merged.set(image.data, imageHead.length);
    merged.set(imageTail, imageHead.length + image.data.length);
    objects[imageId] = merged;
    const stream = "q 595 0 0 842 0 0 cm /Im0 Do Q";
    objects[contentId] = bytes(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects[2] = bytes(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);

  const parts: Uint8Array[] = [bytes("%PDF-1.4\n%âãÏÓ\n")];
  const offsets = new Array(objectCount + 1).fill(0);
  let length = parts[0].length;
  for (let id = 1; id <= objectCount; id++) {
    offsets[id] = length;
    const head = bytes(`${id} 0 obj\n`), tail = bytes("\nendobj\n");
    parts.push(head, objects[id], tail);
    length += head.length + objects[id].length + tail.length;
  }
  const xrefOffset = length;
  const xref = ["xref", `0 ${objectCount + 1}`, "0000000000 65535 f "];
  for (let id = 1; id <= objectCount; id++) xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
  const trailer = bytes(`${xref.join("\n")}\ntrailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  parts.push(trailer);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export async function downloadActivityPdf(rows: ActivityPdfRow[], periodLabel: string) {
  const pages: HTMLCanvasElement[] = [];
  const perPage = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  for (let page = 0; page < pageCount; page++) {
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF çizim alanı hazırlanamadı.");
    ctx.fillStyle = "#f5f4f1";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#151515";
    ctx.fillRect(0, 0, canvas.width, 150);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 38px Arial";
    ctx.fillText("GURMİNİK · İŞLEM GEÇMİŞİ", 60, 67);
    ctx.font = "22px Arial";
    ctx.fillStyle = "#d8b38a";
    ctx.fillText(periodLabel, 60, 111);

    const pageRows = rows.slice(page * perPage, (page + 1) * perPage);
    pageRows.forEach((row, index) => {
      const y = 190 + index * 145;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(48, y, 1144, 126);
      ctx.fillStyle = "#8a552b";
      ctx.fillRect(48, y, 8, 126);
      const date = new Date(row.created_at);
      ctx.fillStyle = "#181818";
      ctx.font = "700 21px Arial";
      ctx.fillText(date.toLocaleString("tr-TR"), 76, y + 32);
      ctx.fillText(row.actor_name || "Kullanıcı", 340, y + 32);
      ctx.fillStyle = "#8a552b";
      ctx.fillText(actionLabel[row.action_type] || row.action_type, 760, y + 32);
      ctx.fillStyle = "#565656";
      ctx.font = "19px Arial";
      const meta = [row.person_name, row.product_name, row.quantity ? `${Number(row.quantity).toLocaleString("tr-TR")} kg` : ""]
        .filter(Boolean)
        .join(" · ");
      ctx.fillText(meta || "—", 76, y + 65);
      ctx.fillStyle = "#242424";
      ctx.font = "18px Arial";
      wrap(ctx, row.description, 1060).forEach((line, i) => ctx.fillText(line, 76, y + 94 + i * 22));
    });
    ctx.fillStyle = "#6b6b6b";
    ctx.font = "17px Arial";
    ctx.fillText(`Sayfa ${page + 1} / ${pageCount}`, 1030, 1715);
    pages.push(canvas);
  }
  const images = pages.map((canvas) => ({
    data: base64Bytes(canvas.toDataURL("image/jpeg", 0.9)),
    width: canvas.width,
    height: canvas.height,
  }));
  const url = URL.createObjectURL(buildImagePdf(images));
  const link = document.createElement("a");
  link.href = url;
  link.download = `gurminik-islem-gecmisi-${new Date().toISOString().slice(0, 10)}.pdf`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

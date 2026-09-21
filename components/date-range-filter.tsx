"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type RememberedDateRange } from "@/lib/date-range";

export function DateRangeFilter({
  range,
  onChange,
  title = "Tarih aralığı",
}: {
  range: RememberedDateRange;
  onChange: (next: RememberedDateRange) => void;
  title?: string;
}) {
  return (
    <section className="gurminik-panel gurminik-date-range">
      <div>
        <p>{title.toLocaleUpperCase("tr-TR")}</p>
        <span>Seçiminiz bu hesapta ve yalnızca bu bölüm için hatırlanır.</span>
      </div>
      <div className="gurminik-range-inputs">
        <label>
          Başlangıç
          <Input
            aria-label={`${title} başlangıç`}
            type="date"
            value={range.start}
            onChange={(e) => onChange({ ...range, start: e.target.value })}
          />
        </label>
        <label>
          Bitiş
          <Input
            aria-label={`${title} bitiş`}
            type="date"
            value={range.end}
            onChange={(e) => onChange({ ...range, end: e.target.value })}
          />
        </label>
        {(range.start || range.end) && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange({ start: "", end: "" })}
          >
            Tüm zamanlar
          </Button>
        )}
      </div>
    </section>
  );
}

"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type RememberedDateRange } from "@/lib/date-range";

export function DateRangeFilter({
  range,
  onChange,
  title = "Tarih aralığı",
  showToday = false,
}: {
  range: RememberedDateRange;
  onChange: (next: RememberedDateRange) => void;
  title?: string;
  showToday?: boolean;
}) {
  const d=new Date(), today=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10), todayActive=range.start===today&&range.end===today;
  return (
    <section className="gurminik-panel gurminik-date-range">
      <div>
        <p>{title.toLocaleUpperCase("tr-TR")}</p>
        <span>Seçiminiz bu hesapta ve yalnızca bu bölüm için hatırlanır.</span>
      </div>
      <div className="gurminik-range-inputs">
        {showToday && <Button type="button" variant={todayActive?"default":"outline"} onClick={()=>onChange({start:today,end:today})}>Bugün</Button>}
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

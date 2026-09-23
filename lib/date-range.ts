import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export type RememberedDateRange = { start: string; end: string };

export function dateRangeBounds(range: RememberedDateRange) {
  const parse = (value: string) =>
    value ? new Date(`${value}T00:00:00`).getTime() : null;
  let start = parse(range.start),
    end = parse(range.end);
  if (start !== null && end !== null && end < start)
    [start, end] = [end, start];
  return {
    start: start ?? -Infinity,
    end: end === null ? Infinity : end + 86400000,
  };
}

export function inRememberedDateRange(
  value: string,
  range: RememberedDateRange,
) {
  const stamp = new Date(value).getTime(),
    bounds = dateRangeBounds(range);
  return stamp >= bounds.start && stamp < bounds.end;
}

export function useRememberedDateRange(userId: string, scope: string, defaultToToday = false) {
  const storageKey = `gurminik_date_range_v1:${userId}:${scope}`;
  const [range, setRange] = useState<RememberedDateRange>({
    start: "",
    end: "",
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        saved &&
        typeof saved.start === "string" &&
        typeof saved.end === "string"
      )
        timer = setTimeout(() => setRange(saved), 0);
      else if (defaultToToday) {
        const d=new Date(), today=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
        timer=setTimeout(()=>setRange({start:today,end:today}),0);
        localStorage.setItem(storageKey,JSON.stringify({start:today,end:today}));
      }
    } catch {}
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [storageKey,defaultToToday]);

  const rememberRange: Dispatch<SetStateAction<RememberedDateRange>> = (
    next,
  ) => {
    setRange((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      try {
        localStorage.setItem(storageKey, JSON.stringify(resolved));
      } catch {}
      return resolved;
    });
  };
  const bounds = useMemo(() => dateRangeBounds(range), [range]);
  return { range, setRange: rememberRange, bounds };
}

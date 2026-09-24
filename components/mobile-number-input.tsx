"use client";

import { ChangeEvent, InputHTMLAttributes, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Delete, Check } from "lucide-react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode">;

export function MobileNumberInput({ className = "", onFocus, onChange, value, defaultValue, ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const [uncontrolled, setUncontrolled] = useState(String(defaultValue ?? ""));
  const current = value === undefined ? uncontrolled : String(value ?? "");
  useEffect(() => {
    const media = matchMedia("(max-width: 820px), (pointer: coarse)");
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  function setValue(next: string) {
    const input = ref.current;
    if (!input) return;
    input.value = next;
    if (value === undefined) setUncontrolled(next);
    // A native dispatch alone can miss React's controlled onChange handler.
    onChange?.({ target: input, currentTarget: input } as ChangeEvent<HTMLInputElement>);
  }
  function key(value: string) {
    const current = ref.current?.value || "";
    if (value === "back") setValue(current.slice(0, -1));
    else if (value === ".") {
      if (!current.includes(".")) setValue((current || "0") + ".");
    } else setValue(current === "0" ? value : current + value);
  }
  return (
    <>
      <input
        {...props}
        ref={ref}
        value={current}
        type={mobile ? "text" : "number"}
        inputMode={mobile ? "none" : "decimal"}
        readOnly={mobile}
        className={className}
        onChange={(event) => {
          if (value === undefined) setUncontrolled(event.target.value);
          onChange?.(event);
        }}
        onFocus={(event) => {
          onFocus?.(event);
          if (mobile) setOpen(true);
        }}
        onClick={() => { if (mobile) setOpen(true); }}
      />
      {mobile && open && createPortal(
        <div
          className="gurminik-number-pad-backdrop"
          role="presentation"
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onTouchEnd={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="gurminik-number-pad" role="dialog" aria-modal="true" aria-label="Hızlı sayı klavyesi">
            <div className="gurminik-number-pad-value">{current || "0"}</div>
            <div className="gurminik-number-pad-grid">
              {["1","2","3","4","5","6","7","8","9"].map((n)=><button type="button" key={n} onClick={()=>key(n)}>{n}</button>)}
              <button type="button" onClick={()=>key(".")}>Virgül</button>
              <button type="button" onClick={()=>key("0")}>0</button>
              <button type="button" aria-label="Son rakamı sil" onClick={()=>key("back")}><Delete /></button>
            </div>
            <button type="button" className="gurminik-number-pad-done" onClick={()=>setOpen(false)}><Check /> Tamam</button>
          </section>
        </div>, document.body)}
    </>
  );
}

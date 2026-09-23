"use client";

import { InputHTMLAttributes, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Delete, Check } from "lucide-react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode">;

export function MobileNumberInput({ className = "", onFocus, ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
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
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, next);
    setDraft(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
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
        type={mobile ? "text" : "number"}
        inputMode={mobile ? "none" : "decimal"}
        readOnly={mobile}
        className={className}
        onFocus={(event) => {
          onFocus?.(event);
          if (mobile) { setDraft(event.currentTarget.value); setOpen(true); }
        }}
        onClick={() => { if (mobile) { setDraft(ref.current?.value || ""); setOpen(true); } }}
      />
      {mobile && open && createPortal(
        <div className="gurminik-number-pad-backdrop" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)setOpen(false)}}>
          <section className="gurminik-number-pad" role="dialog" aria-modal="true" aria-label="Hızlı sayı klavyesi">
            <div className="gurminik-number-pad-value">{draft || "0"}</div>
            <div className="gurminik-number-pad-grid">
              {["1","2","3","4","5","6","7","8","9"].map((n)=><button type="button" key={n} onClick={()=>key(n)}>{n}</button>)}
              <button type="button" onClick={()=>key(".")}>Virgül</button>
              <button type="button" onClick={()=>key("0")}>0</button>
              <button type="button" aria-label="Son rakamı sil" onClick={()=>key("back")}><Delete /></button>
            </div>
            <button type="button" className="gurminik-number-pad-done" onClick={()=>{setOpen(false);ref.current?.blur()}}><Check /> Tamam</button>
          </section>
        </div>, document.body)}
    </>
  );
}

// A drop-down menu like a desktop app's: opens from a button, closes on Escape or a click outside,
// and works with the arrow keys. Items can be plain actions, check boxes or one-of-several choices.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "./icons";

export type MenuItem =
  | { label: string; onSelect: () => void; danger?: boolean; checked?: boolean; role?: "checkbox" | "radio"; hint?: string; hidden?: boolean }
  | { heading: string; sub?: string; hidden?: boolean }
  | "sep";

export function Menu({ label, trigger, items, className = "iconbtn", align = "right" }: { label: string; trigger: ReactNode; items: MenuItem[]; className?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = items.filter((i) => i === "sep" || !i.hidden);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    list.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    const els = [...(list.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      setOpen(false);
      wrap.current?.querySelector<HTMLElement>("button")?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="menu" ref={wrap} onKeyDown={onKey}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu-pop ${align}`} role="menu" id={id} ref={list}>
          {shown.map((it, n) => {
            if (it === "sep") return <hr key={n} />;
            if ("heading" in it) return <div key={n} className="menu-head"><b>{it.heading}</b>{it.sub && <small>{it.sub}</small>}</div>;
            const role = it.role ? (it.role === "radio" ? "menuitemradio" : "menuitemcheckbox") : "menuitem";
            return (
              <button
                key={n}
                type="button"
                role={role}
                aria-checked={it.role ? !!it.checked : undefined}
                className={`menu-item${it.danger ? " danger" : ""}`}
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                <span className="menu-check">{it.role && it.checked ? <Check /> : null}</span>
                <span className="menu-label">{it.label}{it.hint && <small className="menu-hint">{it.hint}</small>}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

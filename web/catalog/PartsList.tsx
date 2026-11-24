// A sheet's parts list: position, part number, name, quantity. Clicking a row selects that part
// on the drawing or the 3D model; the list scrolls to a part picked on the drawing or model.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { partName, w, type Lang } from "./words";

export interface Row {
  id: string;
  pos: string;
  code: string;
  qty: number | null;
  unit: string | null;
  name_en: string | null;
  name_it: string | null;
  maker?: string | null;
  maker_pn?: string | null;
  wear: boolean;
  sub_sheet: string | null;
  hotspots: { x: number; y: number; w: number; h: number }[];
}

export function PartsList({
  rows, selected, onSelect, lang, onOpenSheet, partLink, action, extra,
}: {
  rows: Row[];
  selected: string | null;                       // selected row id
  onSelect: (row: Row) => void;
  lang: Lang;
  onOpenSheet: (id: string) => void;
  partLink: (code: string) => ReactNode;         // the part number, as a link to its page
  action?: (row: Row) => ReactNode;              // for example "Add to cart"
  extra?: (row: Row) => ReactNode;               // for example the staff notes count
}) {
  const [q, setQ] = useState("");
  const list = useRef<HTMLTableSectionElement>(null);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.pos, r.code, r.name_en, r.name_it, r.maker, r.maker_pn].some((v) => v && v.toLowerCase().includes(s)));
  }, [rows, q]);

  useEffect(() => {
    if (!selected) return;
    list.current?.querySelector(`[data-row="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="cv-parts">
      <input className="cv-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w(lang, "Find in this list")} aria-label={w(lang, "Find in this list")} />
      {!rows.length && <p className="cv-none">{w(lang, "This drawing has no parts list.")}</p>}
      {!!rows.length && !shown.length && <p className="cv-none">{w(lang, "No parts match.")}</p>}
      {!!shown.length && (
        <div className="cv-scroll">
          <table className="cv-table">
            <thead>
              <tr>
                <th scope="col">{w(lang, "Pos.")}</th>
                <th scope="col">{w(lang, "Part number")}</th>
                <th scope="col">{w(lang, "Description")}</th>
                <th scope="col" className="num">{w(lang, "Qty")}</th>
                {(action || extra) && <th scope="col"><span className="sr">{w(lang, "Add to cart")}</span></th>}
              </tr>
            </thead>
            <tbody ref={list}>
              {shown.map((r) => (
                <tr key={r.id} data-row={r.id} className={r.id === selected ? "on" : undefined} onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a,button,input")) return;
                  onSelect(r);
                }}>
                  <td className="mono">{r.pos}</td>
                  <td className="mono">{partLink(r.code)}</td>
                  <td>
                    {partName(lang, r) || <span className="muted">–</span>}
                    {r.wear && <span className="cv-tag" title={w(lang, "Wear part: good to keep a spare")}>{w(lang, "Wears")}</span>}
                    {r.maker && <small className="cv-maker">{[r.maker, r.maker_pn].filter(Boolean).join(" ")}</small>}
                    {r.sub_sheet && (
                      <button type="button" className="cv-link" onClick={() => onOpenSheet(r.sub_sheet!)}>{w(lang, "Open assembly")} →</button>
                    )}
                  </td>
                  <td className="num">{r.qty ?? "–"}{r.unit === "m" ? ` ${w(lang, "m")}` : ""}</td>
                  {(action || extra) && <td className="cv-act">{extra?.(r)}{action?.(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

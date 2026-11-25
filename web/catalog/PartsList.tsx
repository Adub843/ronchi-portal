// A sheet's parts list, laid out like the Ronchi Mario portal's: the assembly itself on top, then
// one row per part with its position, picture, part number with an (i) card, name and quantity,
// and the order box. Clicking a row selects that part on the drawing or 3D model; the list scrolls
// to a part picked on the drawing or model.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IC } from "./icons";
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
  picture?: string | null;   // when the part's picture (rendered in Fusion) was added; null = none
}

/** A part's picture, or its icon when there is none or it can't be loaded. */
function PartPic({ src, fallback, alt, className }: { src: string | null; fallback: ReactNode; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <>{fallback}</>;
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

export function PartsList({
  rows, selected, onSelect, lang, onOpenSheet, partLink, whereUsed, action, extra, query, head, onShow3D, has3D, pictureUrl,
}: {
  rows: Row[];
  selected: string | null;                       // selected row id
  onSelect: (row: Row) => void;
  lang: Lang;
  onOpenSheet: (id: string) => void;
  partLink: (code: string) => ReactNode;         // the part number, as a link to its page
  whereUsed?: (code: string) => ReactNode;       // "Show where this part is used", as a link
  action?: (row: Row) => ReactNode;              // for example the quantity box and cart button
  extra?: (row: Row) => ReactNode;               // for example the staff notes count
  query?: string;                                // the "Find in parts list" text, from the sheet's bar
  head?: { code: string | null; title: string; picture?: string | null }; // the assembly this list belongs to
  onShow3D?: (row: Row) => void;                 // "Show in 3D"
  has3D?: (code: string) => boolean;             // whether this part is in the sheet's 3D model
  pictureUrl?: (code: string, version: string) => string; // a part's picture (rows with `picture` set)
}) {
  const pic = (r: Row) => (r.picture && pictureUrl ? pictureUrl(r.code, r.picture) : null);
  const [info, setInfo] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const s = (query ?? "").trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.pos, r.code, r.name_en, r.name_it, r.maker, r.maker_pn].some((v) => v && v.toLowerCase().includes(s)));
  }, [rows, query]);

  useEffect(() => {
    if (!selected) return;
    list.current?.querySelector(`[data-row="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const qtyText = (r: Row) => `${r.qty ?? "–"}${r.unit === "m" ? ` ${w(lang, "m")}` : ""}`;

  return (
    <div className="pl" ref={list}>
      {head && (
        <div className="pl-row pl-asm">
          <span className="pl-pos" />
          <span className="pl-pic">{head.picture ? <PartPic src={head.picture} fallback={IC.list} alt="" /> : IC.list}</span>
          <span className="pl-what"><b className="mono">{head.code ?? ""}</b><small>{head.title}</small></span>
          <span className="pl-qty">{w(lang, "Quantity: {n}", { n: 1 })}</span>
        </div>
      )}
      {!rows.length && <p className="cv-none">{w(lang, "This drawing has no parts list.")}</p>}
      {!!rows.length && !shown.length && <p className="cv-none">{w(lang, "No parts match.")}</p>}
      {shown.map((r) => (
        <div key={r.id} data-row={r.id} className={`pl-row${r.id === selected ? " on" : ""}`} onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button,input,select,label,.pl-info")) return;
          onSelect(r);
        }}>
          <span className="pl-pos">{r.pos}</span>
          <span className="pl-pic" aria-hidden="true"><PartPic key={pic(r) ?? ""} src={pic(r)} fallback={r.sub_sheet ? IC.list : IC.gearPart} alt="" /></span>
          <span className="pl-what">
            <span className="pl-code">
              <b className="mono">{partLink(r.code)}</b>
              <button type="button" className="pl-i" aria-expanded={info === r.id} aria-label={w(lang, "About this part")} title={w(lang, "About this part")} onClick={() => setInfo(info === r.id ? null : r.id)}>{IC.info}</button>
            </span>
            <small>{partName(lang, r) || "–"}</small>
            {r.wear && <span className="cv-tag" title={w(lang, "Wear part: good to keep a spare")}>{w(lang, "Wears")}</span>}
            {r.maker && <small className="cv-maker">{[r.maker, r.maker_pn].filter(Boolean).join(" ")}</small>}
            {r.sub_sheet && <button type="button" className="cv-link" onClick={() => onOpenSheet(r.sub_sheet!)}>{w(lang, "Open assembly")} ›</button>}
            {info === r.id && (
              <span className="pl-info" role="dialog" aria-label={r.code}>
                <span className="pl-info-head"><b className="mono">{r.code}</b> - {partName(lang, r)}
                  <button type="button" className="cv-x" aria-label={w(lang, "Close")} onClick={() => setInfo(null)}>{IC.close}</button>
                </span>
                {pic(r) && <PartPic className="pl-info-pic" src={pic(r)} fallback={null} alt={w(lang, "Picture of {code}", { code: r.code })} />}
                <dl>
                  <dt>{w(lang, "Name")}</dt><dd>{partName(lang, r) || "–"}{r.name_it && lang !== "it" && r.name_it !== r.name_en ? <small> ({r.name_it})</small> : null}</dd>
                  <dt>{w(lang, "Number")}</dt><dd className="mono">{r.code}</dd>
                  <dt>{w(lang, "Quantity")}</dt><dd>{qtyText(r)}</dd>
                  <dt>{w(lang, "Pos.")}</dt><dd>{r.pos || "–"}</dd>
                  {r.maker && <><dt>{w(lang, "Maker")}</dt><dd>{[r.maker, r.maker_pn].filter(Boolean).join(" ")}</dd></>}
                </dl>
                <span className="pl-info-links">
                  {whereUsed?.(r.code)}
                  {onShow3D && has3D?.(r.code) && <button type="button" className="cv-link" onClick={() => { onShow3D(r); setInfo(null); }}>{w(lang, "Show in 3D")}</button>}
                  {r.sub_sheet && <button type="button" className="cv-link" onClick={() => onOpenSheet(r.sub_sheet!)}>{w(lang, "Open assembly")} ›</button>}
                </span>
              </span>
            )}
          </span>
          <span className="pl-qty">
            <span>{w(lang, "Quantity: {n}", { n: qtyText(r) })}</span>
            {extra?.(r)}
            {action?.(r)}
          </span>
        </div>
      ))}
    </div>
  );
}

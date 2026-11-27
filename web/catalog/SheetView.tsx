// One sheet of a machine's catalog, laid out like the Ronchi Mario portal: a title bar (other
// parts lists, find, previous / next), the drawing or 3D model on the left and the parts list on
// the right, kept in step.
// Used by the staff catalog and the customer parts site alike.
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { IC } from "./icons";
import { Drawing2D, type Balloon } from "./Drawing2D";
import { DrawingTilt } from "./DrawingTilt";
import { PartsList, type Row } from "./PartsList";
import { partName, w, type Lang } from "./words";

// three.js is large; it loads only when someone opens a 3D model.
const Model3D = lazy(() => import("./Model3D").then((m) => ({ default: m.Model3D })));

export interface Sheet {
  id: string;
  code: string | null;
  title: string;
  drawing: { w: number; h: number; from?: string } | null;   // from: the machine whose manual the drawing comes from, when it isn't this one's
  model: { size: number; meshMap: Record<string, string> } | null;
  prev: string | null;
  next: string | null;
}

export function SheetView({
  sheet, rows, fileUrl, lang, onOpenSheet, partLink, whereUsed, action, extra, version = "", onPlace, siblings, tools, subtitle,
}: {
  sheet: Sheet;
  rows: Row[];
  fileUrl: (kind: "drawing" | "model") => string;
  lang: Lang;
  onOpenSheet: (id: string) => void;
  partLink: (code: string) => ReactNode;
  whereUsed?: (code: string) => ReactNode;
  action?: (row: Row) => ReactNode;
  extra?: (row: Row) => ReactNode;
  version?: string;   // changes when a new drawing or model is uploaded, so the browser fetches it again
  /** Staff only: with a row selected, a click on the drawing adds a balloon for it. */
  onPlace?: (row: Row, spot: { x: number; y: number; w: number; h: number }) => void;
  siblings?: { id: string; code: string | null; title: string }[];   // the other parts lists in this group
  tools?: ReactNode;      // buttons at the end of the title bar (favorite star, staff tools)
  subtitle?: string;      // shown at the end of the viewer's toolbar (the Italian sheet name)
}) {
  // A list with a 3D model opens on it, as the Ronchi viewer does; the drawing is one click away.
  const [tab, setTab] = useState<"drawing" | "model">(sheet.model ? "model" : "drawing");
  const [rowId, setRowId] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [sibs, setSibs] = useState(false);
  const row = rows.find((r) => r.id === rowId) ?? null;
  const balloons = useMemo<Balloon[]>(() => rows.flatMap((r) => r.hotspots.map((h) => ({ ...h, pos: r.pos }))), [rows]);
  const codes = useMemo(() => new Set(rows.map((r) => r.code)), [rows]);
  // What the 3D model holds, known once it has loaded: which parts it shows, and a small picture of each.
  const [found, setFound] = useState<{ codes: Set<string>; thumbs: Record<string, string> } | null>(null);
  const inModel = useMemo(() => found?.codes ?? new Set(Object.values(sheet.model?.meshMap ?? {})), [sheet.model, found]);
  const parts = useMemo(() => rows.map((r) => ({ code: r.code, qty: r.qty, names: [r.name_en, r.name_it, r.maker_pn, r.maker] })), [rows]);
  const q = version ? `?v=${encodeURIComponent(version)}` : "";
  const title = [sheet.code, sheet.title].filter(Boolean).join(" - ");

  // A sheet with a drawing always has a 3D side: the CAD model when there is one, the drawing itself
  // lying in the 3D view when there isn't (DrawingTilt).
  const lead = sheet.drawing ? (
    <span className="cv-switch" role="tablist" aria-label={w(lang, "Drawing or 3D")}>
      <button type="button" role="tab" aria-selected={tab === "drawing"} title={w(lang, "Drawing")} aria-label={w(lang, "Drawing")} onClick={() => setTab("drawing")}>{IC.drawing}</button>
      <button type="button" role="tab" aria-selected={tab === "model"} title={w(lang, "3D")} aria-label={w(lang, "3D")} onClick={() => setTab("model")}>{IC.model}</button>
    </span>
  ) : null;

  return (
    <div className="mv-sheet">
      <div className="mv-bar">
        {siblings && siblings.length > 1 && (
          <button type="button" className="mv-sibbtn" aria-expanded={sibs} title={w(lang, "Other parts lists here")} aria-label={w(lang, "Other parts lists here")} onClick={() => setSibs(!sibs)}>{IC.list}{IC.caret}</button>
        )}
        <h1>{title || w(lang, "Untitled drawing")}</h1>
        <span className="mv-gap" />
        <input className="mv-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={w(lang, "Find in parts list")} aria-label={w(lang, "Find in parts list")} />
        <button type="button" className="mv-ib" disabled={!sheet.prev} onClick={() => sheet.prev && onOpenSheet(sheet.prev)} title={w(lang, "Previous sheet")} aria-label={w(lang, "Previous sheet")}>{IC.prev}</button>
        <button type="button" className="mv-ib" disabled={!sheet.next} onClick={() => sheet.next && onOpenSheet(sheet.next)} title={w(lang, "Next sheet")} aria-label={w(lang, "Next sheet")}>{IC.next}</button>
        {tools}
      </div>
      <div className={`mv-work${sibs ? " with-sibs" : ""}`}>
        {sibs && siblings && (
          <nav className="mv-sibs" aria-label={w(lang, "Other parts lists here")}>
            {siblings.map((x) => (
              <button key={x.id} type="button" className={x.id === sheet.id ? "on" : undefined} aria-current={x.id === sheet.id ? "page" : undefined} onClick={() => { setSibs(false); onOpenSheet(x.id); }}>
                <span aria-hidden="true">{IC.list}</span>{[x.code, x.title].filter(Boolean).join(" - ")}
              </button>
            ))}
          </nav>
        )}
        <div className="mv-view">
          {tab === "drawing" && sheet.drawing && (
            <Drawing2D
              key={`${sheet.id}${q}`}
              src={fileUrl("drawing") + q}
              width={sheet.drawing.w}
              height={sheet.drawing.h}
              balloons={balloons}
              selected={row?.pos ?? null}
              onPick={(pos) => setRowId(rows.find((r) => r.pos === pos)?.id ?? null)}
              lang={lang}
              lead={lead}
              label={subtitle}
              onPlace={onPlace && row ? (x, y) => {
                const size = 0.018;
                onPlace(row, { x: Math.max(0, x - size / 2), y: Math.max(0, y - size / 2), w: size, h: size * (sheet.drawing!.w / sheet.drawing!.h) });
              } : undefined}
            />
          )}
          {tab === "model" && sheet.model && (
            <Suspense fallback={<p className="cv-msg cv-empty">{w(lang, "Loading the 3D model…")}</p>}>
              <Model3D
                key={`${sheet.id}${q}`}
                src={fileUrl("model") + q}
                meshMap={sheet.model.meshMap}
                selected={row?.code ?? null}
                onPick={(code) => setRowId(code ? (rows.find((r) => r.code === code)?.id ?? null) : null)}
                lang={lang}
                knownCodes={codes}
                parts={parts}
                onLinked={setFound}
                lead={lead}
                label={subtitle}
                describe={(code) => { const r = rows.find((x) => x.code === code); return r ? partName(lang, r) || null : null; }}
                card={(code) => {
                  const r = rows.find((x) => x.code === code);
                  if (!r) return null;
                  return (
                    <div className="cv-card-body">
                      <span>{w(lang, "Pos.")} <b>{r.pos}</b></span>
                      <span>{w(lang, "Qty")} <b>{r.qty ?? "–"}{r.unit === "m" ? ` ${w(lang, "m")}` : ""}</b></span>
                      {r.wear && <span className="cv-tag" title={w(lang, "Wear part: good to keep a spare")}>{w(lang, "Wears")}</span>}
                      {r.maker && <span className="cv-maker">{[r.maker, r.maker_pn].filter(Boolean).join(" ")}</span>}
                      <span>{partLink(r.code)}</span>
                      {r.sub_sheet && <button type="button" className="cv-link" onClick={() => onOpenSheet(r.sub_sheet!)}>{w(lang, "Open assembly")} ›</button>}
                      {action?.(r)}
                    </div>
                  );
                }}
                fileName={[sheet.code, sheet.title].filter(Boolean).join(" ")}
              />
            </Suspense>
          )}
          {tab === "model" && !sheet.model && sheet.drawing && (
            <DrawingTilt
              key={`${sheet.id}${q}`}
              src={fileUrl("drawing") + q}
              width={sheet.drawing.w}
              height={sheet.drawing.h}
              balloons={balloons}
              selected={row?.pos ?? null}
              onPick={(pos) => setRowId(rows.find((r) => r.pos === pos)?.id ?? null)}
              lang={lang}
              lead={lead}
              label={subtitle}
            />
          )}
          {sheet.drawing?.from && <p className="cv-hint cv-from">{w(lang, "Drawing of the same assembly from the manual of machine {serial}.", { serial: sheet.drawing.from })}</p>}
          {!sheet.drawing && !sheet.model && <p className="cv-msg cv-empty">{w(lang, "No drawing for this parts list yet. The list on the right is complete.")}</p>}
          {sheet.prev && <button type="button" className="mv-side-arrow left" onClick={() => onOpenSheet(sheet.prev!)} aria-label={w(lang, "Previous sheet")} title={w(lang, "Previous sheet")}>{IC.prev}</button>}
          {sheet.next && <button type="button" className="mv-side-arrow right" onClick={() => onOpenSheet(sheet.next!)} aria-label={w(lang, "Next sheet")} title={w(lang, "Next sheet")}>{IC.next}</button>}
        </div>
        <PartsList
          rows={rows}
          selected={rowId}
          onSelect={(r) => setRowId(r.id === rowId ? null : r.id)}
          lang={lang}
          onOpenSheet={onOpenSheet}
          partLink={partLink}
          whereUsed={whereUsed}
          action={action}
          extra={extra}
          query={find}
          head={{ code: sheet.code, title: sheet.title }}
          onShow3D={(r) => { setTab("model"); setRowId(r.id); }}
          has3D={(code) => inModel.has(code)}
          thumb={(code) => found?.thumbs[code]}
        />
      </div>
    </div>
  );
}

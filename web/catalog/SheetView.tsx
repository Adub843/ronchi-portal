// One sheet of a machine's catalog: the drawing or 3D model beside its parts list, kept in step.
// Used by the staff catalog and the customer parts site alike.
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { Drawing2D, type Balloon } from "./Drawing2D";
import { PartsList, type Row } from "./PartsList";
import { partName, w, type Lang } from "./words";

// three.js is large; it loads only when someone opens a 3D model.
const Model3D = lazy(() => import("./Model3D").then((m) => ({ default: m.Model3D })));

export interface Sheet {
  id: string;
  code: string | null;
  title: string;
  drawing: { w: number; h: number } | null;
  model: { size: number; meshMap: Record<string, string> } | null;
  prev: string | null;
  next: string | null;
}

export function SheetView({
  sheet, rows, fileUrl, lang, onOpenSheet, partLink, action, extra, version = "", onPlace,
}: {
  sheet: Sheet;
  rows: Row[];
  fileUrl: (kind: "drawing" | "model") => string;
  lang: Lang;
  onOpenSheet: (id: string) => void;
  partLink: (code: string) => ReactNode;
  action?: (row: Row) => ReactNode;
  extra?: (row: Row) => ReactNode;
  version?: string;   // changes when a new drawing or model is uploaded, so the browser fetches it again
  /** Staff only: with a row selected, a click on the drawing adds a balloon for it. */
  onPlace?: (row: Row, spot: { x: number; y: number; w: number; h: number }) => void;
}) {
  const [tab, setTab] = useState<"drawing" | "model">(sheet.drawing || !sheet.model ? "drawing" : "model");
  const [rowId, setRowId] = useState<string | null>(null);
  const row = rows.find((r) => r.id === rowId) ?? null;
  const balloons = useMemo<Balloon[]>(() => rows.flatMap((r) => r.hotspots.map((h) => ({ ...h, pos: r.pos }))), [rows]);
  const codes = useMemo(() => new Set(rows.map((r) => r.code)), [rows]);
  const q = version ? `?v=${encodeURIComponent(version)}` : "";

  return (
    <div className="cv">
      <div className="cv-view">
        {(sheet.drawing || sheet.model) && (
          <div className="cv-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "drawing"} disabled={!sheet.drawing} onClick={() => setTab("drawing")}>{w(lang, "Drawing")}</button>
            <button type="button" role="tab" aria-selected={tab === "model"} disabled={!sheet.model} onClick={() => setTab("model")}>{w(lang, "3D")}</button>
            <span className="cv-gap" />
            <button type="button" className="cv-btn" disabled={!sheet.prev} onClick={() => sheet.prev && onOpenSheet(sheet.prev)} aria-label={w(lang, "Previous sheet")} title={w(lang, "Previous sheet")}>←</button>
            <button type="button" className="cv-btn" disabled={!sheet.next} onClick={() => sheet.next && onOpenSheet(sheet.next)} aria-label={w(lang, "Next sheet")} title={w(lang, "Next sheet")}>→</button>
          </div>
        )}
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
            onPlace={onPlace && row ? (x, y) => {
              const size = 0.018;
              onPlace(row, { x: Math.max(0, x - size / 2), y: Math.max(0, y - size / 2), w: size, h: size * (sheet.drawing!.w / sheet.drawing!.h) });
            } : undefined}
          />
        )}
        {tab === "model" && sheet.model && (
          <Suspense fallback={<p className="cv-msg">{w(lang, "Loading the 3D model…")}</p>}>
            <Model3D
              key={`${sheet.id}${q}`}
              src={fileUrl("model") + q}
              meshMap={sheet.model.meshMap}
              selected={row?.code ?? null}
              onPick={(code) => setRowId(code ? (rows.find((r) => r.code === code)?.id ?? null) : null)}
              lang={lang}
              knownCodes={codes}
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
                    {r.sub_sheet && <button type="button" className="cv-link" onClick={() => onOpenSheet(r.sub_sheet!)}>{w(lang, "Open assembly")} →</button>}
                    {action?.(r)}
                  </div>
                );
              }}
              fileName={[sheet.code, sheet.title].filter(Boolean).join(" ")}
            />
          </Suspense>
        )}
        {!sheet.drawing && !sheet.model && <p className="cv-msg cv-empty">{w(lang, "No drawing for this sheet yet.")}</p>}
      </div>
      <PartsList
        rows={rows}
        selected={rowId}
        onSelect={(r) => setRowId(r.id === rowId ? null : r.id)}
        lang={lang}
        onOpenSheet={onOpenSheet}
        partLink={partLink}
        action={action}
        extra={extra}
      />
    </div>
  );
}

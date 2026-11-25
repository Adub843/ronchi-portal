// One sheet of a machine's catalog, laid out like the Ronchi Mario portal: a title bar (other
// parts lists, find, previous / next), the drawing or 3D model on the left and the parts list on
// the right, kept in step.
// Used by the staff catalog and the customer parts site alike.
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { IC } from "./icons";
import { Drawing2D, type Balloon } from "./Drawing2D";
import { PartsList, type Row } from "./PartsList";
import { ViewPictures } from "./ViewPictures";
import { partName, w, type Lang } from "./words";

// three.js is large; it loads only when someone opens a 3D model.
const Model3D = lazy(() => import("./Model3D").then((m) => ({ default: m.Model3D })));

export interface Sheet {
  id: string;
  code: string | null;
  title: string;
  drawing: { w: number; h: number } | null;
  model: { size: number; meshMap: Record<string, string> } | null;
  views?: string[];   // 3D views rendered in Fusion (iso, front, top, right)
  prev: string | null;
  next: string | null;
}

export function SheetView({
  sheet, rows, fileUrl, lang, onOpenSheet, partLink, whereUsed, action, extra, version = "", onPlace, siblings, tools, subtitle, pictureUrl, viewUrl,
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
  pictureUrl?: (code: string, version: string) => string;   // a part's picture, for the parts list
  viewUrl?: (view: string) => string;                        // one of the sheet's 3D views
}) {
  const views = viewUrl ? (sheet.views ?? []) : [];
  const [picked, setTab] = useState<"drawing" | "model" | "views" | null>(null);
  // The tab picked, or the first one this sheet has (a drawing, 3D or views can be added later).
  const has = { drawing: !!sheet.drawing, model: !!sheet.model, views: views.length > 0 };
  const tab = picked && has[picked] ? picked : has.drawing ? "drawing" : has.model ? "model" : has.views ? "views" : "drawing";
  const [rowId, setRowId] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [sibs, setSibs] = useState(false);
  const row = rows.find((r) => r.id === rowId) ?? null;
  const balloons = useMemo<Balloon[]>(() => rows.flatMap((r) => r.hotspots.map((h) => ({ ...h, pos: r.pos }))), [rows]);
  const codes = useMemo(() => new Set(rows.map((r) => r.code)), [rows]);
  const inModel = useMemo(() => new Set(Object.values(sheet.model?.meshMap ?? {})), [sheet.model]);
  const q = version ? `?v=${encodeURIComponent(version)}` : "";
  const title = [sheet.code, sheet.title].filter(Boolean).join(" - ");

  const tabs = [sheet.drawing && "drawing", sheet.model && "model", views.length && "views"].filter(Boolean).length;
  const lead = tabs > 1 ? (
    <span className="cv-switch" role="tablist" aria-label={w(lang, "Drawing or 3D")}>
      {sheet.drawing && <button type="button" role="tab" aria-selected={tab === "drawing"} title={w(lang, "Drawing")} aria-label={w(lang, "Drawing")} onClick={() => setTab("drawing")}>{IC.drawing}</button>}
      {sheet.model && <button type="button" role="tab" aria-selected={tab === "model"} title={w(lang, "3D")} aria-label={w(lang, "3D")} onClick={() => setTab("model")}>{IC.model}</button>}
      {views.length > 0 && <button type="button" role="tab" aria-selected={tab === "views"} title={w(lang, "Pictures")} aria-label={w(lang, "Pictures")} onClick={() => setTab("views")}>{IC.camera}</button>}
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
          {tab === "views" && views.length > 0 && viewUrl && (
            <ViewPictures key={`${sheet.id}${q}`} views={views} src={(v) => viewUrl(v) + q} lang={lang} lead={lead} label={subtitle} alt={title} />
          )}
          {!sheet.drawing && !sheet.model && !views.length && <p className="cv-msg cv-empty">{w(lang, "No drawing for this parts list yet. The list on the right is complete.")}</p>}
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
          head={{ code: sheet.code, title: sheet.title, picture: views.length && viewUrl ? viewUrl(views[0]!) + q : null }}
          onShow3D={(r) => { setTab("model"); setRowId(r.id); }}
          has3D={(code) => inModel.has(code)}
          pictureUrl={pictureUrl}
        />
      </div>
    </div>
  );
}

// A machine's catalog as a tree, like the Mario portal's: Machine components, Format components,
// Elevators, Kits; then the manual's groups; then each drawing with its sub-assemblies under it.
import { useMemo, useState, type ReactNode } from "react";
import { SECTIONS, type Section } from "../../src/shared/catalog/model";
import { w, type Lang } from "./words";

export interface TreeSheet {
  id: string;
  parent_id: string | null;
  section: string;
  grp: string | null;
  code: string | null;
  title: string;
  rows: number;
  has_drawing?: number | boolean;
  has_model?: number | boolean;
  views?: string[];   // 3D views rendered in Fusion; the first is the parts list's picture
}

const SECTION_WORD = { machine: "Machine components", format: "Format components", elevator: "Elevators", kit: "Kits" } as const;

export function CatalogTree({ sheets, link, lang, badge }: {
  sheets: TreeSheet[];
  link: (s: TreeSheet) => ReactNode;        // the sheet's title, as a link
  lang: Lang;
  badge?: (s: TreeSheet) => ReactNode;
}) {
  const [q, setQ] = useState("");
  const match = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return new Set(sheets.filter((x) => x.title.toLowerCase().includes(s) || (x.code ?? "").toLowerCase().includes(s)).map((x) => x.id));
  }, [q, sheets]);
  const ids = new Set(sheets.map((s) => s.id));
  const kids = (id: string) => sheets.filter((s) => s.parent_id === id);
  const shown = (s: TreeSheet): boolean => !match || match.has(s.id) || kids(s.id).some(shown);

  const item = (s: TreeSheet, depth: number): ReactNode => shown(s) && (
    <li key={s.id}>
      <div className="ct-row" style={{ paddingLeft: depth * 16 }}>
        {link(s)}
        {s.code && <span className="mono muted ct-code">{s.code}</span>}
        <span className="ct-meta">
          {!!s.has_model && <span className="cv-tag ct-3d">3D</span>}
          {w(lang, "{n} parts", { n: s.rows })}
          {badge?.(s)}
        </span>
      </div>
      {kids(s.id).length > 0 && <ul>{kids(s.id).map((k) => item(k, depth + 1))}</ul>}
    </li>
  );

  return (
    <div className="ct">
      <input className="cv-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w(lang, "Find a drawing")} aria-label={w(lang, "Find a drawing")} />
      {SECTIONS.map((sec: Section) => {
        const top = sheets.filter((s) => s.section === sec && (!s.parent_id || !ids.has(s.parent_id)) && shown(s));
        if (!top.length) return null;
        const groups = [...new Set(top.map((s) => s.grp ?? ""))];
        return (
          <section key={sec} className="ct-sec">
            <h2>{w(lang, SECTION_WORD[sec])}</h2>
            {groups.map((g) => (
              <div key={g}>
                {g && <h3 className="ct-grp">{g}</h3>}
                <ul className="ct-list">{top.filter((s) => (s.grp ?? "") === g).map((s) => item(s, 0))}</ul>
              </div>
            ))}
          </section>
        );
      })}
      {match && !sheets.some(shown) && <p className="cv-none">{w(lang, "No drawings match.")}</p>}
    </div>
  );
}

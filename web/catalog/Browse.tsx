// Catalog browsing the way the Ronchi Mario portal does it: a breadcrumb trail, then a grid of
// picture tiles at each level (Available content > Spare parts catalogue > Machine components >
// group > parts lists). Shared by the staff catalog and the customer parts site; each passes its
// own Link and addresses.
import { useMemo, useState, type ReactNode } from "react";
import { SECTIONS, type Section } from "../../src/shared/catalog/model";
import type { TreeSheet } from "./CatalogTree";
import { TILE } from "./icons";
import { w as word, type Lang, type Word } from "./words";

// Group names come from the manuals, so not every label is a known word.
const w = (lang: Lang, k: string, vars?: Record<string, string | number>) => word(lang, k as Word, vars);

export type LinkLike = (p: { to: string; className?: string; children: ReactNode }) => ReactNode;

export const SECTION_WORD: Record<Section, string> = { machine: "Machine components", format: "Format components", elevator: "Elevators", kit: "Kits" };
const SECTION_TILE: Record<Section, ReactNode> = { machine: TILE.machine, format: TILE.format, elevator: TILE.elevator, kit: TILE.kit };

export function Crumbs({ items, L, label }: { items: { label: string; to?: string }[]; L: LinkLike; label: string }) {
  return (
    <nav className="mv-crumbs" aria-label={label}>
      {items.map((c, i) => (
        <span key={i}>
          {c.to && i < items.length - 1 ? <L to={c.to}>{c.label}</L> : <span aria-current={i === items.length - 1 ? "page" : undefined}>{c.label}</span>}
          <span className="mv-sep" aria-hidden="true">›</span>
        </span>
      ))}
    </nav>
  );
}

export function Tile({ to, L, pic, img, label, sub, current }: { to: string; L: LinkLike; pic?: ReactNode; img?: string | null; label: string; sub?: string; current?: boolean }) {
  return (
    <L to={to} className={`mv-tile${current ? " on" : ""}`}>
      <span className="mv-pic">{img ? <img src={img} alt="" loading="lazy" /> : pic}</span>
      <span className="mv-cap">{label}</span>
      {sub && <span className="mv-sub">{sub}</span>}
    </L>
  );
}

/** A titled page of tiles, with Mario's "Filter list" box and an optional "Show only" side panel. */
export function TilePage({ title, children, side, filter, onFilter, lang, tools }: {
  title: string; children: ReactNode; side?: ReactNode; filter?: string; onFilter?: (q: string) => void; lang: Lang; tools?: ReactNode;
}) {
  return (
    <section className="mv-page">
      <div className="mv-head">
        <h1>{title}</h1>
        <span className="mv-gap" />
        {tools}
        {onFilter && <input className="mv-filter" type="search" value={filter} onChange={(e) => onFilter(e.target.value)} placeholder={w(lang, "Filter list")} aria-label={w(lang, "Filter list")} />}
      </div>
      <div className={side ? "mv-split" : undefined}>
        {side && <aside className="mv-side">{side}</aside>}
        <div className="mv-tiles">{children}</div>
      </div>
    </section>
  );
}

export interface Level { section?: Section; grp?: string }

/** Read the catalog part of an address: catalog, catalog/<section>, catalog/<section>/<group>. */
export function levelFrom(rest: string[]): Level {
  const section = SECTIONS.find((s) => s === rest[0]);
  return { section, grp: section && rest[1] !== undefined ? decodeURIComponent(rest[1]) : undefined };
}

const NO_GROUP = "-";

/**
 * The spare parts catalogue of one machine, one level at a time. base is the address of the
 * machine's catalogue ("/m/3651MB/catalog"); sheetTo is the address of one parts list.
 */
export function CatalogBrowse({ sheets, level, base, sheetTo, thumb, L, lang, crumbs, tools }: {
  sheets: TreeSheet[];
  level: Level;
  base: string;
  sheetTo: (s: TreeSheet) => string;
  thumb?: (s: TreeSheet) => string | null;
  L: LinkLike;
  lang: Lang;
  crumbs: { label: string; to?: string }[];   // the trail up to and including the machine
  tools?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "3d" | "drawing">("all");
  const enc = encodeURIComponent;
  const groupOf = (s: TreeSheet) => s.grp?.trim() || NO_GROUP;
  const trail = [...crumbs, { label: w(lang, "Spare parts catalogue"), to: base }];

  const match = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (x: TreeSheet) => (!s || x.title.toLowerCase().includes(s) || (x.code ?? "").toLowerCase().includes(s))
      && (only === "all" || (only === "3d" ? !!x.has_model : !!x.has_drawing));
  }, [q, only]);

  let title = w(lang, "Spare parts catalogue");
  let tiles: ReactNode;
  let list: TreeSheet[] = [];
  if (!level.section) {
    const present = SECTIONS.filter((sec) => sheets.some((s) => s.section === sec));
    tiles = present.map((sec) => {
      const n = sheets.filter((s) => s.section === sec).length;
      return <Tile key={sec} to={`${base}/${sec}`} L={L} pic={SECTION_TILE[sec]} label={w(lang, SECTION_WORD[sec])} sub={w(lang, "{n} parts lists", { n })} />;
    });
  } else {
    const inSec = sheets.filter((s) => s.section === level.section);
    trail.push({ label: w(lang, SECTION_WORD[level.section]), to: `${base}/${level.section}` });
    title = w(lang, SECTION_WORD[level.section]);
    const groups = [...new Set(inSec.map(groupOf))];
    if (level.grp === undefined && groups.length > 1) {
      tiles = groups.map((g) => {
        const n = inSec.filter((s) => groupOf(s) === g).length;
        return <Tile key={g} to={`${base}/${level.section}/${enc(g)}`} L={L} pic={TILE.folder} label={g === NO_GROUP ? w(lang, "Other") : g} sub={w(lang, "{n} parts lists", { n })} />;
      });
    } else {
      const g = level.grp ?? groups[0];
      if (level.grp !== undefined) {
        trail.push({ label: g === NO_GROUP ? w(lang, "Other") : g!, to: `${base}/${level.section}/${enc(g!)}` });
        title = g === NO_GROUP ? w(lang, "Other") : g!;
      }
      list = inSec.filter((s) => groupOf(s) === g);
      tiles = list.filter(match).map((s) => (
        <Tile key={s.id} to={sheetTo(s)} L={L} pic={TILE.partsList} img={thumb?.(s)} label={[s.code, s.title].filter(Boolean).join(" - ")} sub={s.has_model ? w(lang, "3D") : undefined} />
      ));
    }
  }

  const side = list.length > 0 && (
    <>
      <h2>{w(lang, "Show only")}</h2>
      {(["all", "drawing", "3d"] as const).map((k) => {
        const n = k === "all" ? list.length : list.filter((s) => (k === "3d" ? s.has_model : s.has_drawing)).length;
        return (
          <label key={k} className="mv-only">
            <input type="radio" name="mv-only" checked={only === k} onChange={() => setOnly(k)} disabled={!n} />
            {w(lang, k === "all" ? "Parts lists ({n})" : k === "3d" ? "With 3D ({n})" : "With drawing ({n})", { n })}
          </label>
        );
      })}
    </>
  );

  return (
    <>
      <Crumbs items={trail} L={L} label={w(lang, "Where you are in the catalogue")} />
      <TilePage title={title} lang={lang} filter={q} onFilter={list.length ? setQ : undefined} side={side || undefined} tools={tools}>
        {tiles}
        {list.length > 0 && !list.some(match) && <p className="mv-none">{w(lang, "No parts lists match.")}</p>}
        {!sheets.length && <p className="mv-none">{w(lang, "This machine's parts lists aren't in the catalogue yet.")}</p>}
      </TilePage>
    </>
  );
}

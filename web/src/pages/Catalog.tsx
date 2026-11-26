// The parts catalog, staff side: every machine's drawings and parts lists, 2D and 3D, where each
// part is used, staff notes, and the tools to build a catalog (read the manual, fix tables, add
// 3D from STEP) and publish it to the customer parts site.
//
//   /catalog                 machines with a catalog, and part search across all of them
//   /catalog/m/<machine id>  one machine's catalog tree, and publish
//   /catalog/s/<sheet id>    one drawing or 3D assembly with its parts list
//   /catalog/p/<part code>   one part: names, where it's used, notes
import { useEffect, useMemo, useState } from "react";
import { PartSoldBefore } from "./PartsOrders";
import { api, apiPut, can, fmtTime, type Me } from "../api";
import { getLang, t } from "../i18n";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad, Tip } from "../components/ui";
import { navigate } from "../router";
import type { TreeSheet } from "../../catalog/CatalogTree";
import { CatalogBrowse, Crumbs, levelFrom, SECTION_WORD, Tile, TilePage, type LinkLike } from "../../catalog/Browse";
import { TILE } from "../../catalog/icons";
import { SheetView } from "../../catalog/SheetView";
import type { Row } from "../../catalog/PartsList";
import { codeOf } from "../../catalog/codes";
import { findAssemblies } from "../../catalog/split";
import { w, type Word } from "../../catalog/words";
import { guessSection, linkSubAssemblies, readChapter11, type PageText } from "../../../src/shared/catalog/chapter11";
import { cleanPartCode, type ParsedSheet } from "../../../src/shared/catalog/model";
import "../../catalog/catalog.css";

export function Catalog({ me, path }: { me: Me; path: string }) {
  const parts = path.split("?")[0]!.split("/").filter(Boolean);   // catalog, m, <id>, catalog, <section>, <group>
  const [kind, id] = [parts[1], parts[2]];
  if (kind === "m" && id && parts[3] === "catalog") return <CatalogMachineBrowse key={path} id={id} rest={parts.slice(4)} me={me} />;
  if (kind === "m" && id) return <CatalogMachine key={id} id={id} me={me} />;
  if (kind === "s" && id) return <CatalogSheet key={id} id={id} me={me} />;
  if (kind === "p" && id) return <CatalogPart key={id} code={safeDecode(id)} me={me} />;
  if (kind === "c" && id !== undefined) return <CatalogHome key={path} me={me} customer={decodeURIComponent(id)} />;
  return <CatalogHome me={me} />;
}

const enc = encodeURIComponent;
const safeDecode = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };

// ---------- Home: customers, machines and search, as picture tiles like the Mario portal ----------

const NO_CUSTOMER = "-";

function CatalogHome({ me, customer }: { me: Me; customer?: string }) {
  const { data, error, reload } = useLoad(() => api("/catalog/machines"));
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const found = useLoad(() => (query.length >= 2 ? api(`/catalog/search?q=${enc(query)}`) : Promise.resolve({ results: [], machines: [] })), [query]);
  const all: any[] = data?.machines ?? [];
  const cust = (m: any) => (m.customer ?? "").trim() || NO_CUSTOMER;
  const f = filter.trim().toLowerCase();
  const lang = getLang();
  const L = Link as LinkLike;

  let tiles: React.ReactNode;
  if (customer === undefined) {
    const names = [...new Set(all.map(cust))].sort((a, b) => (a === NO_CUSTOMER ? 1 : b === NO_CUSTOMER ? -1 : a.localeCompare(b)));
    tiles = names.filter((n) => !f || n.toLowerCase().includes(f) || all.some((m) => cust(m) === n && m.serial.toLowerCase().includes(f))).map((n) => {
      const ms = all.filter((m) => cust(m) === n);
      const withCat = ms.filter((m) => m.sheets > 0).length;
      return <Tile key={n} to={`/catalog/c/${enc(n)}`} L={L} pic={TILE.folder} label={n === NO_CUSTOMER ? t("Customer not set") : n} sub={ms.length === 1 ? (withCat ? t("1 machine, with a catalog") : t("1 machine")) : t("{n} machines, {k} with a catalog", { n: ms.length, k: withCat })} />;
    });
  } else {
    tiles = all.filter((m) => cust(m) === customer && (!f || [m.serial, m.model, m.site].some((v) => v && String(v).toLowerCase().includes(f)))).map((m) => (
      <Tile key={m.id} to={`/catalog/m/${m.id}`} L={L} pic={TILE.filler} label={m.serial} sub={[m.site, m.sheets ? t("{n} parts lists", { n: m.sheets }) : t("No catalog yet")].filter(Boolean).join(" · ")} />
    ));
  }

  return (
    <>
      <Crumbs L={L} label={t("Where you are")} items={[{ label: t("All customers"), to: "/catalog" }, ...(customer !== undefined ? [{ label: customer === NO_CUSTOMER ? t("Customer not set") : customer }] : [])]} />
      <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <input className="panel" style={{ flex: 1, padding: "8px 12px", font: "inherit" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Machine number, customer, part number or part name")} aria-label={t("Search the catalog")} />
        <button className="btn" type="submit">{t("Search")}</button>
        {can(me, "catalog.edit") && <button type="button" className="btn" aria-expanded={loading} onClick={() => setLoading(!loading)}>{t("Load parts lists")}</button>}
      </form>
      {loading && <LoadFiles me={me} machines={all} onDone={() => { setLoading(false); reload(); }} />}
      {query && (
        <div className="panel tbl">
          {found.data && !found.data.results.length && !found.data.machines?.length && <Empty>{t("Nothing matches \"{q}\".", { q: query })}</Empty>}
          {!!found.data?.machines?.length && (
            <div className="mv-tiles" style={{ marginBottom: 12 }}>
              {found.data.machines.map((m: any) => <Tile key={m.id} to={`/catalog/m/${m.id}`} L={L} pic={TILE.filler} label={m.serial} sub={[m.customer, m.sheets ? t("{n} parts lists", { n: m.sheets }) : t("No catalog yet")].filter(Boolean).join(" · ")} />)}
            </div>
          )}
          {!!found.data?.results.length && (
            <table>
              <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Machine")}</th><th>{t("Drawing")}</th><th>{t("Qty")}</th></tr></thead>
              <tbody>
                {found.data.results.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="mono"><Link to={`/catalog/p/${r.code}`}>{r.code}</Link></td>
                    <td>{r.name_en || r.name_it}</td>
                    <td className="mono"><Link to={`/catalog/m/${r.machine_id}`}>{r.serial}</Link></td>
                    <td><Link to={`/catalog/s/${r.sheet_id}`}>{r.sheet_title}</Link> <span className="muted">· {t("Pos.")} {r.pos}</span></td>
                    <td>{r.qty ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <ErrorNote error={error} />
      {data && !data.partsSite && can(me, "catalog.edit") && (
        <p className="note-inline">{t("The customer parts site isn't connected yet, so catalogs can be built here but not published.")}</p>
      )}
      <TilePage lang={lang} title={customer === undefined ? t("Customers") : customer === NO_CUSTOMER ? t("Customer not set") : customer} filter={filter} onFilter={setFilter}>
        {tiles}
        {data && !all.length && <p className="mv-none">{t("No machines yet. Load them on the Machines page with Import CSV.")}</p>}
      </TilePage>
    </>
  );
}

// ---------- One machine: tree, import, publish ----------

function CatalogMachine({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad(() => api(`/catalog/machines/${enc(id)}`), [id]);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const editor = can(me, "catalog.edit");
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const m = data.machine;

  async function publish() {
    if (!confirm(t("Publish this catalog to the customer parts site? Customers who own {serial} will see it right away.", { serial: m.serial }))) return;
    try {
      setBusy(t("Publishing…"));
      const r = await api(`/catalog/machines/${enc(id)}/publish`, { body: {} });
      const files: string[] = r.files;
      for (let i = 0; i < files.length; i += 5) {
        setBusy(t("Copying drawings and 3D models: {n} of {total}", { n: Math.min(i + 5, files.length), total: files.length }));
        await api(`/catalog/machines/${enc(id)}/publish/files`, { body: { sheets: files.slice(i, i + 5) } });
      }
      toast(t("Published {n} drawings", { n: r.sheets }));
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  /** One 3D model of the whole machine: each assembly in it goes onto the parts list with its number. */
  async function wholeModel(file: File) {
    let dispose = () => {};
    try {
      setBusy(t("Reading the 3D file. A whole machine can take a few minutes…"));
      const step = await import("../catalog/step");
      let root;
      if (/\.glb$/i.test(file.name)) root = await step.glbToObject(file);
      else ({ root, dispose } = await step.stepToObject(file));
      const byCode = new Map<string, string[]>();
      for (const s of data.sheets as { id: string; code: string | null }[]) if (s.code) byCode.set(s.code, [...(byCode.get(s.code) ?? []), s.id]);
      const hits = findAssemblies(root, byCode.keys());
      if (!hits.size) throw new Error(t("None of this machine's assembly numbers are in the 3D file. Check the CAD names start with the part number."));
      const jobs = [...hits].flatMap(([code, node]) => (byCode.get(code) ?? []).map((id) => ({ id, node })));
      let done = 0, tooBig = 0;
      for (const j of jobs) {
        setBusy(t("Saving 3D on parts list {n} of {total}…", { n: done + tooBig + 1, total: jobs.length }));
        const glb = await step.objectToGlb(j.node);
        if (glb.size > 95 * 1024 * 1024) { tooBig++; continue; }
        await apiPut(`/catalog/sheets/${enc(j.id)}/model`, glb, "model/gltf-binary");
        done++;
      }
      toast(t("3D added to {n} parts lists", { n: done }) + (tooBig ? " · " + t("{n} were too big (over 95 MB)", { n: tooBig }) : ""));
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      dispose();
      setBusy(null);
    }
  }
  async function unpublish() {
    if (!confirm(t("Take this catalog off the customer parts site?"))) return;
    try {
      await api(`/catalog/machines/${enc(id)}/publish`, { method: "DELETE" });
      toast(t("Taken off the parts site"));
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const L = Link as LinkLike;
  const crumbs = [
    { label: t("All customers"), to: "/catalog" },
    { label: m.customer || t("Customer not set"), to: `/catalog/c/${enc(m.customer || NO_CUSTOMER)}` },
    { label: m.serial, to: `/catalog/m/${m.id}` },
    { label: t("Available content") },
  ];
  return (
    <>
      <Crumbs L={L} label={t("Where you are")} items={crumbs} />
      <TilePage lang={getLang()} title={t("Available content")} tools={
        <span className="row" style={{ gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {editor && <button className="btn small" onClick={() => setImporting(!importing)}>{importing ? t("Close import") : t("Import from manual")}</button>}
          {editor && <button className="btn small" onClick={() => setAdding(!adding)}>{t("Add a drawing")}</button>}
          {editor && data.sheets.some((s: any) => s.code) && (
            <label className="btn small" title={t("One STEP or GLB file of the whole machine or a big assembly. Each assembly in it goes onto the parts list with the same number.")}>
              {t("Add 3D for the whole machine")}
              <input hidden type="file" accept=".step,.stp,.glb" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) wholeModel(f); }} />
            </label>
          )}
          {can(me, "catalog.publish") && data.sheets.length > 0 && <button className="btn small primary" disabled={!!busy} onClick={publish}>{t("Publish to customers")}</button>}
          {can(me, "catalog.publish") && m.catalog_published_at && <button className="btn small danger" disabled={!!busy} onClick={unpublish}>{t("Unpublish")}</button>}
        </span>
      }>
        <Tile to={`/catalog/m/${m.id}/catalog`} L={L} pic={TILE.catalogue} label={t("Spare parts catalogue")} sub={data.sheets.length ? t("{n} parts lists", { n: data.sheets.length }) : t("No catalog yet")} />
        <Tile to={`/machines/${m.id}`} L={L} pic={TILE.docs} label={t("Machine page")} sub={[m.model, m.site].filter(Boolean).join(" · ") || undefined} />
      </TilePage>
      <p className="muted small">{[m.catalog_published_at ? t("On the parts site since {when}", { when: fmtTime(m.catalog_published_at) }) : t("Not on the parts site"), m.notes].filter(Boolean).join(" · ")}</p>
      {busy && <p className="note-inline" role="status">{busy}</p>}
      {importing && <ImportManual machineId={id} onDone={() => { setImporting(false); reload(); }} />}
      {adding && <AddSheet machineId={id} sheets={data.sheets} onDone={(sid) => navigate(`/catalog/s/${sid}`)} />}
      {!!data.imports.length && (
        <div className="panel">
          <h2>{t("Imports")}</h2>
          {data.imports.map((i: any) => (
            <details key={i.id} className="imp">
              <summary>
                {i.file_name} · {t("{n} drawings, {rows} rows", { n: i.sheets, rows: i.rows })} · {i.by_name ?? t("Read on the office PC")} · {fmtTime(i.created_at)}
                {i.warnings.length > 0 && <span className="cv-tag">{t("{n} to check", { n: i.warnings.length })}</span>}
              </summary>
              <ul>{i.warnings.map((x: string, k: number) => <li key={k}>{x}</li>)}</ul>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

function CatalogMachineBrowse({ id, rest }: { id: string; rest: string[]; me: Me }) {
  const { data, error } = useLoad(() => api(`/catalog/machines/${enc(id)}`), [id]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const m = data.machine;
  return (
    <CatalogBrowse
      sheets={data.sheets as TreeSheet[]}
      level={levelFrom(rest)}
      base={`/catalog/m/${m.id}/catalog`}
      sheetTo={(s) => `/catalog/s/${s.id}`}
      thumb={(s) => (s.has_drawing ? `/api/catalog/sheets/${enc(s.id)}/drawing` : null)}
      L={Link as LinkLike}
      lang={getLang()}
      crumbs={[
        { label: t("All customers"), to: "/catalog" },
        { label: m.customer || t("Customer not set"), to: `/catalog/c/${enc(m.customer || NO_CUSTOMER)}` },
        { label: m.serial, to: `/catalog/m/${m.id}` },
        { label: t("Available content"), to: `/catalog/m/${m.id}` },
      ]}
    />
  );
}

/**
 * Load parts lists from files: the JSON files copied from the Ronchi Mario portal (one per machine,
 * with its machine number inside). A machine that isn't in the registry yet is added first.
 */
function LoadFiles({ me, machines, onDone }: { me: Me; machines: any[]; onDone: () => void }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (x: string) => setLog((l) => [...l, x]);
  async function run(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setLog([]);
    const bySerial = new Map(machines.map((m) => [String(m.serial).toUpperCase(), m.id as string]));
    for (const file of Array.from(files)) {
      try {
        const j = JSON.parse(await file.text());
        const serial = String(j.serial ?? "").toUpperCase();
        if (!serial || !Array.isArray(j.sheets)) throw new Error(t("This isn't a parts list file."));
        let mid = bySerial.get(serial);
        if (!mid && can(me, "machines.add")) {
          mid = (await api("/machines", { body: { serial, model: j.type ?? "", customer: j.customer ?? "", site: j.plant ?? "" } })).id as string;
          bySerial.set(serial, mid);
        }
        if (!mid) throw new Error(t("{serial} isn't in the machine list.", { serial }));
        if (!j.sheets.length) { say(t("{serial}: no parts lists in the file", { serial })); continue; }
        await api(`/catalog/machines/${enc(mid)}/import`, { body: { fileName: j.fileName || file.name, sheets: j.sheets, warnings: j.skipped?.length ? [t("Codes left out: {list}", { list: j.skipped.slice(0, 40).map((x: any) => (typeof x === "string" ? x : x?.code)).filter(Boolean).join(", ") })] : [] } });
        say(t("{serial}: {n} parts lists loaded", { serial, n: j.sheets.length }));
      } catch (e) {
        say(`${file.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    toast(t("Done"));
  }
  return (
    <div className="panel stack">
      <h2>{t("Load parts lists")}</h2>
      <p className="muted">{t("Choose the parts list files (one per machine, .json). Each one replaces that machine's parts lists that came from a manual or from Mario. Drawings and 3D added by hand are kept.")}</p>
      <input type="file" accept=".json,application/json" multiple disabled={busy} onChange={(e) => run(e.target.files)} aria-label={t("Parts list files")} />
      {!!log.length && <ul className="small">{log.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {!busy && !!log.length && <div><button className="btn" onClick={onDone}>{t("Close")}</button></div>}
    </div>
  );
}

function AddSheet({ machineId, sheets, onDone }: { machineId: string; sheets: TreeSheet[]; onDone: (id: string) => void }) {
  const [f, setF] = useState({ title: "", code: "", section: "machine", parentId: "", source: "hand" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="panel grid g2" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const r = await api(`/catalog/machines/${enc(machineId)}/sheets`, { body: { ...f, parentId: f.parentId || undefined } });
        onDone(r.id);
      } catch (x) {
        setErr((x as Error).message);
      }
    }}>
      <div className="field"><label htmlFor="as-t">{t("Title")}</label><input id="as-t" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("Capping head")} /></div>
      <div className="field"><label htmlFor="as-c">{t("Assembly part number")}</label><input id="as-c" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="MB000100" /></div>
      <div className="field"><label htmlFor="as-s">{t("Section")}</label>
        <select id="as-s" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>
          <option value="machine">{t("Machine components")}</option><option value="format">{t("Format components")}</option>
          <option value="elevator">{t("Elevators")}</option><option value="kit">{t("Kits")}</option>
        </select>
      </div>
      <div className="field"><label htmlFor="as-p">{t("Sits inside")}</label>
        <select id="as-p" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
          <option value="">{t("Nothing (top level)")}</option>
          {sheets.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="as-k">{t("Made from")}</label>
        <select id="as-k" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="hand">{t("Added by hand")}</option><option value="cad">{t("From CAD")}</option>
        </select>
      </div>
      <ErrorNote error={err} />
      <div><button className="btn primary" type="submit">{t("Add drawing")}</button></div>
    </form>
  );
}

// ---------- Reading a manual ----------

function ImportManual({ machineId, onDone }: { machineId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [range, setRange] = useState({ from: "", to: "" });
  const [step, setStep] = useState<string | null>(null);
  const [result, setResult] = useState<{ sheets: ParsedSheet[]; skipped: number[]; pages: number; parents: Map<number, number> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [doc, setDoc] = useState<import("../catalog/pdf").Pdf | null>(null);

  async function read() {
    if (!file) return;
    setErr(null);
    setResult(null);
    try {
      setStep(t("Opening the PDF…"));
      const pdf = await import("../catalog/pdf");
      const d = await pdf.openPdf(file);
      setDoc(d);
      const from = Math.max(1, Number(range.from) || 1);
      const to = Math.min(d.numPages, Number(range.to) || d.numPages);
      const pages: PageText[] = [];
      for (let n = from; n <= to; n++) {
        setStep(t("Reading page {n} of {total}", { n: n - from + 1, total: to - from + 1 }));
        pages.push(await pdf.pageText(d, n));
      }
      const r = readChapter11(pages);
      if (!r.sheets.length) throw new Error(t("No parts tables were found on those pages. Check the page range, or the PDF may be scanned images without text."));
      setResult({ ...r, pages: to - from + 1, parents: linkSubAssemblies(r.sheets) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStep(null);
    }
  }

  async function save() {
    if (!result || !doc || !file) return;
    try {
      setStep(t("Saving the parts lists…"));
      const warnings = result.sheets.flatMap((s) => s.warnings.map((w) => t("Page {n}: {what}", { n: s.page, what: w })));
      const r = await api(`/catalog/machines/${enc(machineId)}/import`, {
        body: {
          fileName: file.name,
          pages: result.pages,
          warnings,
          sheets: result.sheets.map((s) => ({
            key: String(s.page),
            parentKey: result.parents.has(s.page) ? String(result.parents.get(s.page)) : null,
            section: guessSection(s),
            grp: s.group,
            code: s.code,
            rev: s.rev,
            title: s.titleEn || s.titleIt || s.code || t("Page {n}", { n: s.page }),
            titleIt: s.titleIt,
            page: s.page,
            rows: s.rows.map((row) => ({ ...row, hotspots: s.balloons.filter((b) => b.pos === row.pos).map(({ x, y, w, h }) => ({ x, y, w, h })) })),
          })),
        },
      });
      const pdf = await import("../catalog/pdf");
      const ids: { key: string; id: string }[] = r.sheets;
      for (let i = 0; i < ids.length; i++) {
        setStep(t("Saving drawing {n} of {total}", { n: i + 1, total: ids.length }));
        // Older manuals print the drawing on the page before the table.
        const page = Number(ids[i]!.key);
        const img = await pdf.pageImage(doc, result.sheets.find((x) => x.page === page)?.drawingPage ?? page);
        await apiPut(`/catalog/sheets/${enc(ids[i]!.id)}/drawing?w=${img.w}&h=${img.h}`, img.blob, img.blob.type);
      }
      toast(t("Imported {n} drawings", { n: ids.length }));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStep(null);
    }
  }

  const rows = result?.sheets.reduce((n, s) => n + s.rows.length, 0) ?? 0;
  const warned = result?.sheets.filter((s) => s.warnings.length) ?? [];
  return (
    <div className="panel stack">
      <h2>{t("Import from the manual")}</h2>
      <Tip id="catalog.import">{t("Choose the machine's manual PDF (chapter 11, Construction tables). It's read in this browser; only the parts tables and one picture per drawing are saved. Importing again replaces the drawings from the last import, and keeps drawings added by hand or from CAD.")}</Tip>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input type="file" accept="application/pdf,.pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} aria-label={t("Manual PDF")} />
        <label className="row" style={{ gap: 6 }}>{t("Pages")} <input style={{ width: 70 }} inputMode="numeric" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} placeholder={t("first")} aria-label={t("First page")} /> – <input style={{ width: 70 }} inputMode="numeric" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} placeholder={t("last")} aria-label={t("Last page")} /></label>
        <button className="btn" disabled={!file || !!step} onClick={read}>{t("Read")}</button>
      </div>
      {step && <p role="status">{step}</p>}
      <ErrorNote error={err} />
      {result && (
        <>
          <p>
            <b>{t("Found {n} drawings with {rows} part rows.", { n: result.sheets.length, rows })}</b>{" "}
            {result.skipped.length > 0 && t("{n} pages had no parts table and were skipped.", { n: result.skipped.length })}
          </p>
          {warned.length > 0 && (
            <details open>
              <summary>{t("{n} drawings to check after saving", { n: warned.length })}</summary>
              <ul>{warned.flatMap((s) => s.warnings.map((w, i) => <li key={`${s.page}-${i}`}>{t("Page {n}: {what}", { n: s.page, what: w })}</li>))}</ul>
            </details>
          )}
          <div className="tbl" style={{ maxHeight: 320, overflow: "auto" }}>
            <table>
              <thead><tr><th>{t("Page")}</th><th>{t("Title")}</th><th>{t("Part number")}</th><th>{t("Rows")}</th><th>{t("Balloons")}</th></tr></thead>
              <tbody>
                {result.sheets.map((s) => (
                  <tr key={s.page}>
                    <td>{s.page}</td>
                    <td>{result.parents.has(s.page) ? "↳ " : ""}{s.titleEn || s.titleIt}</td>
                    <td className="mono">{s.code ?? "–"}</td>
                    <td>{s.rows.length}</td>
                    <td>{new Set(s.balloons.map((b) => b.pos)).size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button className="btn primary" disabled={!!step} onClick={save}>{t("Save {n} drawings", { n: result.sheets.length })}</button></div>
        </>
      )}
    </div>
  );
}

// ---------- One sheet ----------

function CatalogSheet({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad(() => api(`/catalog/sheets/${enc(id)}`), [id]);
  const tree = useLoad(() => (data ? api(`/catalog/machines/${enc(data.machine.id)}`) : Promise.resolve(null)), [data?.machine.id]);
  const [version, setVersion] = useState("");
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const editor = can(me, "catalog.edit");
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const s = data.sheet;
  const rows: Row[] = data.rows;

  async function placeBalloon(row: Row, spot: { x: number; y: number; w: number; h: number }) {
    try {
      await api(`/catalog/sheets/${enc(id)}/rows`, { method: "PUT", body: { rows: rows.map((r) => (r.id === row.id ? { ...r, hotspots: [...r.hotspots, spot] } : r)) } });
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const all: TreeSheet[] = tree.data?.sheets ?? [];
  const grp = (x: { grp?: string | null; group?: string | null }) => (x.grp ?? x.group ?? "").trim() || "-";
  const siblings = all.filter((x) => x.section === s.section && grp(x) === grp(s)).map((x) => ({ id: x.id, code: x.code, title: x.title }));
  const mm = data.machine;
  const base = `/catalog/m/${mm.id}/catalog`;
  const trail = [
    { label: t("All customers"), to: "/catalog" },
    { label: mm.customer || t("Customer not set"), to: `/catalog/c/${enc(mm.customer || NO_CUSTOMER)}` },
    { label: mm.serial, to: `/catalog/m/${mm.id}` },
    { label: t("Spare parts catalogue"), to: base },
    { label: w(getLang(), SECTION_WORD[s.section as keyof typeof SECTION_WORD] as Word), to: `${base}/${s.section}` },
    ...(s.group ? [{ label: s.group, to: `${base}/${s.section}/${enc(grp(s))}` }] : []),
    ...s.path.map((p: any) => ({ label: [p.code, p.title].filter(Boolean).join(" - "), to: `/catalog/s/${p.id}` })),
    { label: [s.code, s.title].filter(Boolean).join(" - ") || t("Untitled drawing") },
  ];

  return (
    <>
      <Crumbs L={Link as LinkLike} label={t("Where this drawing sits")} items={trail} />
      {placing && <p className="note-inline">{t("Pick a row in the parts list, then click its spot on the drawing. Each click adds a balloon for that row.")}</p>}
      {editing && <SheetEditor sheet={s} rows={rows} machineId={data.machine.id} onSaved={(v) => { if (v) setVersion(v); reload(); }} />}
      <SheetView
        sheet={s}
        rows={rows}
        lang={getLang()}
        version={version}
        fileUrl={(kind) => `/api/catalog/sheets/${enc(id)}/${kind}`}
        onOpenSheet={(sid) => navigate(`/catalog/s/${sid}`)}
        partLink={(code) => <Link to={`/catalog/p/${code}`}>{code}</Link>}
        whereUsed={(code) => <Link to={`/catalog/p/${code}`}>{t("Show where this part is used")}</Link>}
        siblings={siblings}
        subtitle={[s.titleIt, s.page ? t("Manual page {n}", { n: s.page }) : null].filter(Boolean).join(" · ") || undefined}
        extra={(r: any) => (r.notes ? <span className="cv-tag ct-3d" title={t("Staff notes")}>{t("{n} notes", { n: r.notes })}</span> : null)}
        onPlace={placing ? placeBalloon : undefined}
        tools={editor ? (
          <>
            <button className="btn small" aria-pressed={placing} onClick={() => setPlacing(!placing)}>{placing ? t("Done placing") : t("Place balloons")}</button>
            <button className="btn small" onClick={() => setEditing(!editing)}>{editing ? t("Close editing") : t("Edit")}</button>
          </>
        ) : undefined}
      />
    </>
  );
}

function SheetEditor({ sheet, rows, machineId, onSaved }: { sheet: any; rows: Row[]; machineId: string; onSaved: (version?: string) => void }) {
  const [f, setF] = useState({ title: sheet.title, titleIt: sheet.titleIt, code: sheet.code ?? "", section: sheet.section, grp: sheet.group ?? "" });
  const [list, setList] = useState(() => rows.map((r) => ({ ...r, qtyText: r.qty === null ? "" : String(r.qty), nameEn: r.name_en ?? "", nameIt: r.name_it ?? "" })));
  const [busy, setBusy] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>(sheet.model?.meshMap ?? {});
  const tree = useLoad(() => api(`/catalog/machines/${enc(machineId)}`), [machineId]);

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      setBusy(label);
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const saveDetails = () => run(t("Saving…"), async () => {
    await api(`/catalog/sheets/${enc(sheet.id)}`, { method: "PATCH", body: f });
    toast(t("Saved"));
    onSaved();
  });
  const saveRows = () => run(t("Saving…"), async () => {
    for (const r of list) if (!cleanPartCode(r.code)) throw new Error(t("\"{code}\" isn't a Ronchi part number.", { code: r.code }));
    await api(`/catalog/sheets/${enc(sheet.id)}/rows`, {
      method: "PUT",
      body: { rows: list.map((r) => ({ id: r.id, pos: r.pos, code: r.code, qty: r.qtyText === "" ? null : Number(r.qtyText.replace(",", ".")), unit: r.unit, hotspots: r.hotspots, nameEn: r.nameEn, nameIt: r.nameIt })) },
    });
    toast(t("Saved"));
    onSaved();
  });

  async function drawing(file: File) {
    await run(t("Uploading the drawing…"), async () => {
      // Photos and scans are turned into WebP here, so every drawing is stored the same way.
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 4000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("The image couldn't be read."))), "image/webp", 0.85));
      await apiPut(`/catalog/sheets/${enc(sheet.id)}/drawing?w=${c.width}&h=${c.height}`, blob, blob.type);
      toast(t("Drawing saved"));
      onSaved(String(Date.now()));
    });
  }

  async function model(file: File) {
    await run(t("Turning the STEP file into a 3D model. Big assemblies can take a minute…"), async () => {
      let glb: Blob;
      let names: string[] = [];
      if (/\.glb$/i.test(file.name)) glb = file;
      else {
        const { stepToGlb } = await import("../catalog/step");
        const r = await stepToGlb(file);
        glb = r.glb;
        names = r.names;
      }
      setBusy(t("Uploading the 3D model…"));
      await apiPut(`/catalog/sheets/${enc(sheet.id)}/model`, glb, "model/gltf-binary");
      setUnmapped(names.filter((n) => !codeOf(n, map)).slice(0, 300));
      toast(t("3D model saved"));
      onSaved(String(Date.now()));
    });
  }

  const codes = useMemo(() => [...new Set(rows.map((r) => r.code))], [rows]);
  const set = (i: number, k: string, v: string) => setList(list.map((r, j) => (j === i ? { ...r, [k]: k === "code" ? v.toUpperCase() : v } : r)));

  useEffect(() => setMap(sheet.model?.meshMap ?? {}), [sheet.model]);

  return (
    <div className="panel stack">
      {busy && <p role="status">{busy}</p>}
      <h2>{t("Drawing details")}</h2>
      <div className="grid g2">
        <div className="field"><label htmlFor="se-t">{t("Title (English)")}</label><input id="se-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="field"><label htmlFor="se-ti">{t("Title (Italian)")}</label><input id="se-ti" value={f.titleIt} onChange={(e) => setF({ ...f, titleIt: e.target.value })} /></div>
        <div className="field"><label htmlFor="se-c">{t("Assembly part number")}</label><input id="se-c" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
        <div className="field"><label htmlFor="se-g">{t("Group")}</label><input id="se-g" value={f.grp} onChange={(e) => setF({ ...f, grp: e.target.value })} /></div>
        <div className="field"><label htmlFor="se-s">{t("Section")}</label>
          <select id="se-s" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>
            <option value="machine">{t("Machine components")}</option><option value="format">{t("Format components")}</option>
            <option value="elevator">{t("Elevators")}</option><option value="kit">{t("Kits")}</option>
          </select>
        </div>
        <div className="field"><label htmlFor="se-p">{t("Sits inside")}</label>
          <select id="se-p" defaultValue={sheet.path.at(-1)?.id ?? ""} onChange={(e) => run(t("Saving…"), async () => { await api(`/catalog/sheets/${enc(sheet.id)}`, { method: "PATCH", body: { parentId: e.target.value || null } }); onSaved(); })}>
            <option value="">{t("Nothing (top level)")}</option>
            {(tree.data?.sheets ?? []).filter((x: any) => x.id !== sheet.id).map((x: any) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </div>
      </div>
      <div className="row"><button className="btn primary" disabled={!!busy} onClick={saveDetails}>{t("Save details")}</button></div>

      <h2>{t("Picture and 3D")}</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <label className="btn">{t("Replace the drawing picture")}<input hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && drawing(e.target.files[0])} /></label>
        <label className="btn">{t("Add 3D from a STEP or GLB file")}<input hidden type="file" accept=".step,.stp,.glb" onChange={(e) => e.target.files?.[0] && model(e.target.files[0])} /></label>
      </div>
      {unmapped.length > 0 && (
        <div className="stack">
          <Tip id="catalog.3d-names">{t("These 3D part names don't start with a part number. Pick the part each one is, so clicking it in 3D finds it in the list.")}</Tip>
          <div className="tbl" style={{ maxHeight: 280, overflow: "auto" }}>
            <table><tbody>
              {unmapped.map((n) => (
                <tr key={n}><td className="mono">{n}</td><td>
                  <select aria-label={n} value={map[n] ?? ""} onChange={(e) => setMap({ ...map, [n]: e.target.value })}>
                    <option value="">–</option>{codes.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td></tr>
              ))}
            </tbody></table>
          </div>
          <div><button className="btn primary" onClick={() => run(t("Saving…"), async () => { await api(`/catalog/sheets/${enc(sheet.id)}`, { method: "PATCH", body: { meshMap: Object.fromEntries(Object.entries(map).filter(([, v]) => v)) } }); setUnmapped([]); toast(t("Saved")); onSaved(); })}>{t("Save 3D part names")}</button></div>
        </div>
      )}

      <h2>{t("Parts list")}</h2>
      <div className="tbl">
        <table className="edit-rows">
          <thead><tr><th>{t("Pos.")}</th><th>{t("Part number")}</th><th>{t("Qty")}</th><th>{t("Unit")}</th><th>{t("English name")}</th><th>{t("Italian name")}</th><th /></tr></thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.id}>
                <td><input aria-label={t("Pos.")} value={r.pos} onChange={(e) => set(i, "pos", e.target.value)} size={3} /></td>
                <td><input aria-label={t("Part number")} className="mono" value={r.code} onChange={(e) => set(i, "code", e.target.value)} size={12} /></td>
                <td><input aria-label={t("Qty")} inputMode="decimal" value={r.qtyText} onChange={(e) => set(i, "qtyText", e.target.value)} size={4} /></td>
                <td><select aria-label={t("Unit")} value={r.unit ?? ""} onChange={(e) => set(i, "unit", e.target.value)}><option value="">{t("pcs")}</option><option value="m">m</option></select></td>
                <td><input aria-label={t("English name")} value={r.nameEn} onChange={(e) => set(i, "nameEn", e.target.value)} /></td>
                <td><input aria-label={t("Italian name")} value={r.nameIt} onChange={(e) => set(i, "nameIt", e.target.value)} /></td>
                <td><button className="btn small danger" onClick={() => setList(list.filter((_, j) => j !== i))}>{t("Remove")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn" onClick={() => setList([...list, { id: crypto.randomUUID().replace(/-/g, "").slice(0, 22), pos: String(list.length + 1), code: "", qty: 1, qtyText: "1", unit: null, name_en: "", name_it: "", nameEn: "", nameIt: "", wear: false, sub_sheet: null, hotspots: [] }])}>{t("Add a row")}</button>
        <button className="btn primary" disabled={!!busy} onClick={saveRows}>{t("Save parts list")}</button>
        <span className="spacer" />
        <button className="btn danger" onClick={() => {
          if (!confirm(t("Delete this drawing and its parts list? Drawings inside it move up one level."))) return;
          run(t("Deleting…"), async () => { await api(`/catalog/sheets/${enc(sheet.id)}`, { method: "DELETE" }); navigate(`/catalog/m/${machineId}`); });
        }}>{t("Delete drawing")}</button>
      </div>
    </div>
  );
}

// ---------- One part ----------

function CatalogPart({ code, me }: { code: string; me: Me }) {
  const { data, error, reload } = useLoad(() => api(`/catalog/parts/${enc(code)}`), [code]);
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState<any>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const p = data.part;

  return (
    <>
      <PageHead title={p.code} sub={[p.name_en, p.name_it].filter(Boolean).join(" · ") || undefined}>
        {can(me, "catalog.edit") && !edit && (
          <button className="btn" onClick={() => setEdit({ nameEn: p.name_en ?? "", nameIt: p.name_it ?? "", maker: p.maker ?? "", makerPn: p.maker_pn ?? "", wear: !!p.wear })}>{t("Edit")}</button>
        )}
      </PageHead>
      {edit && (
        <form className="panel grid g2" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/catalog/parts/${enc(code)}`, { method: "PATCH", body: edit });
            setEdit(null);
            reload();
            toast(t("Saved"));
          } catch (x) {
            toast((x as Error).message);
          }
        }}>
          <div className="field"><label htmlFor="pe-en">{t("English name")}</label><input id="pe-en" value={edit.nameEn} onChange={(e) => setEdit({ ...edit, nameEn: e.target.value })} /></div>
          <div className="field"><label htmlFor="pe-it">{t("Italian name")}</label><input id="pe-it" value={edit.nameIt} onChange={(e) => setEdit({ ...edit, nameIt: e.target.value })} /></div>
          <div className="field"><label htmlFor="pe-mk">{t("Maker (for bought-in parts)")}</label><input id="pe-mk" value={edit.maker} onChange={(e) => setEdit({ ...edit, maker: e.target.value })} placeholder="SMC, SKF…" /></div>
          <div className="field"><label htmlFor="pe-pn">{t("Maker's part number")}</label><input id="pe-pn" value={edit.makerPn} onChange={(e) => setEdit({ ...edit, makerPn: e.target.value })} /></div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={edit.wear} onChange={(e) => setEdit({ ...edit, wear: e.target.checked })} /> {t("Wears out (suggest it as a spare)")}</label>
          <div className="row"><button className="btn primary" type="submit">{t("Save")}</button><button className="btn" type="button" onClick={() => setEdit(null)}>{t("Cancel")}</button></div>
        </form>
      )}
      <div className="grid g2">
        <div className="panel tbl">
          <h2>{t("Where it's used")}</h2>
          {!data.usedOn.length ? <Empty>{t("Not on any drawing yet.")}</Empty> : (
            <table>
              <thead><tr><th>{t("Machine")}</th><th>{t("Drawing")}</th><th>{t("Pos.")}</th><th>{t("Qty")}</th></tr></thead>
              <tbody>
                {data.usedOn.map((u: any, i: number) => (
                  <tr key={i}>
                    <td className="mono"><Link to={`/catalog/m/${u.machine_id}`}>{u.serial}</Link></td>
                    <td><Link to={`/catalog/s/${u.sheet_id}`}>{u.sheet_title}</Link></td>
                    <td>{u.pos}</td><td>{u.qty ?? "–"}{u.unit === "m" ? " m" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="panel stack">
          <h2>{t("Staff notes")}</h2>
          <Tip id="catalog.staff-notes">{t("Fix tips, what to watch for, where to buy it. Only staff see these; they're never published.")}</Tip>
          <form className="stack" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/catalog/parts/${enc(code)}/notes`, { body: { body: note } });
              setNote("");
              reload();
            } catch (x) {
              toast((x as Error).message);
            }
          }}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("New note")} placeholder={t("Write a note for the team")} required />
            <div><button className="btn primary" type="submit">{t("Add note")}</button></div>
          </form>
          {data.notes.map((n: any) => (
            <div key={n.id} className="post">
              <div className="meta"><b>{n.by_name}</b> · {fmtTime(n.created_at)}
                {(n.user_id === me.id || can(me, "catalog.edit")) && (
                  <button className="linkish" onClick={async () => { await api(`/catalog/notes/${enc(n.id)}`, { method: "DELETE" }).catch((x) => toast(x.message)); reload(); }}>{t("Remove")}</button>
                )}
              </div>
              <div className="body">{n.body}</div>
            </div>
          ))}
        </div>
        {can(me, "partsorders.view") && <PartSoldBefore code={code} me={me} />}
      </div>
    </>
  );
}

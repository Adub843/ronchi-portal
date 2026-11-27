// Inventory: what is on the shelves, part by part and shelf by shelf.
// The stock list (counts, low stock, search, export), a stock list import, and one page per part with
// its shelves, what holds it, and every change ever made to its quantity. Rules: src/shared/inventory.ts.
import { useEffect, useMemo, useState } from "react";
import { toCsv } from "../../../src/shared/csv";
import { ADJUST_REASONS, ISSUE_REASONS, ITEM_LABELS, MAX_COUNT_LINES, MAX_IMPORT, MOVE_LABELS, readStockCsv, type MoveType } from "../../../src/shared/inventory";
import { api, can, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";

type Row = Record<string, any>;
const enc = encodeURIComponent;
const today = () => new Date().toISOString().slice(0, 10);
const n = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString(loc(), { maximumFractionDigits: 3 }));
const money = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString(loc(), { style: "currency", currency: "USD" }));

type View = "all" | "low" | "out" | "reserved" | "reorder";
const VIEWS: Record<View, (i: Row) => boolean> = { all: (i) => i.active, low: (i) => i.low, out: (i) => i.out, reserved: (i) => i.reserved > 0, reorder: (i) => i.to_order != null };

export function Inventory({ me }: { me: Me }) {
  const { data, error, reload } = useLoad<{ items: Row[] }>(() => api("/inventory"));
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const prices = can(me, "inventory.prices");
  const all = data?.items ?? [];
  const counts = useMemo(() => Object.fromEntries((Object.keys(VIEWS) as View[]).map((v) => [v, all.filter(VIEWS[v]).length])) as Record<View, number>, [all]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((i) => (q ? true : VIEWS[view](i)) && words.every((w) => `${i.part_code} ${i.description ?? ""} ${i.shelves ?? ""} ${i.bin ?? ""}`.toLowerCase().includes(w)));
  }, [all, view, q]);
  const value = prices ? all.reduce((s, i) => s + (i.value ?? 0), 0) : null;

  const reorder = view === "reorder" && !q;
  const orderCost = prices && reorder ? shown.reduce((s, i) => s + (i.unit_cost ?? 0) * i.to_order, 0) : null;

  function exportCsv() {
    if (reorder) return download(`reorder-list-${today()}.csv`,
      ["Part number", "Description", "Usual shelf", "On hand", "Held", "Available", "On the way", "Reorder at", "To order", ...(prices ? ["Cost each", "Cost"] : [])],
      shown.map((i) => [i.part_code, i.description ?? "", i.bin ?? "", i.on_hand, i.reserved, i.available, i.incoming, i.reorder_point ?? "", i.to_order, ...(prices ? [i.unit_cost ?? "", i.unit_cost == null ? "" : Math.round(i.unit_cost * i.to_order * 100) / 100] : [])]));
    const head = ["Part number", "Description", "Shelves", "On hand", "Reserved", "Available", "On the way", "Reorder at", "Reorder quantity", ...(prices ? ["Cost each", "Value"] : [])];
    const rows = shown.map((i) => [i.part_code, i.description ?? "", i.shelves ?? "", i.on_hand, i.reserved, i.available, i.incoming, i.reorder_point ?? "", i.reorder_qty ?? "", ...(prices ? [i.unit_cost ?? "", i.value ?? ""] : [])]);
    download(`inventory-${today()}.csv`, head, rows);
  }

  const tiles: { v: View; l: string; warn?: boolean }[] = [
    { v: "all", l: t("Parts in stock") },
    { v: "low", l: t("Low stock"), warn: true },
    { v: "out", l: t("Out of stock"), warn: true },
    { v: "reserved", l: t("Held for orders") },
    { v: "reorder", l: t("To order"), warn: true },
  ];
  return (
    <>
      <PageHead title={t("Inventory")} sub={t("What is on the shelves, where it is, what is held for orders and what is running low.")} tip="inventory.head">
        {can(me, "inventory.adjust") && <button className="btn" onClick={() => navigate("/inventory/import")}>{t("Import a stock list")}</button>}
        {can(me, "inventory.adjust") && <button className="btn" onClick={() => navigate("/inventory/count")}>{t("Count a shelf")}</button>}
        {can(me, "inventory.edit") && <button className="btn primary" onClick={() => setAdding(!adding)}>{t("Put into stock")}</button>}
      </PageHead>
      <ErrorNote error={error} />
      {adding && <div className="panel inv-add"><StockMove me={me} only="receive" onDone={() => { setAdding(false); reload(); }} /></div>}
      <div className={`cp-tiles ${prices ? "six" : "five"}`}>
        {tiles.map((x) => (
          <button key={x.v} type="button" className={`panel cp-tile${view === x.v ? " on" : ""}${x.warn && counts[x.v] ? " warn" : ""}`} aria-pressed={view === x.v} onClick={() => setView(x.v)}>
            <span className="n">{data ? counts[x.v] : "–"}</span><span className="l">{x.l}</span>
          </button>
        ))}
        {prices && <div className="panel cp-tile ms-tile"><span className="n">{data ? money(value) : "–"}</span><span className="l">{t("Stock value")}</span></div>}
      </div>
      <div className="row cp-filters">
        <input className="panel" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search part number, description or shelf")} aria-label={t("Search stock")} />
        <button className="btn" onClick={exportCsv} disabled={!shown.length}>{t("Export CSV")}</button>
      </div>
      <div className="panel tbl">
        {data && !all.length && <Empty>{can(me, "inventory.adjust") ? t("Nothing in stock yet. Press Import a stock list to bring in a spreadsheet, or Put into stock to add one part.") : t("Nothing in stock yet.")}</Empty>}
        {data && !!all.length && !shown.length && !reorder && <Empty>{t("No parts match.")}</Empty>}
        {reorder && !!all.length && !shown.length && <Empty>{t("Nothing needs ordering.")}</Empty>}
        {reorder && !!shown.length && (
          <>
            <p className="muted inv-note">{t("Parts whose free stock, with what is already on the way, has fallen to the reorder point, and parts that orders are waiting for. To order is the part's reorder quantity, or enough to get back above the reorder point.")}{orderCost ? ` ${t("Cost of this list: {amount}.", { amount: money(orderCost) })}` : ""}</p>
            <table className="cp-table">
              <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th className="num">{t("Available")}</th><th className="num">{t("On the way")}</th><th className="num">{t("Reorder at")}</th><th className="num">{t("To order")}</th>{prices && <th className="num">{t("Cost")}</th>}</tr></thead>
              <tbody>
                {shown.slice(0, 500).map((i) => (
                  <tr key={i.part_code} className="click" onClick={() => navigate(`/inventory/${enc(i.part_code)}`)}>
                    <td className="mono"><Link to={`/inventory/${enc(i.part_code)}`}>{i.part_code}</Link></td>
                    <td>{i.description ?? "–"} {i.out && <span className="pill p-acc">{t("Out of stock")}</span>}</td>
                    <td className="num">{n(i.available)}</td><td className="num">{i.incoming ? n(i.incoming) : "–"}</td><td className="num">{n(i.reorder_point)}</td>
                    <td className="num"><strong>{n(i.to_order)}</strong></td>
                    {prices && <td className="num">{i.unit_cost == null ? "–" : money(i.unit_cost * i.to_order)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {!reorder && !!shown.length && (
          <table className="cp-table">
            <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Shelf")}</th><th className="num">{t("On hand")}</th><th className="num">{t("Held")}</th><th className="num">{t("Available")}</th><th className="num">{t("On the way")}</th><th className="num">{t("Reorder at")}</th>{prices && <th className="num">{t("Value")}</th>}</tr></thead>
            <tbody>
              {shown.slice(0, 500).map((i) => (
                <tr key={i.part_code} className="click" onClick={() => navigate(`/inventory/${enc(i.part_code)}`)}>
                  <td className="mono"><Link to={`/inventory/${enc(i.part_code)}`}>{i.part_code}</Link></td>
                  <td>{i.description ?? "–"} {i.out ? <span className="pill p-acc">{t("Out of stock")}</span> : i.low ? <span className="pill p-acc">{t("Low stock")}</span> : null}{!i.active && <span className="pill p-warn">{t("Not kept in stock")}</span>}</td>
                  <td>{i.shelves ?? i.bin ?? "–"}</td>
                  <td className="num">{n(i.on_hand)}</td><td className="num">{i.reserved ? n(i.reserved) : "–"}</td><td className="num"><strong>{n(i.available)}</strong></td>
                  <td className="num">{i.incoming ? n(i.incoming) : "–"}</td><td className="num">{n(i.reorder_point)}</td>
                  {prices && <td className="num">{money(i.value)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shown.length > 500 && <p className="muted">{t("Showing the first 500. Search to narrow the list.")}</p>}
      </div>
    </>
  );
}

function download(name: string, head: string[], rows: unknown[][]) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toCsv(head, rows as never)], { type: "text/csv" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Put in, take out, move or correct: one small form. `only` fixes what it does; `part` and `shelves` come from a part's page. */
function StockMove({ me, part, shelves = [], only, onDone }: { me: Me; part?: Row; shelves?: Row[]; only?: MoveType; onDone: () => void }) {
  const kinds = (["receive", "issue", "move", "adjust"] as const).filter((k) => (k === "adjust" ? can(me, "inventory.adjust") : can(me, "inventory.edit")) && (!only || k === only) && (part || k === "receive"));
  const [type, setType] = useState<MoveType>(kinds[0] ?? "receive");
  const [f, setF] = useState<Row>({ part_code: part?.part_code ?? "", description: "", location: shelves[0]?.location ?? part?.bin ?? "", to_location: "", qty: "", reason: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const known = useLoad<{ shelves: string[] }>(() => api("/inventory/shelves"));
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const onShelf = shelves.find((s) => s.location.toLowerCase() === String(f.location).toLowerCase())?.qty ?? 0;
  if (!kinds.length) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/inventory/move", { body: { ...f, type } });
      toast(t("Saved"));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const reasons = type === "adjust" ? ADJUST_REASONS : type === "issue" ? ISSUE_REASONS : null;
  const labels: Record<string, string> = { receive: t("Put into stock"), issue: t("Take out"), move: t("Move to another shelf"), adjust: t("Correct the count") };
  return (
    <form onSubmit={save} className="stack inv-move">
      {kinds.length > 1 && (
        <div className="seg" role="radiogroup" aria-label={t("What are you doing?")}>
          {kinds.map((k) => <button key={k} type="button" role="radio" aria-checked={type === k} className={type === k ? "on" : ""} onClick={() => setType(k)}>{labels[k]}</button>)}
        </div>
      )}
      <datalist id="inv-shelves">{(known.data?.shelves ?? []).map((s) => <option key={s} value={s} />)}</datalist>
      <div className="grid g2 cp-form">
        {!part && <div className="field"><label htmlFor="inv-code">{t("Part number")}</label><input id="inv-code" className="mono" required autoFocus value={f.part_code} onChange={(e) => set("part_code", e.target.value)} /></div>}
        {!part && <div className="field"><label htmlFor="inv-desc">{t("Description")}</label><input id="inv-desc" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder={t("Left empty, the name comes from the parts catalog")} /></div>}
        <div className="field">
          <label htmlFor="inv-loc">{type === "move" ? t("From shelf") : t("Shelf")}</label>
          {part && shelves.length && type !== "receive" && type !== "adjust"
            ? <select id="inv-loc" value={f.location} onChange={(e) => set("location", e.target.value)}>{shelves.map((s) => <option key={s.location} value={s.location}>{s.location} ({n(s.qty)})</option>)}</select>
            : <input id="inv-loc" required list="inv-shelves" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder={t("e.g. A3-2")} />}
        </div>
        {type === "move" && <div className="field"><label htmlFor="inv-to">{t("To shelf")}</label><input id="inv-to" required list="inv-shelves" value={f.to_location} onChange={(e) => set("to_location", e.target.value)} /></div>}
        <div className="field">
          <label htmlFor="inv-qty">{type === "adjust" ? t("Counted on this shelf (the portal has {n})", { n: n(onShelf) }) : t("Quantity")}</label>
          <input id="inv-qty" required type="number" min={0} step="any" value={f.qty} onChange={(e) => set("qty", e.target.value)} />
        </div>
        {reasons && (
          <div className="field">
            <label htmlFor="inv-reason">{t("Reason")}</label>
            <select id="inv-reason" required={type === "adjust"} value={f.reason} onChange={(e) => set("reason", e.target.value)}>
              <option value="">–</option>
              {reasons.map((r) => <option key={r} value={r}>{t(r)}</option>)}
            </select>
          </div>
        )}
        <div className="field"><label htmlFor="inv-note">{t("Note")}</label><input id="inv-note" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder={type === "issue" ? t("e.g. order or job number") : ""} /></div>
      </div>
      <ErrorNote error={err} />
      <div className="row"><button className="btn primary" type="submit" disabled={busy}>{labels[type]}</button><button className="btn" type="button" onClick={onDone}>{t("Cancel")}</button></div>
    </form>
  );
}

export function InventoryPart({ code, me }: { code: string; me: Me }) {
  const { data, error, reload } = useLoad<{ item: Row; levels: Row[]; moves: Row[]; holding: Row[]; catalogName: string | null }>(() => api(`/inventory/part/${enc(code)}`), [code]);
  const [acting, setActing] = useState(false);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <div className="boot" aria-busy="true" />;
  const i = data.item;
  const prices = can(me, "inventory.prices");
  const canMove = can(me, "inventory.edit") || can(me, "inventory.adjust");
  const box = (label: string, value: string, warn = false) => <div className={`panel cp-tile ms-tile${warn ? " warn" : ""}`}><span className="n">{value}</span><span className="l">{label}</span></div>;
  return (
    <>
      <PageHead title={i.part_code} sub={i.description ?? data.catalogName ?? ""}>
        {can(me, "inventory.adjust") && <button className="btn" onClick={() => setEditing(!editing)}>{t("Edit details")}</button>}
        {canMove && <button className="btn primary" onClick={() => setActing(!acting)}>{t("Change stock")}</button>}
      </PageHead>
      <p className="row inv-pills">
        {i.out ? <span className="pill p-acc">{t("Out of stock")}</span> : i.low ? <span className="pill p-acc">{t("Low stock")}</span> : <span className="pill p-ok">{t("In stock")}</span>}
        {!i.active && <span className="pill p-warn">{t("Not kept in stock")}</span>}
        {can(me, "catalog.view") && <Link to={`/catalog?q=${enc(i.part_code)}`}>{t("Find in the parts catalog")}</Link>}
      </p>
      <div className={`cp-tiles ${prices ? "five" : ""}`}>
        {box(t("On hand"), n(i.on_hand))}
        {box(t("Held for orders"), n(i.reserved))}
        {box(t("Available"), n(i.available), i.low || i.out)}
        {box(t("On the way"), n(i.incoming))}
        {prices && box(t("Stock value"), money(i.value))}
      </div>
      {acting && <div className="panel"><StockMove me={me} part={i} shelves={data.levels} onDone={() => { setActing(false); reload(); }} /></div>}
      {editing && <div className="panel"><ItemEdit me={me} item={i} onDone={(saved) => { setEditing(false); if (saved) reload(); }} /></div>}
      <div className="grid g2 inv-grid">
        <div className="panel tbl">
          <h2>{t("Where it is")}</h2>
          {data.levels.length ? (
            <table><thead><tr><th>{t("Shelf")}</th><th className="num">{t("On hand")}</th></tr></thead>
              <tbody>{data.levels.map((l) => <tr key={l.location}><td>{l.location}</td><td className="num">{n(l.qty)}</td></tr>)}</tbody></table>
          ) : <Empty>{t("None on the shelves.")}</Empty>}
          <dl className="ms-facts inv-facts">
            <div className="ms-fact"><dt>{t(ITEM_LABELS.bin)}</dt><dd>{i.bin ?? "–"}</dd></div>
            <div className="ms-fact"><dt>{t(ITEM_LABELS.reorder_point)}</dt><dd>{n(i.reorder_point)}</dd></div>
            <div className="ms-fact"><dt>{t(ITEM_LABELS.reorder_qty)}</dt><dd>{n(i.reorder_qty)}</dd></div>
            {prices && <div className="ms-fact"><dt>{t(ITEM_LABELS.unit_cost)}</dt><dd>{money(i.unit_cost)}</dd></div>}
          </dl>
          {i.notes && <p className="ms-notes">{i.notes}</p>}
        </div>
        <div className="panel">
          <h2>{t("Held for orders")}</h2>
          {data.holding.length ? (
            <ul className="cp-history">{data.holding.map((o) => <li key={o.id}><Link to={`/parts-orders/${o.id}`} className="mono">{o.number}</Link> {o.customer} <strong>{n(o.qty)}</strong></li>)}</ul>
          ) : <Empty>{i.reserved ? t("{n} held by parts orders.", { n: n(i.reserved) }) : t("No order is holding this part.")}</Empty>}
          <p className="muted">{t("A part is held when a confirmed parts order takes it from our stock, or it came in for that order and has not shipped yet.")}</p>
        </div>
      </div>
      <div className="panel tbl">
        <h2>{t("Every change")}</h2>
        <p className="muted" style={{ margin: "0 12px 8px" }}>{t("Stock changes by itself: checking a delivery in under Shipping and receiving puts its parts on the shelf, and marking a shipment shipped takes them off.")}</p>
        {!data.moves.length ? <Empty>{t("No changes yet.")}</Empty> : (
          <table>
            <thead><tr><th>{t("When")}</th><th>{t("What")}</th><th>{t("Shelf")}</th><th className="num">{t("Change")}</th><th>{t("Reason")}</th><th>{t("Who")}</th></tr></thead>
            <tbody>
              {data.moves.map((m) => (
                <tr key={m.id}><td>{fmtTime(m.at)}</td><td>{t(MOVE_LABELS[m.type as MoveType] ?? m.type)}</td><td>{m.location}</td><td className="num">{m.delta > 0 ? "+" : ""}{n(m.delta)}</td><td>{m.reason ? t(m.reason) : ""}{m.reason && m.note ? " · " : ""}{m.note && m.source_type === "shipment" && can(me, "shipping.view") ? <Link to={`/shipping/${m.source_id}`} className="mono">{m.note}</Link> : m.note}{!m.reason && !m.note ? "–" : ""}</td><td>{m.who ?? "–"}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ItemEdit({ me, item, onDone }: { me: Me; item: Row; onDone: (saved: boolean) => void }) {
  const prices = can(me, "inventory.prices");
  const [f, setF] = useState<Row>({ description: item.description ?? "", bin: item.bin ?? "", reorder_point: item.reorder_point ?? "", reorder_qty: item.reorder_qty ?? "", unit_cost: item.unit_cost ?? "", notes: item.notes ?? "", active: item.active });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const b = { ...f };
    if (!prices) delete b.unit_cost;
    try {
      await api(`/inventory/part/${enc(item.part_code)}`, { method: "PATCH", body: b });
      toast(t("Saved"));
      onDone(true);
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  const input = (k: "description" | "bin" | "reorder_point" | "reorder_qty" | "unit_cost", extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field" key={k}><label htmlFor={`inv-${k}`}>{t(ITEM_LABELS[k])}</label><input id={`inv-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} {...extra} /></div>
  );
  return (
    <form onSubmit={save} className="stack">
      <div className="grid g2 cp-form">
        {input("description")}
        {input("bin")}
        {input("reorder_point", { type: "number", min: 0, step: "any" })}
        {input("reorder_qty", { type: "number", min: 0, step: "any" })}
        {prices && input("unit_cost", { type: "number", min: 0, step: "0.01" })}
        <div className="field"><label htmlFor="inv-active">{t(ITEM_LABELS.active)}</label>
          <select id="inv-active" value={f.active ? "1" : "0"} onChange={(e) => set("active", e.target.value === "1")}><option value="1">{t("Yes")}</option><option value="0">{t("No")}</option></select></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="inv-notes">{t(ITEM_LABELS.notes)}</label><textarea id="inv-notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>
      <ErrorNote error={err} />
      <div className="row"><button className="btn primary" type="submit">{t("Save")}</button><button className="btn" type="button" onClick={() => onDone(false)}>{t("Cancel")}</button></div>
    </form>
  );
}

/** Bring in a stock list from a spreadsheet saved as CSV: the opening stock, or a full recount. */
export function InventoryImport({ me }: { me: Me }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const read = useMemo(() => (csv.trim() ? readStockCsv(csv) : null), [csv]);
  if (!can(me, "inventory.adjust")) return <ErrorNote error="Your role doesn't allow this." />;
  async function go() {
    if (!read?.rows.length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ lines: number; changed: number }>("/inventory/import", { body: { rows: read.rows } });
      toast(t("Imported {a} lines, {b} changed the stock", { a: r.lines, b: r.changed }));
      navigate("/inventory");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <PageHead title={t("Import a stock list")} sub={t("Bring in a spreadsheet of what is on the shelves. Each line sets the quantity of one part on one shelf.")} />
      <div className="panel stack">
        <p>{t("Save the spreadsheet as CSV. It needs a Part number column and a Quantity column. Shelf, Description, Reorder point, Reorder quantity and Cost are optional. Up to {n} lines at a time.", { n: MAX_IMPORT })}</p>
        <input type="file" accept=".csv,text/csv" aria-label={t("Choose a CSV file")} onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} />
        <textarea rows={8} className="mono" aria-label={t("Or paste the list here")} placeholder={"Part number,Description,Shelf,Quantity,Reorder point\nCM000240,Washer,A3-2,40,10"} value={csv} onChange={(e) => setCsv(e.target.value)} />
        {read && <p><strong>{t("{n} lines ready to import.", { n: read.rows.length })}</strong></p>}
        {!!read?.problems.length && <ul className="inv-problems">{read.problems.slice(0, 20).map((p) => <li key={p}>{p}</li>)}</ul>}
        <ErrorNote error={err} />
        <div className="row">
          <button className="btn primary" disabled={busy || !read?.rows.length} onClick={go}>{t("Import")}</button>
          <button className="btn" onClick={() => navigate("/inventory")}>{t("Cancel")}</button>
        </div>
      </div>
    </div>
  );
}

/** Stock count, one shelf at a time: type what is on the shelf, and every part that differs is corrected as Counted. */
export function InventoryCount({ me }: { me: Me }) {
  const known = useLoad<{ shelves: string[] }>(() => api("/inventory/shelves"));
  const [shelf, setShelf] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  const [found, setFound] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ counted: number; changed: number; differences: Row[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setErr(null);
    api<{ shelf: string; lines: Row[] }>(`/inventory/count?shelf=${enc(open)}`)
      .then((r) => { if (live) setLines(r.lines.map((l) => ({ ...l, counted: "" }))); })
      .catch((x) => { if (live) setErr((x as Error).message); });
    return () => { live = false; };
  }, [open]);

  if (!can(me, "inventory.adjust")) return <ErrorNote error="Your role doesn't allow this." />;
  const typed = lines.filter((l) => String(l.counted).trim() !== "");
  const differs = typed.filter((l) => Number(l.counted) !== l.qty).length;
  const set = (code: string, v: string) => setLines(lines.map((l) => (l.part_code === code ? { ...l, counted: v } : l)));

  function addFound(e: React.FormEvent) {
    e.preventDefault();
    const code = found.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) return;
    if (!lines.some((l) => l.part_code === code)) setLines([...lines, { part_code: code, description: null, qty: 0, counted: "", added: true }]);
    setFound("");
  }
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ counted: number; changed: number; differences: Row[] }>("/inventory/count", { body: { location: open, note, lines: typed.map((l) => ({ part_code: l.part_code, qty: l.counted })) } });
      setDone(r);
      toast(t("Count saved"));
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const again = () => { setDone(null); setOpen(null); setShelf(""); setLines([]); setNote(""); };

  return (
    <div className="stack">
      <PageHead title={t("Count a shelf")} sub={t("Count one shelf at a time. Type what is really there, and the portal corrects every part that differs.")} />
      {done ? (
        <div className="panel stack">
          <p><strong>{t("{a} parts counted on shelf {shelf}, {b} corrected.", { a: done.counted, shelf: open ?? "", b: done.changed })}</strong></p>
          {!!done.differences.length && (
            <table className="cp-table inv-count">
              <thead><tr><th>{t("Part number")}</th><th className="num">{t("The portal had")}</th><th className="num">{t("Counted")}</th><th className="num">{t("Change")}</th></tr></thead>
              <tbody>{done.differences.map((d) => <tr key={d.part_code}><td className="mono"><Link to={`/inventory/${enc(d.part_code)}`}>{d.part_code}</Link></td><td className="num">{n(d.from)}</td><td className="num">{n(d.to)}</td><td className="num">{d.to > d.from ? "+" : ""}{n(Math.round((d.to - d.from) * 1000) / 1000)}</td></tr>)}</tbody>
            </table>
          )}
          <div className="row"><button className="btn primary" onClick={again}>{t("Count another shelf")}</button><button className="btn" onClick={() => navigate("/inventory")}>{t("Back to Inventory")}</button></div>
        </div>
      ) : !open ? (
        <form className="panel stack" onSubmit={(e) => { e.preventDefault(); if (shelf.trim()) setOpen(shelf.trim()); }}>
          <datalist id="inv-count-shelves">{(known.data?.shelves ?? []).map((s) => <option key={s} value={s} />)}</datalist>
          <div className="field"><label htmlFor="inv-count-shelf">{t("Which shelf are you counting?")}</label><input id="inv-count-shelf" required autoFocus list="inv-count-shelves" value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder={t("e.g. A3-2")} /></div>
          {!!known.data?.shelves.length && <div className="row inv-shelf-picks">{known.data.shelves.slice(0, 60).map((s) => <button key={s} type="button" className="btn" onClick={() => setOpen(s)}>{s}</button>)}</div>}
          <div className="row"><button className="btn primary" type="submit">{t("Start the count")}</button><button className="btn" type="button" onClick={() => navigate("/inventory")}>{t("Cancel")}</button></div>
        </form>
      ) : (
        <div className="panel stack">
          <h2>{t("Shelf {shelf}", { shelf: open })}</h2>
          <p className="muted">{t("Type the number you counted beside each part. A part you leave empty is not changed. Type 0 for a part that is not there. Up to {n} parts at a time.", { n: MAX_COUNT_LINES })}</p>
          {!lines.length && !err && <Empty>{t("The portal has nothing on this shelf. Add the parts you find below.")}</Empty>}
          {!!lines.length && (
            <div className="inv-scroll"><table className="cp-table inv-count">
              <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th className="num">{t("The portal has")}</th><th className="num">{t("Counted")}</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.part_code} className={String(l.counted).trim() !== "" && Number(l.counted) !== l.qty ? "inv-differs" : ""}>
                    <td className="mono">{l.part_code}</td><td>{l.description ?? (l.added ? t("Found on the shelf") : "–")}</td><td className="num">{n(l.qty)}</td>
                    <td className="num"><input type="number" min={0} step="any" inputMode="decimal" value={l.counted} onChange={(e) => set(l.part_code, e.target.value)} aria-label={t("Counted, {part}", { part: l.part_code })} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <form className="row inv-found" onSubmit={addFound}>
            <input className="mono" value={found} onChange={(e) => setFound(e.target.value)} placeholder={t("Part number found on this shelf")} aria-label={t("Part number found on this shelf")} />
            <button className="btn" type="submit">{t("Add to the count")}</button>
          </form>
          <div className="field"><label htmlFor="inv-count-note">{t("Note")}</label><input id="inv-count-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. November count")} /></div>
          <p><strong>{t("{a} counted, {b} differ from the portal.", { a: typed.length, b: differs })}</strong></p>
          <ErrorNote error={err} />
          <div className="row"><button className="btn primary" disabled={busy || !typed.length} onClick={save}>{t("Save the count")}</button><button className="btn" onClick={again}>{t("Pick another shelf")}</button></div>
        </div>
      )}
    </div>
  );
}

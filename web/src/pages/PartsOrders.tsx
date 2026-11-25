// Parts orders (/parts-orders): spare parts quotes and the orders they become, with the sales tracker.
//   /parts-orders          the list, tiles and tracker numbers
//   /parts-orders/new      start a quote
//   /parts-orders/<id>     one quote or order: lines, shipments, notes (save as you type), files, history
// No money anywhere (a portal hard rule): parts, quantities, people and dates only.
import { useMemo, useState } from "react";
import { isQuote, LOST_REASONS, PO_LABELS, type PoField, type PoStatus as Stored } from "../../../src/shared/parts-orders";
import { api, can, fmtTime, type Me } from "../api";
import { monthShort, shortDay, todayLocal } from "../components/dates";
import { downloadCsv, FileBox } from "../components/FileBox";
import { AutoNotes, History, ShipPill } from "../components/orders";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { t } from "../i18n";
import { navigate } from "../router";

interface Order {
  id: string; quote_number: string; rev: string; quote_rev: number; order_number: string | null; status: Stored; shown: string;
  customer: string; contact: string | null; machine: string | null; machine_id: string | null; customer_po: string | null; salesperson: string | null;
  follow_up: string | null; valid_until: string | null; promised_date: string | null; hold_reason: string | null;
  created_at: string; booked_at: string | null; updated_at: string; lines: number; qty: number; qty_shipped: number; backordered: number;
  late: boolean; expired: boolean; due: boolean; shipped_on: string | null;
}
interface Kpis { openQuotes: number; openOrders: number; late: number; backorderedLines: number; followUpsDue: number; conversion: number | null; daysQuoteToOrder: number | null; daysOrderToShip: number | null; onTime: number | null; bookings: { month: string; count: number }[] }

const enc = encodeURIComponent;
const label = (f: PoField) => t(PO_LABELS[f]);

export function PartsOrders({ me, path }: { me: Me; path: string }) {
  const m = /^\/parts-orders\/([A-Za-z0-9_-]+)$/.exec(path);
  if (m?.[1] === "new") return <NewQuote me={me} />;
  if (m) return <OrderPage key={m[1]} id={m[1]!} me={me} />;
  return <OrderList me={me} />;
}

// ---------- pills ----------

export function PoPills({ o }: { o: Pick<Order, "shown" | "late" | "expired" | "hold_reason"> }) {
  const cls = /^(Shipped|Closed)$/.test(o.shown) ? "p-ok" : /^(Lost|Cancelled)$/.test(o.shown) ? "p-mute" : o.shown === "Partially shipped" ? "p-warn" : "p-info";
  return (
    <span className="po-pills">
      <span className={`pill ${cls}`}>{t(o.shown)}</span>
      {o.late && <span className="pill p-acc">{t("Late")}</span>}
      {o.expired && <span className="pill p-warn">{t("Expired")}</span>}
      {o.hold_reason && <span className="pill p-warn">{t("On hold")}</span>}
    </span>
  );
}

/** Q-2026-0004 (rev B) for a quote, SO-2026-0012 once booked. */
function Num({ o }: { o: Pick<Order, "order_number" | "quote_number" | "rev" | "quote_rev"> }) {
  if (o.order_number) return <span className="mono">{o.order_number}</span>;
  return <span className="mono">{o.quote_number}{o.quote_rev > 0 && <span className="muted"> {t("rev {r}", { r: o.rev })}</span>}</span>;
}

// ---------- the list ----------

type View = "quotes" | "orders" | "late" | "backordered" | "due" | "done" | "all";
const openOrder = (o: Order) => o.status === "booked" && o.shown !== "Shipped";

function OrderList({ me }: { me: Me }) {
  const { data, error } = useLoad<{ orders: Order[]; kpis: Kpis }>(() => api("/parts-orders"));
  const [view, setView] = useState<View>("orders");
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const all = data?.orders ?? [];
  const k = data?.kpis;
  const people = useMemo(() => [...new Set(all.map((o) => o.salesperson ?? "").filter(Boolean))].sort(), [all]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((o) => {
      if (who && o.salesperson !== who) return false;
      if (view === "quotes" && !isQuote(o.status)) return false;
      if (view === "orders" && !openOrder(o)) return false;
      if (view === "late" && !o.late) return false;
      if (view === "backordered" && !(openOrder(o) && o.backordered)) return false;
      if (view === "due" && !o.due) return false;
      if (view === "done" && !(o.shown === "Shipped" || ["closed", "lost", "cancelled"].includes(o.status))) return false;
      if (!words.length) return true;
      const text = [o.quote_number, o.order_number, o.customer, o.contact, o.machine, o.customer_po, o.salesperson].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [all, view, q, who]);

  const tiles: { v: View; n: number | undefined; l: string; warn?: boolean }[] = [
    { v: "quotes", n: k?.openQuotes, l: t("Open quotes") },
    { v: "orders", n: k?.openOrders, l: t("Open orders") },
    { v: "late", n: k?.late, l: t("Late (past promised date)"), warn: true },
    { v: "backordered", n: k?.backorderedLines, l: t("Backordered lines"), warn: true },
    { v: "due", n: k?.followUpsDue, l: t("Follow-ups due"), warn: true },
  ];

  return (
    <>
      <PageHead title={t("Parts orders")} sub={t("Spare parts quotes and orders, from the customer's request to shipped.")} tip="parts-orders.head">
        <button className="btn" onClick={() => downloadCsv("/parts-orders/export", `parts-orders-${todayLocal()}.csv`)} disabled={!all.length}>{t("Export CSV")}</button>
        {can(me, "psales.edit") && <Link to="/parts-orders/new" className="btn primary">{t("New quote")}</Link>}
      </PageHead>
      <ErrorNote error={error} />
      <div className="cp-tiles five">
        {tiles.map((x) => (
          <button key={x.v} type="button" className={`panel cp-tile${view === x.v ? " on" : ""}${x.warn && x.n ? " warn" : ""}`} aria-pressed={view === x.v} onClick={() => setView(view === x.v ? "all" : x.v)}>
            <span className="n">{x.n ?? "–"}</span><span className="l">{x.l}</span>
          </button>
        ))}
      </div>
      {k && <Tracker k={k} />}
      <div className="row cp-filters">
        <input className="panel" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search number, customer, machine or PO")} aria-label={t("Search parts orders")} />
        <select className="panel" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("Salesperson")}>
          <option value="">{t("Everyone")}</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="panel" value={view} onChange={(e) => setView(e.target.value as View)} aria-label={t("Show")}>
          <option value="all">{t("All {n}", { n: all.length })}</option>
          <option value="quotes">{t("Open quotes")}</option>
          <option value="orders">{t("Open orders")}</option>
          <option value="late">{t("Late")}</option>
          <option value="backordered">{t("Backordered lines")}</option>
          <option value="due">{t("Follow-ups due")}</option>
          <option value="done">{t("Shipped, closed or lost")}</option>
        </select>
      </div>
      <div className="panel tbl">
        {data && !all.length && <Empty>{can(me, "psales.edit") ? t("No parts quotes yet. Press New quote when a customer asks for parts.") : t("No parts quotes yet.")}</Empty>}
        {data && !!all.length && !shown.length && <Empty>{t("Nothing matches.")}</Empty>}
        {!!shown.length && (
          <table className="cp-table po-table">
            <thead>
              <tr><th>{t("Number")}</th><th>{t("Customer")}</th><th className="hide-sm">{t("Machine")}</th><th>{t("Status")}</th><th className="hide-sm">{t("Shipped")}</th><th className="hide-sm">{t("Salesperson")}</th><th className="hide-sm">{t("Next date")}</th></tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td className="nowrap"><Link to={`/parts-orders/${o.id}`}><Num o={o} /></Link></td>
                  <td>{o.customer}{o.customer_po && <small className="muted po-sub">{t("PO {po}", { po: o.customer_po })}</small>}</td>
                  <td className="mono hide-sm">{o.machine ?? "–"}</td>
                  <td><PoPills o={o} /></td>
                  <td className="hide-sm nowrap">{o.status === "booked" || o.status === "closed" ? `${o.qty_shipped} / ${o.qty}` : <span className="muted">{t("{n} lines", { n: o.lines })}</span>}</td>
                  <td className="hide-sm">{o.salesperson ?? "–"}</td>
                  <td className="nowrap hide-sm">{nextDate(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!!shown.length && <p className="muted">{t("Showing {n} of {total}.", { n: shown.length, total: all.length })}</p>}
    </>
  );
}

/** The date that matters next: follow-up for a quote, promised ship date for an order. */
function nextDate(o: Order) {
  if (isQuote(o.status)) {
    if (!o.follow_up) return <span className="muted">–</span>;
    return <span className={o.due ? "pill p-acc" : ""} title={t("Follow up")}>{t("Follow up {day}", { day: shortDay(o.follow_up) })}</span>;
  }
  if (openOrder(o)) return o.promised_date ? <span className={o.late ? "pill p-acc" : ""} title={t("Promised ship date")}>{t("Due {day}", { day: shortDay(o.promised_date) })}</span> : <span className="muted">–</span>;
  return <span className="muted">{o.shipped_on ? t("Shipped {day}", { day: shortDay(o.shipped_on) }) : "–"}</span>;
}

/** The sales tracker: conversion, speed, on-time and bookings by month. Counts and days only. */
function Tracker({ k }: { k: Kpis }) {
  const max = Math.max(1, ...k.bookings.map((b) => b.count));
  const pct = (v: number | null) => (v === null ? "–" : `${v}%`);
  const days = (v: number | null) => (v === null ? "–" : t("{n} days", { n: v }));
  return (
    <div className="panel po-tracker">
      <div className="po-kpis">
        <div><span className="n">{pct(k.conversion)}</span><span className="l">{t("Quotes won (12 months)")}</span></div>
        <div><span className="n">{days(k.daysQuoteToOrder)}</span><span className="l">{t("Average quote to order")}</span></div>
        <div><span className="n">{days(k.daysOrderToShip)}</span><span className="l">{t("Average order to shipped")}</span></div>
        <div><span className="n">{pct(k.onTime)}</span><span className="l">{t("Shipped on time")}</span></div>
      </div>
      <div className="po-bars">
        <span className="po-bars-title">{t("Orders booked each month")}</span>
        <div className="po-bars-row" role="list">
          {k.bookings.map((b) => (
            <div key={b.month} className="po-bar" role="listitem" aria-label={`${monthShort(b.month)}: ${b.count}`}>
              <span className="v">{b.count || ""}</span>
              <span className="b" style={{ height: `${Math.round((b.count / max) * 100)}%` }} />
              <span className="m">{monthShort(b.month)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- lines editor (new quote, and changing lines) ----------

interface EditLine { id?: string; part_code: string; description: string; qty: string; backorder: boolean; min: number }
const blankLine = (): EditLine => ({ part_code: "", description: "", qty: "1", backorder: false, min: 0 });
const toBody = (lines: EditLine[]) => lines.filter((l) => l.part_code.trim() || l.description.trim()).map((l) => ({ id: l.id, part_code: l.part_code, description: l.description, qty: Number(l.qty), backorder: l.backorder }));

function LinesEditor({ lines, setLines }: { lines: EditLine[]; setLines: (l: EditLine[]) => void }) {
  const set = (i: number, patch: Partial<EditLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="po-lines-edit">
      <div className="po-line head" aria-hidden="true"><span>{t("Part code")}</span><span>{t("Description")}</span><span>{t("Qty")}</span><span>{t("Backorder")}</span><span /></div>
      {lines.map((l, i) => (
        <div className="po-line" key={l.id ?? `n${i}`}>
          <input className="code mono" value={l.part_code} onChange={(e) => set(i, { part_code: e.target.value })} placeholder={t("Part code")} aria-label={t("Line {n} part code", { n: i + 1 })} maxLength={60} />
          <input className="desc" value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder={t("Description")} aria-label={t("Line {n} description", { n: i + 1 })} maxLength={300} />
          <input className="qty" type="number" min={Math.max(1, l.min)} max={100000} step={1} inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label={t("Line {n} quantity", { n: i + 1 })} />
          <label className="bo"><input type="checkbox" checked={l.backorder} onChange={(e) => set(i, { backorder: e.target.checked })} /> <span>{t("Backorder")}</span></label>
          <button type="button" className="linkish x" disabled={l.min > 0} title={l.min > 0 ? t("On a shipment, so it can't be removed") : t("Remove line")} aria-label={t("Remove line {n}", { n: i + 1 })} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div><button type="button" className="btn small" onClick={() => setLines([...lines, blankLine()])}>{t("Add line")}</button></div>
    </div>
  );
}

// ---------- new quote ----------

const HEAD_FIELDS: PoField[] = ["customer", "contact", "machine", "salesperson", "follow_up", "valid_until"];
const DATE_FIELDS = new Set<PoField>(["follow_up", "valid_until", "promised_date"]);

function NewQuote({ me }: { me: Me }) {
  const machines = useLoad<{ machines: { serial: string; customer: string | null }[] }>(() => (can(me, "machines.view") ? api("/machines") : Promise.resolve({ machines: [] })));
  const [f, setF] = useState<Record<string, string>>({ salesperson: me.name });
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can(me, "psales.edit")) return <ErrorNote error="Your role doesn't allow this." />;
  const list = machines.data?.machines ?? [];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string }>("/parts-orders", { body: { ...f, notes, lines: toBody(lines) } });
      toast(t("Quote started"));
      navigate(`/parts-orders/${r.id}`);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (k: PoField) => (
    <div className="field" key={k}>
      <label htmlFor={`po-${k}`}>{label(k)}</label>
      <input id={`po-${k}`} type={DATE_FIELDS.has(k) ? "date" : "text"} value={f[k] ?? ""} list={k === "machine" ? "po-machines" : k === "customer" ? "po-customers" : undefined} required={k === "customer"} autoFocus={k === "customer"}
        placeholder={k === "machine" ? "3069MB" : k === "contact" ? t("Name, email or phone") : undefined}
        onChange={(e) => {
          const v = e.target.value;
          const next = { ...f, [k]: v };
          // Picking a machine fills in its customer when none is typed yet.
          if (k === "machine" && !f.customer) { const mm = list.find((x) => x.serial === v.toUpperCase()); if (mm?.customer) next.customer = mm.customer; }
          setF(next);
        }} />
    </div>
  );
  return (
    <>
      <PageHead title={t("New quote")} sub={t("Who it's for and the parts they asked for. Everything can be changed later.")} />
      <form className="stack" onSubmit={save}>
        <div className="panel grid g3 cp-form">
          {HEAD_FIELDS.map(field)}
          <datalist id="po-machines">{list.map((m) => <option key={m.serial} value={m.serial}>{m.customer ?? ""}</option>)}</datalist>
          <datalist id="po-customers">{[...new Set(list.map((m) => m.customer).filter(Boolean))].map((c) => <option key={c} value={c!} />)}</datalist>
        </div>
        <div className="panel">
          <h2>{t("Lines")}</h2>
          <LinesEditor lines={lines} setLines={setLines} />
        </div>
        <div className="panel field">
          <label htmlFor="po-notes">{t("Notes")}</label>
          <textarea id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} placeholder={t("Calls, emails, what the customer said…")} />
        </div>
        <ErrorNote error={err} />
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>{t("Start quote")}</button>
          <Link to="/parts-orders" className="btn">{t("Cancel")}</Link>
        </div>
      </form>
    </>
  );
}

// ---------- one quote or order ----------

interface Line { id: string; line_no: number; part_code: string | null; description: string | null; qty: number; shipped: number; allocated: number; remaining: number; backorder: boolean; backordered: boolean }
type DetailOrder = Order & { notes: string | null; reason: string | null; request_id: string | null; request_number: string | null; revision: number; moves: string[] };
interface Detail {
  order: DetailOrder;
  lines: Line[];
  revisions: { rev: string; saved_at: string; saved_by: string | null; lines: { part_code: string | null; description: string | null; qty: number }[] }[];
  files: any[];
  shipments: { id: string; number: string; status: string; ship_date: string | null; tracking: string | null; tracking_url: string | null; carrier: string | null; service: string | null; lines: { part_code: string | null; description: string | null; qty: number }[] }[];
  history: { at: string; action: string; who: string | null; detail: any }[];
}

type Panel = null | "edit" | "lines" | "book" | "lost" | "cancel";

function OrderPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad<Detail>(() => api(`/parts-orders/${enc(id)}`), [id]);
  const [panel, setPanel] = useState<Panel>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const o = data.order;
  const edit = can(me, "psales.edit");
  const moves = new Set(o.moves);
  const quote = isQuote(o.status);
  const canShip = can(me, "ship.edit") && o.status === "booked" && data.lines.some((l) => l.qty - l.shipped - l.allocated > 0);

  async function move(to: string, extra: Record<string, unknown> = {}, done = t("Saved")) {
    try {
      await api(`/parts-orders/${enc(id)}/status`, { body: { revision: o.revision, to, ...extra } });
      toast(done);
      setPanel(null);
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  async function revise() {
    try {
      const r = await api<{ rev: string }>(`/parts-orders/${enc(id)}/revise`, { body: { revision: o.revision } });
      toast(t("Now revision {r}. The earlier one is kept below.", { r: r.rev }));
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }

  const title = o.order_number ?? o.quote_number;
  const sub = [o.customer, o.machine, o.order_number ? t("from quote {q}", { q: o.quote_number }) : o.quote_rev > 0 ? t("rev {r}", { r: o.rev }) : null].filter(Boolean).join(" · ");
  return (
    <>
      <PageHead title={title} sub={sub}>
        <PoPills o={o} />
        {edit && !panel && (
          <>
            {moves.has("sent") && <button className="btn" onClick={() => move("sent", {}, t("Marked sent"))}>{t("Mark quote sent")}</button>}
            {quote && <button className="btn" onClick={revise}>{t("Revise quote")}</button>}
            {moves.has("lost") && <button className="btn" onClick={() => setPanel("lost")}>{t("Mark lost")}</button>}
            {moves.has("booked") && o.status !== "closed" && <button className="btn primary" onClick={() => setPanel("book")}>{t("Book order")}</button>}
            {o.status === "lost" && <button className="btn" onClick={() => move("quote", {}, t("Reopened"))}>{t("Reopen quote")}</button>}
            {o.status === "closed" && <button className="btn" onClick={() => move("booked", {}, t("Reopened"))}>{t("Reopen order")}</button>}
            {o.status === "booked" && o.qty_shipped === 0 && !data.lines.some((l) => l.allocated) && <button className="btn danger" onClick={() => setPanel("cancel")}>{t("Cancel order")}</button>}
            {o.status === "booked" && o.shown === "Shipped" && <button className="btn" onClick={() => move("closed", {}, t("Order closed"))}>{t("Close order")}</button>}
          </>
        )}
        {canShip && !panel && <Link to={`/shipping/ship/${o.id}`} className="btn primary">{t("Ship")}</Link>}
      </PageHead>
      {panel === "book" && <BookPanel o={o} onBook={(po, day) => move("booked", { customer_po: po, promised_date: day || null }, t("Booked. It's now an order."))} onCancel={() => setPanel(null)} />}
      {panel === "lost" && <ReasonPanel title={t("Why was it lost?")} choices={LOST_REASONS} button={t("Mark lost")} onSave={(r) => move("lost", { reason: r }, t("Marked lost"))} onCancel={() => setPanel(null)} />}
      {panel === "cancel" && <ReasonPanel title={t("Why is the order cancelled?")} button={t("Cancel order")} onSave={(r) => move("cancelled", { reason: r }, t("Order cancelled"))} onCancel={() => setPanel(null)} />}
      {o.hold_reason && <p className="err" role="status">{t("On hold")}: {o.hold_reason}</p>}
      {(o.status === "lost" || o.status === "cancelled") && o.reason && <p className="muted">{o.status === "lost" ? t("Lost because: {why}", { why: o.reason }) : t("Cancelled because: {why}", { why: o.reason })}</p>}

      {panel === "edit" ? (
        <HeaderForm o={o} onDone={() => { setPanel(null); reload(); }} onCancel={() => setPanel(null)} />
      ) : (
        <div className="panel">
          <div className="row po-head">
            <h2>{o.order_number ? t("Order") : t("Quote")}</h2>
            <span className="spacer" />
            {edit && o.status !== "cancelled" && !panel && <button className="btn small" onClick={() => setPanel("edit")}>{t("Edit")}</button>}
          </div>
          <dl className="po-dl">
            <div><dt>{label("customer")}</dt><dd>{o.customer}</dd></div>
            <div><dt>{label("contact")}</dt><dd>{o.contact ?? "–"}</dd></div>
            <div><dt>{label("machine")}</dt><dd>{o.machine ? (o.machine_id && can(me, "machines.view") ? <Link to={`/machines/${o.machine_id}`} className="mono">{o.machine}</Link> : <span className="mono">{o.machine}</span>) : "–"}</dd></div>
            <div><dt>{label("customer_po")}</dt><dd className="mono">{o.customer_po ?? "–"}</dd></div>
            <div><dt>{label("salesperson")}</dt><dd>{o.salesperson ?? "–"}</dd></div>
            {quote ? (
              <>
                <div><dt>{label("follow_up")}</dt><dd>{o.follow_up ? <span className={o.due ? "pill p-acc" : ""}>{shortDay(o.follow_up)}</span> : "–"}</dd></div>
                <div><dt>{label("valid_until")}</dt><dd>{shortDay(o.valid_until)}</dd></div>
              </>
            ) : (
              <div><dt>{t("Booked")}</dt><dd>{shortDay(o.booked_at)}</dd></div>
            )}
            <div><dt>{label("promised_date")}</dt><dd>{o.promised_date ? <span className={o.late ? "pill p-acc" : ""}>{shortDay(o.promised_date)}</span> : "–"}</dd></div>
            {o.shipped_on && <div><dt>{t("Shipped")}</dt><dd>{shortDay(o.shipped_on)}</dd></div>}
            {o.request_id && <div><dt>{t("Customer's request")}</dt><dd>{can(me, "quotes.manage") ? <Link to={`/quotes/${o.request_id}`} className="mono">{o.request_number}</Link> : <span className="mono">{o.request_number}</span>}</dd></div>}
          </dl>
        </div>
      )}

      <div className="panel">
        <div className="row po-head">
          <h2>{t("Lines")}</h2>
          <span className="spacer" />
          {edit && !["lost", "closed", "cancelled"].includes(o.status) && panel !== "lines" && <button className="btn small" onClick={() => setPanel("lines")}>{t("Change lines")}</button>}
        </div>
        {panel === "lines" ? (
          <LinesForm o={o} lines={data.lines} onDone={() => { setPanel(null); reload(); }} onCancel={() => setPanel(null)} />
        ) : data.lines.length ? (
          <div className="tbl">
            <table className="po-lines">
              <thead><tr><th>#</th><th>{t("Part code")}</th><th>{t("Description")}</th><th className="num">{t("Qty")}</th>{!quote && <><th className="num">{t("Shipped")}</th><th className="num">{t("Left")}</th></>}<th /></tr></thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{l.line_no}</td>
                    <td className="mono nowrap">{l.part_code ?? "–"}</td>
                    <td>{l.description ?? "–"}</td>
                    <td className="num">{l.qty}</td>
                    {!quote && <><td className="num">{l.shipped}</td><td className="num">{l.remaining}</td></>}
                    <td className="nowrap">{l.backordered ? <span className="pill p-warn">{t("Backordered")}</span> : l.allocated ? <span className="pill p-info">{t("{n} being packed", { n: l.allocated })}</span> : l.backorder && l.remaining ? <span className="pill p-info">{t("On order")}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{t("No lines yet. Add the parts the customer asked for.")}</Empty>}
      </div>

      {!quote && (
        <div className="panel">
          <h2>{t("Shipments")}</h2>
          {data.shipments.length ? (
            <ul className="po-ships">
              {data.shipments.map((s) => (
                <li key={s.id}>
                  <div className="row">
                    {can(me, "ship.view") ? <Link to={`/shipping/out/${s.id}`} className="mono">{s.number}</Link> : <span className="mono">{s.number}</span>}
                    <ShipPill status={s.status} />
                    <span className="muted">{[s.carrier, s.service].filter(Boolean).join(" ")}</span>
                    {s.tracking && (s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noopener noreferrer" className="mono">{s.tracking}</a> : <span className="mono">{s.tracking}</span>)}
                    <span className="spacer" />
                    <span className="muted">{shortDay(s.ship_date)}</span>
                  </div>
                  <span className="muted small1">{s.lines.map((l) => `${l.part_code ?? l.description} × ${l.qty}`).join(", ")}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>{t("Nothing shipped yet.")}</Empty>}
        </div>
      )}

      <div className="grid g2">
        <div className="panel">
          <h2>{t("Notes")}</h2>
          <AutoNotes id={o.id} initial={o.notes} editable={edit && o.status !== "cancelled"} path="/parts-orders" />
        </div>
        <div className="panel">
          <h2>{t("Files")}</h2>
          <FileBox me={me} base="/parts-orders" uploadTo={`/parts-orders/${enc(o.id)}/files`} files={data.files} canEdit={edit} onChange={reload} empty={t("No files yet. Add the customer's PO, drawings or photos.")} />
        </div>
      </div>

      {!!data.revisions.length && (
        <details className="panel">
          <summary><strong>{t("Earlier revisions ({n})", { n: data.revisions.length })}</strong></summary>
          {data.revisions.map((r) => (
            <div key={r.rev} className="po-rev">
              <p className="muted">{t("Revision {r}, kept {when} by {who}", { r: r.rev, when: fmtTime(r.saved_at), who: r.saved_by ?? t("Someone") })}</p>
              <ul>{r.lines.map((l, i) => <li key={i}><span className="mono">{l.part_code ?? ""}</span> {l.description ?? ""} × {l.qty}</li>)}</ul>
            </div>
          ))}
        </details>
      )}

      <History items={data.history} />
    </>
  );
}

function BookPanel({ o, onBook, onCancel }: { o: Order; onBook: (po: string, day: string) => void; onCancel: () => void }) {
  const [po, setPo] = useState(o.customer_po ?? "");
  const [day, setDay] = useState(o.promised_date ?? "");
  return (
    <form className="panel grid g3 cp-form" onSubmit={(e) => { e.preventDefault(); onBook(po, day); }}>
      <p style={{ gridColumn: "1 / -1", margin: 0 }}>{t("The customer's PO turns this quote into an order with its own order number. Its lines and history come along.")}</p>
      <div className="field"><label htmlFor="bk-po">{label("customer_po")}</label><input id="bk-po" value={po} onChange={(e) => setPo(e.target.value)} required autoFocus maxLength={80} /></div>
      <div className="field"><label htmlFor="bk-day">{label("promised_date")}</label><input id="bk-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
      <div className="row" style={{ alignSelf: "end" }}>
        <button className="btn primary" type="submit">{t("Book order")}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

function ReasonPanel({ title, choices, button, onSave, onCancel }: { title: string; choices?: string[]; button: string; onSave: (reason: string) => void; onCancel: () => void }) {
  const [pick, setPick] = useState(choices?.[0] ?? "");
  const [more, setMore] = useState("");
  return (
    <form className="panel grid g3 cp-form" onSubmit={(e) => { e.preventDefault(); onSave([choices ? t(pick) : "", more.trim()].filter(Boolean).join(": ")); }}>
      <p style={{ gridColumn: "1 / -1", margin: 0 }}><strong>{title}</strong></p>
      {choices && (
        <div className="field"><label htmlFor="rs-pick">{t("Reason")}</label>
          <select id="rs-pick" value={pick} onChange={(e) => setPick(e.target.value)}>{choices.map((c) => <option key={c} value={c}>{t(c)}</option>)}</select>
        </div>
      )}
      <div className="field"><label htmlFor="rs-more">{choices ? t("More detail (optional)") : t("Reason")}</label><input id="rs-more" value={more} onChange={(e) => setMore(e.target.value)} required={!choices} maxLength={250} /></div>
      <div className="row" style={{ alignSelf: "end" }}>
        <button className="btn primary" type="submit">{button}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Back")}</button>
      </div>
    </form>
  );
}

function HeaderForm({ o, onDone, onCancel }: { o: DetailOrder; onDone: () => void; onCancel: () => void }) {
  const fields: PoField[] = ["customer", "contact", "machine", "customer_po", "salesperson", "follow_up", "valid_until", "promised_date", "hold_reason"];
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((k) => [k, o[k] ?? ""])));
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/parts-orders/${enc(o.id)}`, { method: "PATCH", body: { ...f, revision: o.revision } });
      toast(t("Saved"));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <form className="panel grid g3 cp-form" onSubmit={save}>
      {fields.map((k) => (
        <div className="field" key={k} style={k === "hold_reason" ? { gridColumn: "1 / -1" } : undefined}>
          <label htmlFor={`he-${k}`}>{label(k)}</label>
          <input id={`he-${k}`} type={DATE_FIELDS.has(k) ? "date" : "text"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={k === "customer"} placeholder={k === "hold_reason" ? t("Leave empty unless the order is on hold") : undefined} />
        </div>
      ))}
      <ErrorNote error={err} />
      <div className="row" style={{ gridColumn: "1 / -1" }}>
        <button className="btn primary" type="submit">{t("Save")}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

function LinesForm({ o, lines, onDone, onCancel }: { o: DetailOrder; lines: Line[]; onDone: () => void; onCancel: () => void }) {
  const [rows, setRows] = useState<EditLine[]>(() => lines.length
    ? lines.map((l) => ({ id: l.id, part_code: l.part_code ?? "", description: l.description ?? "", qty: String(l.qty), backorder: l.backorder, min: l.shipped + l.allocated }))
    : [blankLine()]);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/parts-orders/${enc(o.id)}/lines`, { method: "PUT", body: { revision: o.revision, lines: toBody(rows) } });
      toast(t("Saved"));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      <LinesEditor lines={rows} setLines={setRows} />
      <ErrorNote error={err} />
      <div className="row">
        <button className="btn primary" type="submit">{t("Save lines")}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

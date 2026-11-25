// Parts orders: spare parts sales from the customer's first ask to the invoice.
// List (counts, search, export), the parts still to order from each supplier, sales reports, and one page
// per order with its lines, totals, shipments and history. Fields and steps: src/shared/parts-orders.ts.
import { useMemo, useState } from "react";
import { toCsv } from "../../../src/shared/csv";
import {
  isOpen, lineLate, ORDER_LABELS, orderLate, PRIORITIES, PRIORITY_LABELS, SOURCE_LABELS, SOURCES, STATUS_LABELS, STATUSES, SUPPLIERS,
  type OrderField, type Status,
} from "../../../src/shared/parts-orders";
import { api, can, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";

type Row = Record<string, any>;
const today = () => new Date().toISOString().slice(0, 10);
const enc = encodeURIComponent;
const L = (f: OrderField) => t(ORDER_LABELS[f]);

export function money(n: number | null | undefined): string {
  if (n == null) return "–";
  return n.toLocaleString(loc(), { style: "currency", currency: "USD" });
}
function day(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(loc(), { month: "short", day: "numeric", year: "numeric" });
}

export function PoStatus({ status, late, priority }: { status: string; late?: boolean; priority?: string }) {
  const s = status as Status;
  const cls = late ? "p-acc" : ["shipped", "invoiced", "closed"].includes(s) ? "p-ok" : ["on_hold", "lost", "cancelled"].includes(s) ? "p-warn" : "p-info";
  return (
    <span className="row po-pills">
      <span className={`pill ${cls}`}>{t(STATUS_LABELS[s] ?? status)}{late ? ` · ${t("Late")}` : ""}</span>
      {priority && priority !== "normal" && <span className="pill p-acc">{t(PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] ?? priority)}</span>}
    </span>
  );
}

const late = (o: Row) => orderLate(o as { status: string; promised: string | null }, today()) || (isOpen(o.status) && !!o.next_eta && o.next_eta < today() && ["ordered", "sourcing"].includes(o.status));

type View = "open" | "quotes" | "waiting" | "ready" | "invoice" | "late" | "all";
const VIEWS: Record<View, (o: Row) => boolean> = {
  open: (o) => isOpen(o.status),
  quotes: (o) => o.status === "inquiry" || o.status === "quoted",
  waiting: (o) => o.status === "ordered" || o.status === "sourcing",
  ready: (o) => o.status === "ready",
  invoice: (o) => o.status === "shipped" && !o.invoice_no,
  late,
  all: () => true,
};

export function PartsOrders({ me, tab }: { me: Me; tab?: string }) {
  const reports = can(me, "partsorders.reports");
  const tabs = [
    { id: "", label: t("Orders") },
    { id: "to-order", label: t("To order from suppliers") },
    ...(reports ? [{ id: "reports", label: t("Sales reports") }] : []),
  ];
  const cur = tabs.some((x) => x.id === tab) ? tab ?? "" : "";
  return (
    <>
      <PageHead title={t("Parts orders")} sub={t("Every spare parts order, from the customer's first ask to the invoice.")} tip="parts-orders.head">
        {can(me, "partsorders.add") && <button className="btn primary" onClick={() => navigate("/parts-orders/new")}>{t("New order")}</button>}
      </PageHead>
      <div className="seg po-tabs" role="tablist" aria-label={t("Parts orders")}>
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={cur === x.id} className={cur === x.id ? "on" : ""} onClick={() => navigate(x.id ? `/parts-orders/${x.id}` : "/parts-orders")}>{x.label}</button>
        ))}
      </div>
      {cur === "to-order" ? <ToOrder me={me} /> : cur === "reports" ? <Reports /> : <OrderList me={me} />}
    </>
  );
}

function OrderList({ me }: { me: Me }) {
  const { data, error } = useLoad<{ orders: Row[] }>(() => api("/parts-orders"));
  const [view, setView] = useState<View>("open");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const prices = can(me, "partsorders.prices");
  const all = data?.orders ?? [];
  const counts = useMemo(() => Object.fromEntries((Object.keys(VIEWS) as View[]).map((v) => [v, all.filter(VIEWS[v]).length])) as Record<View, number>, [all]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((o) => {
      if (!VIEWS[view](o)) return false;
      if (status && o.status !== status) return false;
      const text = [o.number, o.customer, o.contact, o.machine, o.customer_po, o.quote_no, o.invoice_no, o.salesperson, o.parts_text].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [all, view, status, q]);

  function exportCsv() {
    const head = ["Order", "Customer", "Machine", "Status", "Priority", "Salesperson", "Customer PO", "Quote #", "Invoice #", "Promised", "Lines", "Lines here", "Lines shipped", ...(prices ? ["Total"] : [])];
    const rows = shown.map((o) => [o.number, o.customer, o.machine ?? "", STATUS_LABELS[o.status as Status] ?? o.status, o.priority, o.salesperson ?? "", o.customer_po ?? "", o.quote_no ?? "", o.invoice_no ?? "", o.promised ?? "", o.lines, o.received, o.shipped, ...(prices ? [o.total] : [])]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCsv(head, rows)], { type: "text/csv" }));
    a.download = `parts-orders-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const tiles: { v: View; l: string; warn?: boolean }[] = [
    { v: "quotes", l: t("Open quotes") },
    { v: "waiting", l: t("Waiting on parts") },
    { v: "ready", l: t("Ready to ship") },
    { v: "invoice", l: t("Shipped, not invoiced") },
    { v: "late", l: t("Late"), warn: true },
  ];

  return (
    <>
      <ErrorNote error={error} />
      <div className="cp-tiles five">
        {tiles.map((x) => (
          <button key={x.v} type="button" className={`panel cp-tile${view === x.v ? " on" : ""}${x.warn && counts[x.v] ? " warn" : ""}`} aria-pressed={view === x.v} onClick={() => setView(view === x.v ? "open" : x.v)}>
            <span className="n">{data ? counts[x.v] : "–"}</span><span className="l">{x.l}</span>
          </button>
        ))}
      </div>
      <div className="row cp-filters">
        <input className="panel" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search order, customer, machine, PO or part number")} aria-label={t("Search orders")} />
        <select className="panel" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("Status")}>
          <option value="">{t("Any status")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_LABELS[s])}</option>)}
        </select>
        <button type="button" className={`btn${view === "open" ? " primary" : ""}`} onClick={() => setView("open")}>{t("Open {n}", { n: counts.open ?? 0 })}</button>
        <button type="button" className={`btn${view === "all" ? " primary" : ""}`} onClick={() => setView("all")}>{t("All {n}", { n: all.length })}</button>
        <button className="btn" onClick={exportCsv} disabled={!shown.length}>{t("Export CSV")}</button>
      </div>
      <div className="panel tbl">
        {data && !all.length && <Empty>{can(me, "partsorders.add") ? t("No parts orders yet. Press New order, or open a quote request and press Make parts order.") : t("No parts orders yet.")}</Empty>}
        {data && !!all.length && !shown.length && <Empty>{t("No orders match.")}</Empty>}
        {!!shown.length && (
          <table className="cp-table">
            <thead>
              <tr><th>{t("Order")}</th><th>{L("customer")}</th><th>{L("machine")}</th><th>{t("Status")}</th><th>{t("Parts")}</th><th>{L("promised")}</th>{prices && <th className="num">{t("Total")}</th>}</tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td className="mono nowrap"><Link to={`/parts-orders/${o.id}`}>{o.number}</Link></td>
                  <td>{o.customer}{o.customer_po && <small className="muted block">{t("PO")} {o.customer_po}</small>}</td>
                  <td className="mono">{o.machine ?? "–"}</td>
                  <td><PoStatus status={o.status} late={late(o)} priority={o.priority} /></td>
                  <td className="nowrap">{o.lines ? t("{a} of {b} here", { a: o.received, b: o.lines }) : "–"}{o.next_eta && isOpen(o.status) && o.received < o.lines && <small className="muted block">{t("Next arrives {d}", { d: day(o.next_eta) })}</small>}</td>
                  <td className="nowrap">{day(o.promised)}</td>
                  {prices && <td className="num">{money(o.total)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!!shown.length && <p className="muted">{t("Showing {n} of {total} orders.", { n: shown.length, total: all.length })}</p>}
    </>
  );
}

/** Lines the customer has said yes to that nobody has ordered yet, by supplier. */
function ToOrder({ me }: { me: Me }) {
  const { data, error } = useLoad<{ lines: Row[] }>(() => api("/parts-orders/to-order"));
  const prices = can(me, "partsorders.prices");
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const l of data?.lines ?? []) m.set(l.supplier || "", [...(m.get(l.supplier || "") ?? []), l]);
    return [...m.entries()];
  }, [data]);
  function copy(supplier: string, lines: Row[]) {
    const text = [`${supplier || t("No supplier chosen")}:`, ...lines.map((l) => `${l.part_code ?? ""}\t${l.description ?? ""}\t${t("Qty")} ${l.qty}\t${l.number} ${l.customer}${l.machine ? ` ${l.machine}` : ""}${l.drop_ship ? `\t${t("Drop ship")}` : ""}`)].join("\n");
    navigator.clipboard?.writeText(text).then(() => toast(t("Copied. Paste it into your order email.")), () => toast(t("Couldn't copy.")));
  }
  return (
    <>
      <p className="muted">{t("Parts on orders the customer has said yes to that still need a supplier PO. Order them, then type the supplier PO on each line and the order moves on by itself.")}</p>
      <ErrorNote error={error} />
      {data && !groups.length && <div className="panel"><Empty>{t("Nothing waiting to be ordered.")}</Empty></div>}
      {groups.map(([supplier, lines]) => (
        <div className="panel tbl" key={supplier}>
          <div className="row"><h2>{supplier || t("No supplier chosen")}</h2><span className="spacer" /><button className="btn" onClick={() => copy(supplier, lines)}>{t("Copy list")}</button></div>
          <table className="cp-table">
            <thead><tr><th>{t("Part number")}</th><th>{t("Description")}</th><th className="num">{t("Qty")}</th><th>{t("Order")}</th><th>{L("needed_by")}</th>{prices && <th className="num">{t("Cost")}</th>}</tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.part_code ?? "–"}</td>
                  <td>{l.description ?? "–"}{!!l.drop_ship && <small className="pill p-info">{t("Drop ship")}</small>}</td>
                  <td className="num">{l.qty}</td>
                  <td className="nowrap"><Link to={`/parts-orders/${l.order_id}`}>{l.number}</Link> {l.customer}{l.priority !== "normal" && <> <span className="pill p-acc">{t(PRIORITY_LABELS[l.priority as keyof typeof PRIORITY_LABELS])}</span></>}</td>
                  <td className="nowrap">{day(l.needed_by)}</td>
                  {prices && <td className="num">{money(l.unit_cost)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function Reports() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const { data, error } = useLoad<Row>(() => api(`/parts-orders/reports?from=${from}&to=${to}`), [from, to]);
  const max = Math.max(1, ...(data?.byMonth ?? []).map((m: Row) => m.total));
  const total = (data?.byMonth ?? []).reduce((s: number, m: Row) => s + m.total, 0);
  const winRate = data && data.quotes.won + data.quotes.lost ? Math.round((data.quotes.won / (data.quotes.won + data.quotes.lost)) * 100) : null;
  const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(loc(), { month: "short", year: "numeric" });
  return (
    <>
      <div className="row cp-filters">
        <label className="row">{t("From")} <input className="panel" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="row">{t("To")} <input className="panel" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
      </div>
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="cp-tiles five">
            <div className="panel cp-tile"><span className="n">{money(total)}</span><span className="l">{t("Booked sales")}</span></div>
            <div className="panel cp-tile"><span className="n">{data.byMonth.reduce((s: number, m: Row) => s + m.orders, 0)}</span><span className="l">{t("Orders won")}</span></div>
            <div className="panel cp-tile"><span className="n">{winRate == null ? "–" : `${winRate}%`}</span><span className="l">{t("Quotes won (of won or lost)")}</span></div>
            <div className="panel cp-tile"><span className="n">{data.turnaround.days ?? "–"}</span><span className="l">{t("Days from PO to shipped, on average")}</span></div>
            <div className={`panel cp-tile${data.late ? " warn" : ""}`}><span className="n">{data.late}</span><span className="l">{t("Open orders past their promised date")}</span></div>
          </div>
          <div className="grid g2">
            <div className="panel">
              <h2>{t("Sales by month")}</h2>
              {!data.byMonth.length && <Empty>{t("No sales in these dates.")}</Empty>}
              <ul className="po-bars">
                {data.byMonth.map((m: Row) => (
                  <li key={m.month}><span className="po-bar-l">{monthName(m.month)}</span><span className="po-bar"><span style={{ width: `${(m.total / max) * 100}%` }} /></span><span className="num">{money(m.total)}</span></li>
                ))}
              </ul>
            </div>
            <ReportTable title={t("Top customers")} rows={data.byCustomer} cols={[["customer", t("Customer")], ["orders", t("Orders")], ["total", t("Sales")]]} />
            <ReportTable title={t("Most sold parts")} rows={data.topParts} cols={[["part_code", t("Part number")], ["description", t("Description")], ["qty", t("Qty")], ["total", t("Sales")]]} />
            <ReportTable title={t("By salesperson")} rows={data.bySalesperson.map((r: Row) => ({ ...r, salesperson: r.salesperson || t("Not set") }))} cols={[["salesperson", t("Salesperson")], ["orders", t("Orders")], ["total", t("Sales")]]} />
          </div>
          <p className="muted">{t("Booked sales count each order on the day the customer's PO came in, after discount and with freight. Lost and cancelled orders are left out.")}</p>
        </>
      )}
    </>
  );
}

function ReportTable({ title, rows, cols }: { title: string; rows: Row[]; cols: [string, string][] }) {
  return (
    <div className="panel tbl">
      <h2>{title}</h2>
      {!rows.length ? <Empty>{t("No sales in these dates.")}</Empty> : (
        <table>
          <thead><tr>{cols.map(([k, l]) => <th key={k} className={k === "total" || k === "qty" || k === "orders" ? "num" : undefined}>{l}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(([k]) => <td key={k} className={k === "total" || k === "qty" || k === "orders" ? "num" : k === "part_code" ? "mono" : undefined}>{k === "total" ? money(r[k]) : r[k] ?? "–"}</td>)}</tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

// ---------- One order ----------

/** The one sentence at the top of an order: where it is and what happens next. */
function whereItIs(o: Row, lines: Row[]): string {
  const left = lines.filter((l) => !/stock/i.test(l.supplier ?? "") && l.qty_received < l.qty && !(l.drop_ship && l.supplier_po));
  const nextEta = left.map((l) => l.eta).filter(Boolean).sort()[0];
  switch (o.status as Status) {
    case "inquiry": return t("New request. Next: send the customer a quote.");
    case "quoted": return o.quote_valid ? t("Quote sent, good until {d}. Next: the customer's PO.", { d: day(o.quote_valid) }) : t("Quote sent. Next: the customer's PO.");
    case "ordered": return t("The customer's PO is in. Next: order the parts from the supplier.");
    case "sourcing": return left.length ? (nextEta ? t("Waiting on {n} parts. Next one arrives {d}.", { n: left.length, d: day(nextEta) }) : t("Waiting on {n} parts, no arrival date yet.", { n: left.length })) : t("Parts ordered.");
    case "ready": return t("Everything is here. Next: ship it.");
    case "shipped": return o.invoice_no ? t("Shipped and invoiced.") : t("Shipped. Next: invoice it in QuickBooks and type the invoice number here.");
    case "invoiced": return t("Invoiced. Close it when it's paid.");
    case "closed": return t("Closed.");
    case "on_hold": return t("On hold.");
    case "lost": return o.lost_reason ? t("Lost: {why}", { why: o.lost_reason }) : t("Lost.");
    default: return t("Cancelled.");
  }
}

export function PartsOrderPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad<Row>(() => api(`/parts-orders/${enc(id)}`), [id]);
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const o = data.order;
  const lines: Row[] = data.lines;
  const edit = can(me, "partsorders.edit");
  const prices = can(me, "partsorders.prices");

  async function setStatus(s: string) {
    try {
      await api(`/parts-orders/${enc(id)}`, { method: "PATCH", body: { revision: o.revision, status: s } });
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  async function copy() {
    try {
      const r = await api<{ id: string; number: string }>(`/parts-orders/${enc(id)}/copy`, { body: {} });
      toast(t("Made {n}", { n: r.number }));
      navigate(`/parts-orders/${r.id}`);
    } catch (x) {
      toast((x as Error).message);
    }
  }
  async function remove() {
    if (!sure) {
      setSure(true);
      toast(t("Press Remove again to remove this order. It stays in the record but is no longer listed."));
      return;
    }
    try {
      await api(`/parts-orders/${enc(id)}`, { method: "DELETE" });
      toast(t("Order removed"));
      navigate("/parts-orders");
    } catch (x) {
      toast((x as Error).message);
    }
  }

  if (editing) return <OrderEdit me={me} order={o} lines={lines} onDone={(saved) => { setEditing(false); if (saved) { reload(); toast(t("Saved")); } }} />;

  const show = (k: OrderField) => {
    const v = o[k];
    if (v == null || v === "") return <span className="muted">–</span>;
    if (k === "machine") return o.machine_id ? <Link to={`/machines/${o.machine_id}`} className="mono">{v}</Link> : <span className="mono">{v}</span>;
    if (k === "contact_email") return <a href={`mailto:${v}?subject=${enc(`${o.number}${o.customer_po ? ` / PO ${o.customer_po}` : ""}`)}`}>{v}</a>;
    if (k === "contact_phone") return <a href={`tel:${String(v).replace(/[^\d+]/g, "")}`}>{v}</a>;
    if (k === "needed_by" || k === "promised" || k === "quote_valid") return day(v);
    if (k === "source") return t(SOURCE_LABELS[v as keyof typeof SOURCE_LABELS] ?? v);
    if (k === "priority") return t(PRIORITY_LABELS[v as keyof typeof PRIORITY_LABELS] ?? v);
    if (k === "freight") return money(v);
    if (k === "discount_pct") return `${v}%`;
    return <span style={{ whiteSpace: "pre-wrap" }}>{v}</span>;
  };
  const dl = (keys: OrderField[]) => <dl className="cp-dl">{keys.map((k) => <div key={k}><dt>{L(k)}</dt><dd>{show(k)}</dd></div>)}</dl>;
  const shipOk = !!me.permissions.includes("shipping.edit") || !!me.permissions.includes("shipping.view");

  return (
    <>
      <PageHead title={`${o.number} · ${o.customer}`} sub={[o.machine, o.customer_po && `PO ${o.customer_po}`, o.quote_request_no && t("from quote request {n}", { n: o.quote_request_no })].filter(Boolean).join(" · ") || undefined}>
        {edit ? (
          <select value={o.status} aria-label={t("Status")} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_LABELS[s])}</option>)}
          </select>
        ) : <PoStatus status={o.status} />}
        {edit && <button className="btn" onClick={() => setEditing(true)}>{t("Edit")}</button>}
        {can(me, "partsorders.add") && <button className="btn" onClick={copy}>{t("Order again")}</button>}
        {shipOk && isOpen(o.status) && <Link to={`/shipping/new?source=parts_order&id=${enc(o.id)}`} className="btn">{t("Ship this order")}</Link>}
        {can(me, "partsorders.remove") && <button className="btn danger" onClick={remove}>{sure ? t("Yes, remove") : t("Remove")}</button>}
      </PageHead>
      <div className={`panel po-where${orderLate(o as { status: string; promised: string | null }, today()) ? " late" : ""}`}>
        <PoStatus status={o.status} late={orderLate(o as { status: string; promised: string | null }, today())} priority={o.priority} />
        <span>{whereItIs(o, lines)}</span>
        <span className="spacer" />
        <span className="muted">{t("{a} of {b} lines here, {c} shipped", { a: o.progress.received, b: o.progress.lines, c: o.progress.shipped })}</span>
      </div>
      <div className="panel tbl">
        <h2>{t("Parts")}</h2>
        {!lines.length ? <Empty>{edit ? t("No parts on this order yet. Press Edit to add them.") : t("No parts on this order yet.")}</Empty> : (
          <table className="cp-table po-lines">
            <thead>
              <tr>
                <th>{t("Part number")}</th><th>{t("Description")}</th><th className="num">{t("Qty")}</th>
                {prices && <><th className="num">{t("Price")}</th><th className="num">{t("Line total")}</th></>}
                <th>{t("Supplier")}</th><th>{t("Supplier PO")}</th><th>{t("Arrives")}</th><th className="num">{t("Here")}</th><th className="num">{t("Shipped")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const isLate = lineLate(l as any, today()) && !/stock/i.test(l.supplier ?? "");
                return (
                  <tr key={l.id}>
                    <td className="mono">{l.part_code ? <Link to={`/catalog/p/${enc(l.part_code)}`}>{l.part_code}</Link> : "–"}</td>
                    <td>{l.description ?? "–"}{l.note && <small className="muted block">{l.note}</small>}{l.drop_ship && <small className="pill p-info">{t("Drop ship")}</small>}</td>
                    <td className="num">{l.qty}</td>
                    {prices && <><td className="num">{money(l.unit_price)}</td><td className="num">{l.unit_price == null ? "–" : money(l.qty * l.unit_price)}</td></>}
                    <td>{l.supplier ?? "–"}</td>
                    <td className="mono">{l.supplier_po ?? "–"}</td>
                    <td className={`nowrap${isLate ? " po-late" : ""}`}>{day(l.eta)}{isLate && ` · ${t("Late")}`}</td>
                    <td className="num">{/stock/i.test(l.supplier ?? "") ? t("Stock") : `${l.qty_received}/${l.qty}`}</td>
                    <td className="num">{l.qty_shipped}/{l.qty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {prices && data.totals && !!lines.length && (
          <dl className="cp-dl po-totals">
            <div><dt>{t("Parts")}</dt><dd className="num">{money(data.totals.parts)}</dd></div>
            {!!data.totals.discount && <div><dt>{t("Discount")} ({o.discount_pct}%)</dt><dd className="num">−{money(data.totals.discount)}</dd></div>}
            {!!data.totals.freight && <div><dt>{L("freight")}</dt><dd className="num">{money(data.totals.freight)}</dd></div>}
            <div><dt><strong>{t("Total")}</strong></dt><dd className="num"><strong>{money(data.totals.total)}</strong></dd></div>
            {data.totals.margin != null && <div><dt>{t("Margin")}</dt><dd className={`num${(data.totals.marginPct ?? 0) < 20 ? " po-late" : ""}`}>{money(data.totals.margin)} ({data.totals.marginPct}%)</dd></div>}
            {!data.totals.priced && <div><dt /><dd className="muted">{t("Some lines have no price yet.")}</dd></div>}
          </dl>
        )}
      </div>
      <div className="grid g2">
        <div className="panel"><h2>{t("Customer")}</h2>{dl(["customer", "contact", "contact_email", "contact_phone", "machine", "ship_to"])}</div>
        <div className="panel"><h2>{t("Order")}</h2>{dl(["salesperson", "source", "priority", "quote_no", "quote_valid", "customer_po", "needed_by", "promised", ...(o.status === "lost" ? ["lost_reason" as const] : [])])}</div>
        <div className="panel"><h2>{t("Shipping and billing")}</h2>{dl(["ship_method", "tracking", "invoice_no", ...(prices ? (["discount_pct", "freight"] as OrderField[]) : [])])}</div>
        <div className="panel"><h2>{L("notes")}</h2><p style={{ whiteSpace: "pre-wrap" }}>{o.notes || <span className="muted">{t("No notes yet.")}</span>}</p></div>
      </div>
      {!!data.shipments.length && (
        <div className="panel tbl">
          <h2>{t("Shipments")}</h2>
          <table><tbody>
            {data.shipments.map((s: Row) => (
              <tr key={s.id}><td className="mono"><Link to={`/shipping/${s.id}`}>{s.number}</Link></td><td>{s.direction === "in" ? t("Coming in") : t("Going out")}</td><td>{s.status}</td><td>{s.carrier ?? ""} {s.tracking ?? ""}</td></tr>
            ))}
          </tbody></table>
        </div>
      )}
      <div className="panel">
        <h2>{t("History")}</h2>
        {!data.history.length && <Empty>{t("No changes yet.")}</Empty>}
        <ul className="cp-history">
          {data.history.map((h: Row, i: number) => (
            <li key={i}>
              <span className="muted">{fmtTime(h.at)}</span> <strong>{h.who ?? t("Someone")}</strong>{" "}
              {h.action === "parts_order.create" ? t("added this order") : h.action === "parts_order.remove" ? t("removed this order") : t("changed")}
              {h.changes && (
                <ul>
                  {Object.entries(h.changes as Record<string, [unknown, unknown]>).map(([k, [a, b]]) => (
                    <li key={k}>{histLabel(k)}: {a != null && <><s className="muted">{histValue(k, a)}</s> → </>}{histValue(k, b)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

const histLabel = (k: string) => k === "status" ? t("Status") : k === "lines" ? t("Parts") : k === "quote_request" ? t("Quote request") : k === "copied_from" ? t("Copied from") : k in ORDER_LABELS ? L(k as OrderField) : k;
const histValue = (k: string, v: unknown) => v == null || v === "" ? "–" : k === "status" ? t(STATUS_LABELS[v as Status] ?? String(v)) : String(v);

// ---------- New order and editing ----------

const FORM_FIELDS: OrderField[] = ["customer", "contact", "contact_email", "contact_phone", "machine", "customer_po", "quote_no", "quote_valid", "salesperson", "source", "priority", "needed_by", "promised", "ship_method", "tracking", "invoice_no"];
const emptyLine = (): Row => ({ part_code: "", description: "", qty: 1, unit_price: "", unit_cost: "", supplier: "", supplier_po: "", eta: "", drop_ship: false, qty_received: 0, qty_shipped: 0, note: "" });

export function NewPartsOrder({ me }: { me: Me }) {
  return <OrderEdit me={me} onDone={() => navigate("/parts-orders")} />;
}

function OrderEdit({ me, order, lines: start, onDone }: { me: Me; order?: Row; lines?: Row[]; onDone: (saved: boolean) => void }) {
  const prices = can(me, "partsorders.prices");
  const [f, setF] = useState<Row>(() => {
    const out: Row = { status: order?.status ?? "inquiry" };
    for (const k of [...FORM_FIELDS, "ship_to", "notes", "lost_reason", "discount_pct", "freight"] as OrderField[]) out[k] = order?.[k] ?? (k === "priority" ? "normal" : "");
    return out;
  });
  const [lines, setLines] = useState<Row[]>(() => (start?.length ? start.map((l) => ({ ...l, unit_price: l.unit_price ?? "", unit_cost: l.unit_cost ?? "" })) : [emptyLine()]));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const setLine = (i: number, k: string, v: unknown) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const keep = lines.filter((l) => String(l.part_code).trim() || String(l.description).trim());
    const bodyLines = keep.map((l) => {
      const out: Row = { ...l };
      if (!prices) { delete out.unit_price; delete out.unit_cost; }
      return out;
    });
    const b: Row = { ...f, lines: bodyLines };
    if (!prices) { delete b.discount_pct; delete b.freight; }
    try {
      if (order) {
        await api(`/parts-orders/${enc(order.id)}`, { method: "PATCH", body: { ...b, revision: order.revision } });
        onDone(true);
      } else {
        const r = await api<{ id: string; number: string }>("/parts-orders", { body: b });
        toast(t("Made {n}", { n: r.number }));
        navigate(`/parts-orders/${r.id}`);
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = (k: OrderField, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field" key={k}>
      <label htmlFor={`po-${k}`}>{L(k)}</label>
      <input id={`po-${k}`} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} type="text" {...extra} />
    </div>
  );

  return (
    <form onSubmit={save} className="stack">
      <PageHead title={order ? t("Edit {n}", { n: order.number }) : t("New parts order")} />
      <div className="panel grid g2 cp-form">
        {input("customer", { required: true, autoFocus: !order })}
        <div className="field">
          <label htmlFor="po-status">{t("Status")}</label>
          <select id="po-status" value={f.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_LABELS[s])}</option>)}
          </select>
        </div>
        {input("contact")}
        {input("contact_email", { type: "email" })}
        {input("contact_phone", { type: "tel" })}
        {input("machine", { placeholder: "4222TP" })}
        {input("customer_po")}
        {input("quote_no")}
        {input("quote_valid", { type: "date" })}
        {input("salesperson")}
        <div className="field">
          <label htmlFor="po-source">{L("source")}</label>
          <select id="po-source" value={f.source ?? ""} onChange={(e) => set("source", e.target.value)}>
            <option value="">–</option>
            {SOURCES.map((s) => <option key={s} value={s}>{t(SOURCE_LABELS[s])}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="po-priority">{L("priority")}</label>
          <select id="po-priority" value={f.priority} onChange={(e) => set("priority", e.target.value)}>
            {PRIORITIES.map((s) => <option key={s} value={s}>{t(PRIORITY_LABELS[s])}</option>)}
          </select>
        </div>
        {input("needed_by", { type: "date" })}
        {input("promised", { type: "date" })}
        {input("ship_method", { placeholder: t("e.g. UPS ground, customer's FedEx account, pick up") })}
        {input("tracking")}
        {input("invoice_no")}
        {prices && input("discount_pct", { type: "number", min: 0, max: 100, step: "0.1" })}
        {prices && input("freight", { type: "number", min: 0, step: "0.01" })}
        {f.status === "lost" && input("lost_reason", { placeholder: t("e.g. price, lead time, bought elsewhere") })}
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="po-ship_to">{L("ship_to")}</label>
          <textarea id="po-ship_to" rows={3} value={f.ship_to ?? ""} onChange={(e) => set("ship_to", e.target.value)} />
        </div>
      </div>
      <div className="panel tbl">
        <h2>{t("Parts")}</h2>
        <datalist id="po-suppliers">{SUPPLIERS.map((s) => <option key={s} value={s} />)}</datalist>
        <table className="edit-rows po-edit">
          <thead>
            <tr>
              <th>{t("Part number")}</th><th>{t("Description")}</th><th>{t("Qty")}</th>
              {prices && <><th>{t("Price")}</th><th>{t("Cost")}</th></>}
              <th>{t("Supplier")}</th><th>{t("Supplier PO")}</th><th>{t("Arrives")}</th><th>{t("Drop ship")}</th><th>{t("Here")}</th><th>{t("Shipped")}</th><th>{t("Note")}</th><th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id ?? `n${i}`}>
                <td><input aria-label={t("Part number")} className="mono" value={l.part_code ?? ""} onChange={(e) => setLine(i, "part_code", e.target.value)} size={10} /></td>
                <td><input aria-label={t("Description")} value={l.description ?? ""} onChange={(e) => setLine(i, "description", e.target.value)} size={18} /></td>
                <td><input aria-label={t("Qty")} type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} style={{ width: 64 }} /></td>
                {prices && <>
                  <td><input aria-label={t("Price")} type="number" min={0} step="0.01" value={l.unit_price ?? ""} onChange={(e) => setLine(i, "unit_price", e.target.value)} style={{ width: 84 }} /></td>
                  <td><input aria-label={t("Cost")} type="number" min={0} step="0.01" value={l.unit_cost ?? ""} onChange={(e) => setLine(i, "unit_cost", e.target.value)} style={{ width: 84 }} /></td>
                </>}
                <td><input aria-label={t("Supplier")} list="po-suppliers" value={l.supplier ?? ""} onChange={(e) => setLine(i, "supplier", e.target.value)} size={14} /></td>
                <td><input aria-label={t("Supplier PO")} value={l.supplier_po ?? ""} onChange={(e) => setLine(i, "supplier_po", e.target.value)} size={9} /></td>
                <td><input aria-label={t("Arrives")} type="date" value={l.eta ?? ""} onChange={(e) => setLine(i, "eta", e.target.value)} /></td>
                <td><input aria-label={t("Drop ship")} type="checkbox" checked={!!l.drop_ship} onChange={(e) => setLine(i, "drop_ship", e.target.checked)} /></td>
                <td><input aria-label={t("Here")} type="number" min={0} step="any" value={l.qty_received} onChange={(e) => setLine(i, "qty_received", e.target.value)} style={{ width: 60 }} /></td>
                <td><input aria-label={t("Shipped")} type="number" min={0} step="any" value={l.qty_shipped} onChange={(e) => setLine(i, "qty_shipped", e.target.value)} style={{ width: 60 }} /></td>
                <td><input aria-label={t("Note")} value={l.note ?? ""} onChange={(e) => setLine(i, "note", e.target.value)} size={12} /></td>
                <td><button type="button" className="linkish" aria-label={t("Remove line")} onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row"><button type="button" className="btn" onClick={() => setLines([...lines, emptyLine()])}>{t("Add line")}</button></div>
      </div>
      <div className="panel">
        <div className="field">
          <label htmlFor="po-notes">{L("notes")}</label>
          <textarea id="po-notes" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
      <ErrorNote error={err} />
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>{order ? t("Save") : t("Add order")}</button>
        <button className="btn" type="button" onClick={() => onDone(false)}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

/** On a machine's page: its spare parts orders. */
export function MachinePartsOrders({ orders }: { orders: Row[] }) {
  return (
    <div className="panel">
      <h2>{t("Parts orders")}</h2>
      {orders.length ? (
        <ul className="cp-history">
          {orders.map((o) => <li key={o.id}><Link to={`/parts-orders/${o.id}`} className="mono">{o.number}</Link> {o.customer_po && <span className="muted">PO {o.customer_po}</span>} <PoStatus status={o.status} /> <span className="muted">{fmtTime(o.updated_at)}</span></li>)}
        </ul>
      ) : <Empty>{t("No parts orders for this machine.")}</Empty>}
    </div>
  );
}

/** On a quote request: turn it into a parts order (or open the one already made). */
export function MakePartsOrder({ quoteId }: { quoteId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn primary" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await api<{ id: string; number: string; existing?: boolean }>(`/parts-orders/from-quote/${enc(quoteId)}`, { body: {} });
        toast(r.existing ? t("Already made: {n}", { n: r.number }) : t("Made {n}", { n: r.number }));
        navigate(`/parts-orders/${r.id}`);
      } catch (x) {
        toast((x as Error).message);
        setBusy(false);
      }
    }}>{t("Make parts order")}</button>
  );
}

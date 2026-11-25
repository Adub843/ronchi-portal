// Change parts: the sales side (a request Andrew or Michele is working, up to the customer's PO) and
// the orders it turns into (replaces the old Change Parts Console). Lists with search, filters and
// export; one page per sale or order with its history; CSV import for orders.
import { useMemo, useState } from "react";
import { CP_FIELDS, CP_LABELS, CP_SALE_FIELDS, CP_SALE_STAGES, CP_STATUSES, normalDate, type CpField } from "../../../src/shared/change-parts";
import { toCsv } from "../../../src/shared/csv";
import { api, can, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad, Tip } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";
import { LinkedShipments } from "./Shipping";

type Order = Record<CpField, string | null> & { id: string; open: boolean; revision: number; updated_at: string; machine_id?: string | null; phase?: "sale" | "order"; sold_at?: string | null };

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function shortDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(`${iso}T12:00:00`).toLocaleDateString(loc(), { month: "short", day: "numeric", year: "numeric" });
}

/** The ship date as YYYY-MM-DD when it reads as a real date ("Mid Nov 2026" doesn't). */
const shipDay = (o: Order) => normalDate(o.ship_date);
const late = (o: Order) => { const d = shipDay(o); return o.open && !!d && d < today(); };
const soon = (o: Order) => { const d = shipDay(o); return o.open && !!d && d >= today() && d <= inDays(30); };

export function StatusPill({ status, isLate }: { status: string | null; isLate?: boolean }) {
  const s = (status ?? "").toLowerCase();
  const cls = isLate ? "p-acc" : /^shipped|^delivered|^closed|^complete/.test(s) ? "p-ok" : /^on hold|^cancel|^waiting|^lost/.test(s) ? "p-warn" : "p-info";
  return <span className={`pill ${cls}`}>{status ? t(status) : t("No status")}{isLate ? ` · ${t("Late")}` : ""}</span>;
}

/** Labels shown on screen, in the chosen language. */
const label = (f: CpField) => t(CP_LABELS[f]);

type View = "open" | "late" | "soon" | "done" | "folder" | "all";

/** Jobs found only as a SharePoint project folder, not on the master sheet. Kept apart until someone checks them. */
const folderOnly = (o: Order) => (o.status ?? "").toLowerCase() === "folder only";

/** The two halves of the page. Sales come first because that's where a job starts. */
function Tabs({ me, on }: { me: Me; on: "sales" | "orders" }) {
  if (!can(me, "cpsales.view") || !can(me, "orders.view")) return null;
  return (
    <div className="row cp-tabs" role="tablist">
      <Link to="/change-parts/sales" className={`btn${on === "sales" ? " primary" : ""}`} aria-current={on === "sales" ? "page" : undefined}>{t("Sales")}</Link>
      <Link to="/change-parts" className={`btn${on === "orders" ? " primary" : ""}`} aria-current={on === "orders" ? "page" : undefined}>{t("Orders")}</Link>
    </div>
  );
}

export function ChangeParts({ me, tab }: { me: Me; tab?: "sales" | "orders" }) {
  const on = tab ?? (can(me, "orders.view") ? "orders" : "sales");
  return on === "sales" ? <SaleList me={me} /> : <OrderList me={me} />;
}

function OrderList({ me }: { me: Me }) {
  const { data, error, reload } = useLoad<{ orders: Order[] }>(() => api("/change-parts"));
  const [view, setView] = useState<View>("open");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"updated" | "ship" | "customer">("updated");
  const [panel, setPanel] = useState<null | "new" | "import">(null);
  const edit = can(me, "orders.edit");

  const all = data?.orders ?? [];
  const counts = useMemo(() => ({
    open: all.filter((o) => o.open && !folderOnly(o)).length,
    folder: all.filter(folderOnly).length,
    late: all.filter(late).length,
    soon: all.filter(soon).length,
    done: all.filter((o) => !o.open).length,
  }), [all]);
  const statuses = useMemo(() => [...new Set(all.map((o) => o.status ?? ""))].sort((a, b) => {
    const ia = CP_STATUSES.indexOf(a as never), ib = CP_STATUSES.indexOf(b as never);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  }), [all]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter((o) => {
      if (view === "open" && (!o.open || folderOnly(o))) return false;
      if (view === "folder" && !folderOnly(o)) return false;
      if (view === "done" && o.open) return false;
      if (view === "late" && !late(o)) return false;
      if (view === "soon" && !soon(o)) return false;
      if (status && (o.status ?? "") !== status) return false;
      if (!words.length) return true;
      const text = CP_FIELDS.map((f) => o[f] ?? "").join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const by = sort === "ship" ? (o: Order) => shipDay(o) || "9999" : sort === "customer" ? (o: Order) => (o.customer ?? "").toLowerCase() : null;
    return by ? rows.sort((a, b) => by(a).localeCompare(by(b))) : rows;
  }, [all, view, status, q, sort]);

  function exportCsv() {
    const csv = toCsv(CP_FIELDS.map((f) => CP_LABELS[f]), shown.map((o) => CP_FIELDS.map((f) => o[f] ?? "")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `change-part-orders-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const tiles: { v: View; n: number; l: string }[] = [
    { v: "open", n: counts.open, l: t("Open jobs") },
    { v: "soon", n: counts.soon, l: t("Ship in the next 30 days") },
    { v: "late", n: counts.late, l: t("Past ship date") },
    { v: "done", n: counts.done, l: t("Shipped or closed") },
    ...(counts.folder ? [{ v: "folder" as View, n: counts.folder, l: t("Folders not on the master sheet") }] : []),
  ];

  return (
    <>
      <PageHead title={t("Change parts")} sub={t("Every change-part job, from the first request to shipped.")} tip="change-parts.head">
        <button className="btn" onClick={exportCsv} disabled={!shown.length}>{t("Export CSV")}</button>
        {can(me, "orders.import") && <button className="btn" onClick={() => setPanel(panel === "import" ? null : "import")}>{panel === "import" ? t("Cancel") : t("Import CSV")}</button>}
        {can(me, "orders.add") && <button className="btn primary" onClick={() => setPanel(panel === "new" ? null : "new")}>{panel === "new" ? t("Cancel") : t("New order")}</button>}
      </PageHead>
      <Tabs me={me} on="orders" />
      {panel === "new" && <OrderForm onSaved={(id) => navigate(`/change-parts/${id}`)} onCancel={() => setPanel(null)} />}
      {panel === "import" && <ImportPanel onDone={() => { setPanel(null); reload(); }} />}
      <ErrorNote error={error} />
      <div className={`cp-tiles${counts.folder ? " five" : ""}`}>
        {tiles.map((x) => (
          <button key={x.v} type="button" className={`panel cp-tile${view === x.v ? " on" : ""}${x.v === "late" && x.n ? " warn" : ""}`} aria-pressed={view === x.v} onClick={() => setView(view === x.v ? "all" : x.v)}>
            <span className="n">{data ? x.n : "–"}</span><span className="l">{x.l}</span>
          </button>
        ))}
      </div>
      <div className="row cp-filters">
        <input className="panel" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search customer, machine, part, PO or notes")} aria-label={t("Search orders")} />
        <select className="panel" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("Status")}>
          <option value="">{t("Any status")}</option>
          {statuses.map((s) => <option key={s} value={s}>{s ? t(s) : t("No status")}</option>)}
        </select>
        <select className="panel" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={t("Sort")}>
          <option value="updated">{t("Recently changed")}</option>
          <option value="ship">{t("Ship date")}</option>
          <option value="customer">{t("Customer")}</option>
        </select>
        <button type="button" className={`btn${view === "all" ? " primary" : ""}`} onClick={() => setView("all")}>{t("All {n}", { n: all.length })}</button>
      </div>
      <div className="panel tbl">
        {data && !all.length && <Empty>{edit ? t("No orders yet. Add one, or import the master sheet as a CSV file.") : t("No orders yet.")}</Empty>}
        {data && !!all.length && !shown.length && <Empty>{t("No orders match.")}</Empty>}
        {!!shown.length && (
          <table className="cp-table">
            <thead>
              <tr><th>{label("customer")}</th><th>{label("machine")}</th><th>{label("part")}</th><th>{label("status")}</th><th>{label("salesperson")}</th><th>{label("aa")}</th><th>{label("ship_date")}</th></tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/change-parts/${o.id}`}>{o.customer}</Link></td>
                  <td className="mono">{o.machine ?? "–"}</td>
                  <td>{o.part ?? "–"}</td>
                  <td><StatusPill status={o.status} isLate={late(o)} /></td>
                  <td>{o.salesperson ?? "–"}</td>
                  <td className="mono nowrap">{o.aa ?? "–"}</td>
                  <td>{shipDay(o) ? shortDate(shipDay(o)) : o.ship_date ?? "–"}</td>
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

/** The add / edit form. Sends the revision it started from so a newer save is never overwritten. */
function OrderForm({ order, onSaved, onCancel }: { order?: Order; onSaved: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState<Record<CpField, string>>(() => Object.fromEntries(CP_FIELDS.map((k) => [k, order?.[k] ?? ""])) as Record<CpField, string>);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (order) {
        await api(`/change-parts/${encodeURIComponent(order.id)}`, { method: "PATCH", body: { ...f, revision: order.revision } });
        onSaved(order.id);
      } else {
        const r = await api<{ id: string }>("/change-parts", { body: f });
        onSaved(r.id);
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = (k: CpField, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field" key={k}>
      <label htmlFor={`cp-${k}`}>{label(k)}</label>
      <input id={`cp-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} type="text" {...extra} />
    </div>
  );

  return (
    <form className="panel grid g2 cp-form" onSubmit={save}>
      {input("customer", { required: true, autoFocus: !order })}
      {input("machine", { placeholder: "3069MB" })}
      {input("part", { placeholder: t("e.g. 500 ml round bottle set") })}
      <div className="field">
        <label htmlFor="cp-status">{label("status")}</label>
        <input id="cp-status" list="cp-statuses" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder={t("Pick or type")} />
        <datalist id="cp-statuses">{CP_STATUSES.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
      {input("salesperson")}
      {input("contact")}
      {input("quote")}
      {input("customer_po")}
      {input("ra_po")}
      {input("aa")}
      {input("fill_test", { placeholder: t("e.g. Needed, Not needed, Passed 11/12") })}
      {input("samples_received", { placeholder: t("Yes, No, or a date") })}
      {input("samples_shipped", { placeholder: t("Yes, No, or a date") })}
      {input("ship_date", { placeholder: t("e.g. 12/11/2026 or Mid Nov 2026") })}
      {input("folder_url", { placeholder: "https://…sharepoint.com/…", type: "url" })}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="cp-notes">{label("notes")}</label>
        <textarea id="cp-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <ErrorNote error={err} />
      <div className="row" style={{ gridColumn: "1 / -1" }}>
        <button className="btn primary" type="submit" disabled={busy}>{order ? t("Save") : t("Add order")}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    setPreview(null);
    setErr(null);
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setName(file.name);
    try {
      setPreview(await api("/change-parts/import", { body: { csv: text } }));
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  async function confirm() {
    setBusy(true);
    try {
      const r = await api("/change-parts/import", { body: { csv, confirm: true } });
      toast(t("Imported {n} orders", { n: r.imported }));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel stack">
      <h2>{t("Import from a spreadsheet")}</h2>
      <Tip id="change-parts.import">{t("In Excel, open the Change Parts Management Master Sheet (or the old console's export) and use File, Save As, CSV. Then choose that file here. You'll see what was found before anything is added.")}</Tip>
      <div className="field">
        <label htmlFor="cp-file">{t("CSV file")}</label>
        <input id="cp-file" type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <ErrorNote error={err} />
      {preview && (
        <>
          <p><strong>{name}</strong>: {t("{found} orders found. {adding} will be added, {dups} are already here, {skipped} empty rows skipped.", { found: preview.found, adding: preview.adding, dups: preview.duplicates, skipped: preview.skipped })}</p>
          <p className="muted">{t("Columns used")}: {preview.matched.map((m: any) => `${m.column} → ${t(CP_LABELS[m.field as CpField])}`).join(", ") || "–"}</p>
          {!!preview.extra.length && <p className="muted">{t("Kept in Notes")}: {preview.extra.join(", ")}</p>}
          {preview.problems.map((p: string) => <p key={p} className="err">{t(p)}</p>)}
          <div className="row">
            <button className="btn primary" onClick={confirm} disabled={busy || !preview.adding}>{t("Add {n} orders", { n: preview.adding })}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- the sales side ----------

/** A follow-up date that has come (or passed) on a sale that's still being worked. */
const followDay = (o: Order) => normalDate(o.follow_up);
const due = (o: Order) => { const d = followDay(o); return o.open && !!d && d <= today(); };

type SaleView = "open" | "due" | "quoted" | "lost" | "all";

function SaleList({ me }: { me: Me }) {
  const { data, error } = useLoad<{ sales: Order[] }>(() => api("/change-parts/sales"));
  const [view, setView] = useState<SaleView>("open");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const all = data?.sales ?? [];
  const people = useMemo(() => [...new Set(all.map((o) => o.salesperson ?? "").filter(Boolean))].sort(), [all]);
  const mine = (o: Order) => !who || (o.salesperson ?? "") === who;
  const counts = useMemo(() => ({
    open: all.filter((o) => o.open && mine(o)).length,
    due: all.filter((o) => due(o) && mine(o)).length,
    quoted: all.filter((o) => o.open && (o.status ?? "").toLowerCase() === "quote sent" && mine(o)).length,
    lost: all.filter((o) => !o.open && mine(o)).length,
  }), [all, who]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((o) => {
      if (!mine(o)) return false;
      if (view === "open" && !o.open) return false;
      if (view === "due" && !due(o)) return false;
      if (view === "quoted" && !(o.open && (o.status ?? "").toLowerCase() === "quote sent")) return false;
      if (view === "lost" && o.open) return false;
      if (!words.length) return true;
      const text = CP_FIELDS.map((f) => o[f] ?? "").join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [all, view, who, q]);

  const tiles: { v: SaleView; n: number; l: string }[] = [
    { v: "open", n: counts.open, l: t("Open sales") },
    { v: "due", n: counts.due, l: t("Follow up due") },
    { v: "quoted", n: counts.quoted, l: t("Quote sent") },
    { v: "lost", n: counts.lost, l: t("Lost") },
  ];

  return (
    <>
      <PageHead title={t("Change parts")} sub={t("Change-part sales. When the customer's PO comes in, mark it sold and it becomes an order.")} tip="change-parts.sales">
        {can(me, "cpsales.edit") && <button className="btn primary" onClick={() => setAdding(!adding)}>{adding ? t("Cancel") : t("New sale")}</button>}
      </PageHead>
      <Tabs me={me} on="sales" />
      {adding && <SaleForm me={me} onSaved={(id) => navigate(`/change-parts/${id}`)} onCancel={() => setAdding(false)} />}
      <ErrorNote error={error} />
      <div className="cp-tiles">
        {tiles.map((x) => (
          <button key={x.v} type="button" className={`panel cp-tile${view === x.v ? " on" : ""}${x.v === "due" && x.n ? " warn" : ""}`} aria-pressed={view === x.v} onClick={() => setView(view === x.v ? "all" : x.v)}>
            <span className="n">{data ? x.n : "–"}</span><span className="l">{x.l}</span>
          </button>
        ))}
      </div>
      <div className="row cp-filters">
        <input className="panel" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search customer, machine, part, quote or notes")} aria-label={t("Search sales")} />
        <select className="panel" value={who} onChange={(e) => setWho(e.target.value)} aria-label={label("salesperson")}>
          <option value="">{t("Everyone")}</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" className={`btn${view === "all" ? " primary" : ""}`} onClick={() => setView("all")}>{t("All {n}", { n: all.filter(mine).length })}</button>
      </div>
      <div className="panel tbl">
        {data && !all.length && <Empty>{t("No sales yet. When a customer asks for change parts, start a sale here.")}</Empty>}
        {data && !!all.length && !shown.length && <Empty>{t("No sales match.")}</Empty>}
        {!!shown.length && (
          <table className="cp-table">
            <thead>
              <tr><th>{label("customer")}</th><th>{label("machine")}</th><th>{label("part")}</th><th>{t("Stage")}</th><th>{label("salesperson")}</th><th>{label("quote")}</th><th>{label("follow_up")}</th></tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/change-parts/${o.id}`}>{o.customer}</Link></td>
                  <td className="mono">{o.machine ?? "–"}</td>
                  <td>{o.part ?? "–"}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td>{o.salesperson ?? "–"}</td>
                  <td className="mono nowrap">{o.quote ?? "–"}</td>
                  <td>{due(o) ? <span className="pill p-acc">{shortDate(followDay(o))}</span> : followDay(o) ? shortDate(followDay(o)) : o.follow_up ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** Start or edit a sale: only what's known before the customer's PO. */
function SaleForm({ me, sale, onSaved, onCancel }: { me: Me; sale?: Order; onSaved: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(CP_SALE_FIELDS.map((k) => [k, sale?.[k] ?? (k === "salesperson" ? me.name : k === "status" ? CP_SALE_STAGES[0] : "")])));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (sale) {
        await api(`/change-parts/${encodeURIComponent(sale.id)}`, { method: "PATCH", body: { ...f, revision: sale.revision } });
        onSaved(sale.id);
      } else {
        const r = await api<{ id: string }>("/change-parts/sales", { body: f });
        onSaved(r.id);
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (k: CpField, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field" key={k}>
      <label htmlFor={`cs-${k}`}>{label(k)}</label>
      <input id={`cs-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} type="text" {...extra} />
    </div>
  );
  return (
    <form className="panel grid g2 cp-form" onSubmit={save}>
      {input("customer", { required: true, autoFocus: !sale })}
      {input("contact", { placeholder: t("Name, email or phone") })}
      {input("machine", { placeholder: "3069MB" })}
      {input("part", { placeholder: t("e.g. 500 ml round bottle set") })}
      <div className="field">
        <label htmlFor="cs-status">{t("Stage")}</label>
        <input id="cs-status" list="cs-stages" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder={t("Pick or type")} />
        <datalist id="cs-stages">{CP_SALE_STAGES.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
      {input("salesperson")}
      {input("quote")}
      {input("follow_up", { type: "date" })}
      {input("folder_url", { placeholder: "https://…sharepoint.com/…", type: "url" })}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="cs-notes">{label("notes")}</label>
        <textarea id="cs-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <ErrorNote error={err} />
      <div className="row" style={{ gridColumn: "1 / -1" }}>
        <button className="btn primary" type="submit" disabled={busy}>{sale ? t("Save") : t("Start sale")}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

/** Mark a sale sold: the customer's PO turns it into a change-part order. */
function SoldForm({ sale, onDone, onCancel }: { sale: Order; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ customer_po: sale.customer_po ?? "", status: "Open", aa: "", ra_po: "", ship_date: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/change-parts/${encodeURIComponent(sale.id)}/sold`, { body: { ...f, revision: sale.revision } });
      toast(t("Sold. It's now a change-part order."));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (k: "customer_po" | "aa" | "ra_po" | "ship_date", extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field" key={k}>
      <label htmlFor={`sold-${k}`}>{label(k)}</label>
      <input id={`sold-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} type="text" {...extra} />
    </div>
  );
  return (
    <form className="panel grid g2 cp-form" onSubmit={save}>
      <p style={{ gridColumn: "1 / -1", margin: 0 }}>{t("Add the customer's PO. The sale moves to Orders with everything typed so far, and its history comes along.")}</p>
      {input("customer_po", { required: true, autoFocus: true })}
      <div className="field">
        <label htmlFor="sold-status">{t("Order status")}</label>
        <input id="sold-status" list="cp-statuses-sold" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} />
        <datalist id="cp-statuses-sold">{CP_STATUSES.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
      {input("aa")}
      {input("ra_po")}
      {input("ship_date", { placeholder: t("e.g. 12/11/2026 or Mid Nov 2026") })}
      <ErrorNote error={err} />
      <div className="row" style={{ gridColumn: "1 / -1" }}>
        <button className="btn primary" type="submit" disabled={busy}>{t("Mark sold")}</button>
        <button className="btn" type="button" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

/** What each history line says. */
const HISTORY: Record<string, string> = {
  "cp_order.create": "added this order",
  "cp_order.remove": "removed this order",
  "cp_sale.create": "started this sale",
  "cp_sale.sold": "marked it sold",
  "cp_sale.remove": "removed this sale",
};

export function ChangePartPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad<{ order: Order & Record<string, any>; history: any[] }>(() => api(`/change-parts/${encodeURIComponent(id)}`), [id]);
  const [editing, setEditing] = useState(false);
  const [selling, setSelling] = useState(false);
  const [sure, setSure] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const o = data.order;
  const sale = o.phase === "sale";
  const edit = can(me, sale ? "cpsales.edit" : "orders.edit");
  const canSell = sale && can(me, "cpsales.edit") && can(me, "orders.add");

  async function remove() {
    if (!sure) {
      setSure(true);
      toast(sale ? t("Press Remove again to remove this sale. It stays in the record but is no longer listed.") : t("Press Remove again to remove this order. It stays in the record but is no longer listed."));
      return;
    }
    try {
      await api(`/change-parts/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast(sale ? t("Sale removed") : t("Order removed"));
      navigate(sale ? "/change-parts/sales" : "/change-parts");
    } catch (x) {
      toast((x as Error).message);
    }
  }

  const show = (k: CpField) => {
    const v = o[k];
    if (!v) return <span className="muted">–</span>;
    if (k === "folder_url") return <a href={v} target="_blank" rel="noopener noreferrer">{t("Open the SharePoint folder")}</a>;
    if (k === "machine") return o.machine_id ? <Link to={`/machines/${o.machine_id}`} className="mono">{v}</Link> : <span className="mono">{v}</span>;
    return v;
  };

  return (
    <>
      <PageHead title={o.customer ?? ""} sub={[sale ? t("Sale") : t("Order"), o.machine, o.part].filter(Boolean).join(" · ")}>
        <StatusPill status={o.status} isLate={!sale && late(o)} />
        {canSell && !editing && !selling && o.open && <button className="btn primary" onClick={() => setSelling(true)}>{t("Mark sold")}</button>}
        {edit && !editing && !selling && <button className="btn" onClick={() => setEditing(true)}>{t("Edit")}</button>}
        {can(me, sale ? "cpsales.edit" : "orders.remove") && !editing && !selling && <button className="btn danger" onClick={remove}>{sure ? t("Yes, remove") : t("Remove")}</button>}
      </PageHead>
      {o.sold_at && <p className="muted">{t("Sold on {when}", { when: fmtTime(o.sold_at) })}</p>}
      {selling ? (
        <SoldForm sale={o} onDone={() => { setSelling(false); reload(); }} onCancel={() => setSelling(false)} />
      ) : editing && sale ? (
        <SaleForm me={me} sale={o} onSaved={() => { setEditing(false); reload(); toast(t("Saved")); }} onCancel={() => setEditing(false)} />
      ) : editing ? (
        <OrderForm order={o} onSaved={() => { setEditing(false); reload(); toast(t("Saved")); }} onCancel={() => setEditing(false)} />
      ) : sale ? (
        <div className="grid g2">
          <div className="panel">
            <h2>{t("Sale")}</h2>
            <dl className="cp-dl">
              {(["salesperson", "contact", "quote", "follow_up", "machine", "part", "folder_url"] as CpField[]).map((k) => <div key={k}><dt>{label(k)}</dt><dd>{show(k)}</dd></div>)}
              <div><dt>{t("Stage")}</dt><dd>{o.status ? t(o.status) : "–"}</dd></div>
            </dl>
          </div>
          <div className="panel">
            <h2>{t("Next")}</h2>
            <p>{o.open ? t("When the customer's PO comes in, press Mark sold. It becomes an order with samples, fill test and shipping to track.") : t("This sale was lost. Change its stage to pick it up again.")}</p>
          </div>
          <div className="panel" style={{ gridColumn: "1 / -1" }}>
            <h2>{label("notes")}</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{o.notes || <span className="muted">{t("No notes yet.")}</span>}</p>
          </div>
        </div>
      ) : (
        <div className="grid g2">
          <div className="panel">
            <h2>{t("Order")}</h2>
            <dl className="cp-dl">
              {(["salesperson", "contact", "quote", "customer_po", "ra_po", "aa", "machine", "part", "status"] as CpField[]).map((k) => <div key={k}><dt>{label(k)}</dt><dd>{show(k)}</dd></div>)}
            </dl>
          </div>
          <div className="panel">
            <h2>{t("Samples and shipping")}</h2>
            <dl className="cp-dl">
              {(["samples_received", "samples_shipped", "fill_test", "ship_date", "folder_url"] as CpField[]).map((k) => <div key={k}><dt>{label(k)}</dt><dd>{show(k)}</dd></div>)}
            </dl>
          </div>
          <div className="panel" style={{ gridColumn: "1 / -1" }}>
            <h2>{label("notes")}</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{o.notes || <span className="muted">{t("No notes yet.")}</span>}</p>
          </div>
          <LinkedShipments me={me} link={{ type: "cp_order", id: o.id }} shipLabel={t("Ship these change parts")} />
        </div>
      )}
      <div className="panel">
        <h2>{t("History")}</h2>
        {!data.history.length && <Empty>{t("No changes yet.")}</Empty>}
        <ul className="cp-history">
          {data.history.map((h, i) => (
            <li key={i}>
              <span className="muted">{fmtTime(h.at)}</span> <strong>{h.who ?? t("Someone")}</strong>{" "}
              {HISTORY[h.action] ? t(HISTORY[h.action]!) : t("changed")}
              {(h.action === "cp_order.update" || h.action === "cp_sale.update" || h.action === "cp_sale.sold") && h.changes && (
                <ul>
                  {Object.entries(h.changes as Record<string, [string | null, string | null]>).map(([k, [a, b]]) => (
                    <li key={k}>{label(k as CpField)}: <s className="muted">{a || "–"}</s> → {b || "–"}</li>
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

// Change-part orders: the sales side's tracker (replaces the old Change Parts Console).
// List with search, filters and export; one page per order with its history; CSV import.
import { useMemo, useState } from "react";
import { CP_FIELDS, CP_LABELS, CP_STATUSES, normalDate, type CpField } from "../../../src/shared/change-parts";
import { toCsv } from "../../../src/shared/csv";
import { api, can, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";

type Order = Record<CpField, string | null> & { id: string; open: boolean; revision: number; updated_at: string; machine_id?: string | null };

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
  const cls = isLate ? "p-acc" : /^shipped|^delivered|^closed|^complete/.test(s) ? "p-ok" : /^on hold|^cancel|^waiting/.test(s) ? "p-warn" : "p-info";
  return <span className={`pill ${cls}`}>{status ? t(status) : t("No status")}{isLate ? ` · ${t("Late")}` : ""}</span>;
}

/** Labels shown on screen, in the chosen language. */
const label = (f: CpField) => t(CP_LABELS[f]);

type View = "open" | "late" | "soon" | "done" | "folder" | "all";

/** Jobs found only as a SharePoint project folder, not on the master sheet. Kept apart until someone checks them. */
const folderOnly = (o: Order) => (o.status ?? "").toLowerCase() === "folder only";

export function ChangeParts({ me }: { me: Me }) {
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
      <PageHead title={t("Change-part orders")} sub={t("Every change-part job, from quote to shipped.")}>
        <button className="btn" onClick={exportCsv} disabled={!shown.length}>{t("Export CSV")}</button>
        {can(me, "orders.import") && <button className="btn" onClick={() => setPanel(panel === "import" ? null : "import")}>{panel === "import" ? t("Cancel") : t("Import CSV")}</button>}
        {can(me, "orders.add") && <button className="btn primary" onClick={() => setPanel(panel === "new" ? null : "new")}>{panel === "new" ? t("Cancel") : t("New order")}</button>}
      </PageHead>
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
      <p className="muted">{t("In Excel, open the Change Parts Management Master Sheet (or the old console's export) and use File, Save As, CSV. Then choose that file here. You'll see what was found before anything is added.")}</p>
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

export function ChangePartPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad<{ order: Order & Record<string, any>; history: any[] }>(() => api(`/change-parts/${encodeURIComponent(id)}`), [id]);
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const o = data.order;
  const edit = can(me, "orders.edit");

  async function remove() {
    if (!sure) {
      setSure(true);
      toast(t("Press Remove again to remove this order. It stays in the record but is no longer listed."));
      return;
    }
    try {
      await api(`/change-parts/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast(t("Order removed"));
      navigate("/change-parts");
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
      <PageHead title={o.customer ?? ""} sub={[o.machine, o.part].filter(Boolean).join(" · ") || undefined}>
        <StatusPill status={o.status} isLate={late(o)} />
        {edit && !editing && <button className="btn" onClick={() => setEditing(true)}>{t("Edit")}</button>}
        {can(me, "orders.remove") && !editing && <button className="btn danger" onClick={remove}>{sure ? t("Yes, remove") : t("Remove")}</button>}
      </PageHead>
      {editing ? (
        <OrderForm order={o} onSaved={() => { setEditing(false); reload(); toast(t("Saved")); }} onCancel={() => setEditing(false)} />
      ) : (
        <div className="grid g2">
          <div className="panel">
            <h2>{t("Order")}</h2>
            <dl className="cp-dl">
              {(["salesperson", "quote", "customer_po", "ra_po", "aa", "machine", "part", "status"] as CpField[]).map((k) => <div key={k}><dt>{label(k)}</dt><dd>{show(k)}</dd></div>)}
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
        </div>
      )}
      <div className="panel">
        <h2>{t("History")}</h2>
        {!data.history.length && <Empty>{t("No changes yet.")}</Empty>}
        <ul className="cp-history">
          {data.history.map((h, i) => (
            <li key={i}>
              <span className="muted">{fmtTime(h.at)}</span> <strong>{h.who ?? t("Someone")}</strong>{" "}
              {h.action === "cp_order.create" ? t("added this order") : h.action === "cp_order.remove" ? t("removed this order") : t("changed")}
              {h.action === "cp_order.update" && h.changes && (
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

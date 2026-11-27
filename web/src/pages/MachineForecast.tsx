// Machine sales forecast and reports, and the import of a sales list (rules: src/shared/machine-forecast.ts).
// The forecast lists every deal by name under Won, Commit, Best case and Pipeline for a quarter, then
// the orders by ship month, the payments still to come, and how the last 12 months went.
import { useMemo, useState } from "react";
import { BUCKETS, BUCKET_HINTS, BUCKET_LABELS, MAX_DEAL_IMPORT, bucketOf, quarter, readDealsCsv, yearReport, type Bucket } from "../../../src/shared/machine-forecast";
import { ORDERS, SELLING, STAGE_LABELS, chanceOf, type Stage } from "../../../src/shared/machine-sales";
import { api, can, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";

type Row = Record<string, any> & { stage: Stage };
const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString(loc(), { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(loc(), { month: "short", day: "numeric", year: "numeric" }) : "–");
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString(loc(), { month: "long", year: "numeric" });
const sum = (ds: Row[], f: (d: Row) => number) => ds.reduce((s, d) => s + f(d), 0);

export function MachineForecast({ deals }: { deals: Row[] }) {
  const [offset, setOffset] = useState(0);
  const pay = useLoad<{ payments: Row[] }>(() => api("/machine-sales/forecast"));
  const now = today();
  const period = quarter(now, offset);
  const cols = useMemo(() => {
    const out: Record<Bucket, Row[]> = { won: [], commit: [], best: [], pipeline: [] };
    for (const d of deals) { const b = bucketOf(d, period.months); if (b) out[b].push(d); }
    for (const b of BUCKETS) out[b].sort((a, z) => (z.value ?? 0) - (a.value ?? 0));
    return out;
  }, [deals, period.label]);
  const undated = deals.filter((d) => SELLING.has(d.stage) && !d.expected_po);
  const backlog = useMemo(() => {
    const by = new Map<string, Row[]>();
    for (const d of deals.filter((x) => ORDERS.has(x.stage))) { const k = d.target_ship ? d.target_ship.slice(0, 7) : ""; by.set(k, [...(by.get(k) ?? []), d]); }
    return [...by.entries()].sort((a, b) => (a[0] || "9999").localeCompare(b[0] || "9999"));
  }, [deals]);
  const report = useMemo(() => yearReport(deals, now), [deals]);
  const payments = pay.data?.payments ?? [];
  const late = payments.filter((p) => p.due && p.due < now);

  return (
    <div className="stack">
      <div className="panel">
        <div className="row mf-head">
          <h2>{t("Forecast for {q}", { q: period.label })}</h2>
          <span className="spacer" />
          <div className="seg" role="group" aria-label={t("Quarter")}>
            <button type="button" onClick={() => setOffset(offset - 1)}>{t("Earlier")}</button>
            <button type="button" className={offset === 0 ? "on" : ""} onClick={() => setOffset(0)}>{t("This quarter")}</button>
            <button type="button" onClick={() => setOffset(offset + 1)}>{t("Later")}</button>
          </div>
        </div>
        <p className="muted">{t("A deal is in a quarter by the month its PO is expected. Won counts deals whose PO came in that quarter.")}</p>
        <div className="mf-grid">
          {BUCKETS.map((b) => (
            <section key={b} className={`mf-col mf-${b}`} aria-label={t(BUCKET_LABELS[b])}>
              <header>
                <h3>{t(BUCKET_LABELS[b])} <span className="muted">{cols[b].length}</span></h3>
                <strong className="mono">{money(sum(cols[b], (d) => d.value ?? 0))}</strong>
                <p className="muted">{t(BUCKET_HINTS[b])}</p>
              </header>
              {cols[b].map((d) => (
                <Link key={d.id} to={`/machine-sales/${d.id}`} className="mf-deal">
                  <strong>{d.customer}</strong>
                  <span className="muted">{d.title ?? d.machine_type ?? d.number}</span>
                  <span className="row"><span className="mono">{money(d.value)}</span><span className="spacer" /><span className="muted">{b === "won" ? t(STAGE_LABELS[d.stage as Stage]) : `${chanceOf(d)}%`}</span></span>
                </Link>
              ))}
              {!cols[b].length && <p className="muted">{t("None")}</p>}
            </section>
          ))}
        </div>
        <p className="mf-sum"><strong>{t("Won plus Commit: {a}. With Best case: {b}.", { a: money(sum([...cols.won, ...cols.commit], (d) => d.value ?? 0)), b: money(sum([...cols.won, ...cols.commit, ...cols.best], (d) => d.value ?? 0)) })}</strong></p>
        {!!undated.length && <p className="muted">{t("{n} deals being sold have no expected PO month, so they are in no quarter:", { n: undated.length })} {undated.map((d, i) => <span key={d.id}>{i ? ", " : ""}<Link to={`/machine-sales/${d.id}`}>{d.customer}</Link></span>)}</p>}
      </div>

      <div className="mf-two">
        <div className="panel">
          <h2>{t("Orders by ship month")}</h2>
          {!backlog.length && <Empty>{t("No orders being delivered.")}</Empty>}
          {backlog.map(([ym, ds]) => (
            <div key={ym} className="mf-month">
              <h3>{ym ? monthName(ym) : t("No ship date yet")} <span className="mono muted">{money(sum(ds, (d) => d.value ?? 0))}</span></h3>
              <ul className="cp-history">{ds.map((d) => <li key={d.id}><Link to={`/machine-sales/${d.id}`}>{d.customer}</Link> <span className="muted">{d.title ?? d.machine_type ?? ""} · {t(STAGE_LABELS[d.stage as Stage])}</span> <span className="mono">{money(d.value)}</span></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>{t("Payments still to come")}</h2>
          <ErrorNote error={pay.error} />
          {pay.data && !payments.length && <Empty>{t("No payments are listed on any order.")}</Empty>}
          {!!payments.length && <p><strong className="mono">{money(sum(payments, (p) => p.amount ?? 0))}</strong> {t("to come")}{late.length ? <> · <strong className="mo-late">{t("{n} is overdue.", { n: money(sum(late, (p) => p.amount ?? 0)) })}</strong></> : null}</p>}
          <ul className="cp-history">
            {payments.map((p) => (
              <li key={p.id} className={p.due && p.due < now ? "mo-late" : ""}>
                {p.due ? day(p.due) : t("No due date")} · <Link to={`/machine-sales/${p.deal_id}`}>{p.customer}</Link> <span className="muted">{p.label}</span> <span className="mono">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel">
        <h2>{t("The last 12 months")}</h2>
        <div className="cp-tiles">
          <div className="panel cp-tile ms-tile"><span className="n">{report.won}</span><span className="l">{t("Machines sold")}</span></div>
          <div className="panel cp-tile ms-tile"><span className="n">{money(report.wonValue)}</span><span className="l">{t("Value sold")}</span></div>
          <div className="panel cp-tile ms-tile"><span className="n">{report.winRate == null ? "–" : `${report.winRate}%`}</span><span className="l">{t("Won of those decided")}</span></div>
          <div className="panel cp-tile ms-tile"><span className="n">{report.daysToWin ?? "–"}</span><span className="l">{t("Days from first contact to PO")}</span></div>
        </div>
        {!!report.reasons.length && <><h3>{t("Why deals were lost")}</h3><ul className="cp-history">{report.reasons.map(([why, n]) => <li key={why}>{why === "No reason given" ? t("No reason given") : why} <strong>{n}</strong></li>)}</ul></>}
      </div>
    </div>
  );
}

export function MachineDealsImport({ me }: { me: Me }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const read = useMemo(() => (csv.trim() ? readDealsCsv(csv) : null), [csv]);
  if (!can(me, "machinesales.add")) return <ErrorNote error="Your role doesn't allow this." />;
  async function go() {
    if (!read?.rows.length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ deals: number }>("/machine-sales/import", { body: { rows: read.rows } });
      toast(t("{n} deals imported", { n: r.deals }));
      navigate("/machine-sales/list");
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <PageHead title={t("Import a sales list")} sub={t("Bring in the deals you track in a spreadsheet. Each line becomes a new deal. Nothing already here is changed.")} />
      <div className="panel stack">
        <p>{t("Save the spreadsheet as CSV. It needs a Customer column. Deal name, Site, Machine type, Value, Stage, Expected PO month, Salesperson, Customer PO, Machine number, Contact and Notes are optional. Up to {n} deals at a time.", { n: MAX_DEAL_IMPORT })}</p>
        <input type="file" accept=".csv,text/csv" aria-label={t("Choose a CSV file")} onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} />
        <textarea rows={8} className="mono" aria-label={t("Or paste the list here")} placeholder={"Customer,Deal name,Value,Stage,Expected PO month,Salesperson\nExample Foods,16-head filler,980000,Firm quote,3/2027,Andrew"} value={csv} onChange={(e) => setCsv(e.target.value)} />
        {read && <p><strong>{t("{n} deals ready to import.", { n: read.rows.length })}</strong></p>}
        {!!read?.problems.length && <ul className="inv-problems">{read.problems.slice(0, 20).map((p) => <li key={p}>{p}</li>)}</ul>}
        <ErrorNote error={err} />
        <div className="row">
          <button className="btn primary" disabled={busy || !read?.rows.length} onClick={go}>{t("Import")}</button>
          <button className="btn" onClick={() => navigate("/machine-sales")}>{t("Cancel")}</button>
        </div>
      </div>
    </div>
  );
}

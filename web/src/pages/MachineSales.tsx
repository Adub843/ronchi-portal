// Machine sales: every new-machine deal, from the first call to a machine running on the customer's line.
// A pipeline board (one column per stage of the sale), a list, the orders being delivered, and one page
// per deal with its stage bar, what's due, facts and timeline. Stages and rules: src/shared/machine-sales.ts.
import { useMemo, useState } from "react";
import {
  BOARD, DEAL_LABELS, FLAG_LABELS, LEAD_SOURCES, LINE, NOTE_KINDS, NOTE_LABELS, ORDERS, QUOTED, SELLING, STAGE_DAYS, STAGE_LABELS, STAGES,
  chanceOf, daysSince, flags, isOpen, stageNeeds, weighted, type DealField, type FlagId, type Stage,
} from "../../../src/shared/machine-sales";
import { QUOTE_KIND_LABELS, type QuoteKind } from "../../../src/shared/machine-quotes";
import { api, can, fmtTime, type Me } from "../api";
import { QuoteStatusPill } from "./MachineQuote";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";

type Row = Record<string, any> & { stage: Stage };
const today = () => new Date().toISOString().slice(0, 10);
const enc = encodeURIComponent;
const L = (f: DealField) => t(DEAL_LABELS[f]);
const S = (s: string) => t(STAGE_LABELS[s as Stage] ?? s);

function money(n: number | null | undefined): string {
  if (n == null) return "–";
  return n.toLocaleString(loc(), { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function day(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(loc(), { month: "short", day: "numeric", year: "numeric" });
}
function month(ym: string | null | undefined): string {
  if (!ym) return "–";
  return new Date(`${ym}-15T12:00:00`).toLocaleDateString(loc(), { month: "short", year: "numeric" });
}
const sum = (ds: Row[], f: (d: Row) => number) => ds.reduce((s, d) => s + f(d), 0);
/** Soonest next step first; deals with no next step last. */
const byNext = (a: Row, b: Row) => (a.next_step_date ?? "9999").localeCompare(b.next_step_date ?? "9999") || a.customer.localeCompare(b.customer);

/** What happened to a quote, as the deal's timeline words it. */
const QUOTE_EVENTS: Record<string, string> = { draft: "Draft started", sent: "Sent to the customer", accepted: "Customer accepted", declined: "Customer declined", removed: "Draft removed" };

function Flags({ deal }: { deal: Row }) {
  const fs = flags(deal as never, today());
  if (!fs.length) return null;
  return <span className="row ms-flags">{fs.map((f: FlagId) => <span key={f} className="pill p-acc">{f === "stale" ? t("{n} days in this stage", { n: daysSince(deal.stage_at, today()) }) : t(FLAG_LABELS[f])}</span>)}</span>;
}

function StagePill({ stage }: { stage: string }) {
  const cls = stage === "paid" ? "p-ok" : stage === "on_hold" || stage === "lost" ? "p-warn" : "p-info";
  return <span className={`pill ${cls}`}>{S(stage)}</span>;
}

type View = "board" | "list" | "orders" | "hold" | "closed";

export function MachineSales({ me, tab }: { me: Me; tab?: string }) {
  const { data, error } = useLoad<{ deals: Row[] }>(() => api("/machine-sales"));
  const prices = can(me, "machinesales.prices");
  const [q, setQ] = useState("");
  const view: View = (["list", "orders", "hold", "closed"] as const).find((v) => v === tab) ?? "board";
  const all = data?.deals ?? [];
  const selling = all.filter((d) => SELLING.has(d.stage));
  const orders = all.filter((d) => ORDERS.has(d.stage));
  const held = all.filter((d) => d.stage === "on_hold");
  const closed = all.filter((d) => !isOpen(d.stage));
  const attention = all.filter((d) => flags(d as never, today()).length).length;
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = view === "orders" ? orders : view === "hold" ? held : view === "closed" ? closed : all.filter((d) => isOpen(d.stage) && d.stage !== "on_hold");
    return pool.filter((d) => {
      const text = [d.number, d.customer, d.site, d.title, d.machine_type, d.owner, d.customer_po, d.machine].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    }).sort(byNext);
  }, [all, view, q]);

  const tabs: { id: View; label: string }[] = [
    { id: "board", label: t("Board") },
    { id: "list", label: t("List") },
    { id: "orders", label: t("Orders {n}", { n: orders.length }) },
    { id: "hold", label: t("On hold {n}", { n: held.length }) },
    { id: "closed", label: t("Closed {n}", { n: closed.length }) },
  ];
  const tiles = [
    { n: data ? String(selling.length) : "–", l: t("Deals being sold") },
    ...(prices ? [{ n: data ? money(sum(selling, (d) => d.value ?? 0)) : "–", l: t("Open value") }, { n: data ? money(sum(selling, weighted)) : "–", l: t("Weighted value") }] : []),
    { n: data ? String(selling.filter((d) => QUOTED.has(d.stage)).length) : "–", l: t("Quotes out") },
    { n: data ? String(orders.length) : "–", l: t("Orders being delivered") },
    { n: data ? String(attention) : "–", l: t("Need attention"), warn: attention > 0 },
  ];

  return (
    <>
      <PageHead title={t("Machine sales")} sub={t("Every new-machine deal, from the first call to a machine running on the customer's line.")} tip="machine-sales.head">
        {can(me, "machinesales.add") && <button className="btn primary" onClick={() => navigate("/machine-sales/new")}>{t("New deal")}</button>}
      </PageHead>
      <ErrorNote error={error} />
      <div className={`cp-tiles ${prices ? "six" : ""}`}>
        {tiles.map((x) => <div key={x.l} className={`panel cp-tile ms-tile${x.warn ? " warn" : ""}`}><span className="n">{x.n}</span><span className="l">{x.l}</span></div>)}
      </div>
      <div className="row cp-filters">
        <div className="seg po-tabs" role="tablist" aria-label={t("Machine sales")}>
          {tabs.map((x) => <button key={x.id} type="button" role="tab" aria-selected={view === x.id} className={view === x.id ? "on" : ""} onClick={() => navigate(x.id === "board" ? "/machine-sales" : `/machine-sales/${x.id}`)}>{x.label}</button>)}
        </div>
        <input className="panel" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search customer, machine, salesperson or PO")} aria-label={t("Search deals")} />
      </div>
      {data && !all.length && <div className="panel"><Empty>{can(me, "machinesales.add") ? t("No deals yet. Press New deal to add the first one.") : t("No deals yet.")}</Empty></div>}
      {!!all.length && view === "board" && (
        <div className="ms-board" role="list" aria-label={t("Pipeline")}>
          {BOARD.map((s) => {
            const col = shown.filter((d) => d.stage === s);
            return (
              <section key={s} className="ms-col" role="listitem" aria-label={S(s)}>
                <header>
                  <h2>{S(s)} <span className="muted">{col.length}</span></h2>
                  {prices && <p className="muted mono">{money(sum(col, (d) => d.value ?? 0))}{SELLING.has(s) ? ` · ${t("weighted {v}", { v: money(sum(col, weighted)) })}` : ""}</p>}
                </header>
                {col.map((d) => <Card key={d.id} deal={d} prices={prices} />)}
                {!col.length && <p className="muted ms-none">{t("None")}</p>}
              </section>
            );
          })}
        </div>
      )}
      {!!all.length && view !== "board" && (
        <div className="panel tbl">
          {!shown.length && <Empty>{t("No deals match.")}</Empty>}
          {!!shown.length && (
            <table className="cp-table">
              <thead><tr><th>{t("Deal")}</th><th>{t("Customer")}</th><th>{t("Machine")}</th><th>{t("Stage")}</th>{prices && <th className="num">{t("Value")}</th>}<th>{view === "orders" ? t("Target ship date") : t("Expected PO month")}</th><th>{t("Salesperson")}</th><th>{t("Next step")}</th></tr></thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id} className="click" onClick={() => navigate(`/machine-sales/${d.id}`)}>
                    <td className="mono"><Link to={`/machine-sales/${d.id}`}>{d.number}</Link></td>
                    <td>{d.customer}{d.site ? <span className="muted"> · {d.site}</span> : null}</td>
                    <td>{d.title ?? d.machine_type ?? "–"}{d.machine ? <span className="mono muted"> {d.machine}</span> : null}</td>
                    <td><StagePill stage={d.stage} /> <Flags deal={d} /></td>
                    {prices && <td className="num">{money(d.value)}</td>}
                    <td>{view === "orders" ? day(d.target_ship) : month(d.expected_po)}</td>
                    <td>{d.owner ?? "–"}</td>
                    <td>{d.stage === "on_hold" ? t("Reconnect on {d}", { d: day(d.hold_until) }) : d.stage === "lost" ? (d.lost_reason ?? "–") : d.next_step ? `${d.next_step}${d.next_step_date ? ` · ${day(d.next_step_date)}` : ""}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

function Card({ deal: d, prices }: { deal: Row; prices: boolean }) {
  const fs = flags(d as never, today());
  return (
    <Link to={`/machine-sales/${d.id}`} className={`panel ms-card${fs.includes("stale") ? " stale" : ""}`}>
      <strong>{d.customer}</strong>
      <span>{d.title ?? d.machine_type ?? d.number}</span>
      <span className="row ms-meta">
        {prices && <span className="mono">{money(d.value)}</span>}
        {d.expected_po && <span className="muted">{t("PO {m}", { m: month(d.expected_po) })}</span>}
        {d.owner && <span className="muted">{d.owner}</span>}
      </span>
      {d.next_step && <span className="muted ms-next">{d.next_step}{d.next_step_date ? ` · ${day(d.next_step_date)}` : ""}</span>}
      <Flags deal={d} />
    </Link>
  );
}

// ---------- One deal ----------

export function MachineDealPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad<{ deal: Row; notes: Row[]; history: Row[]; machines: Row[]; quotes?: Row[] }>(() => api(`/machine-sales/${enc(id)}`), [id]);
  const [editing, setEditing] = useState(false);
  const [move, setMove] = useState<Stage | null>(null);
  const [need, setNeed] = useState("");
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState({ kind: "call", body: "", next_step: "", next_step_date: "" });
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <div className="boot" aria-busy="true" />;
  const d = data.deal;
  const edit = can(me, "machinesales.edit");
  const prices = can(me, "machinesales.prices");
  const at = LINE.indexOf(d.stage);
  const fs = flags(d as never, today());

  async function patch(b: Record<string, unknown>, done?: string) {
    setBusy(true);
    try {
      await api(`/machine-sales/${enc(id)}`, { method: "PATCH", body: { ...b, revision: d.revision } });
      if (done) toast(done);
      setMove(null);
      setNeed("");
      reload();
    } catch (x) {
      toast((x as Error).message);
      if ((x as { status?: number }).status === 409) reload();
    } finally {
      setBusy(false);
    }
  }
  /** Move to a stage. A stage that needs something first (the PO, a reason, a reconnect date) asks for it. */
  function go(s: Stage) {
    const f = stageNeeds(s);
    if (f && !d[f]) { setMove(s); setNeed(""); return; }
    void patch({ stage: s }, t("Moved to {s}", { s: S(s) }));
  }
  async function log(e: React.FormEvent) {
    e.preventDefault();
    if (!note.body.trim()) return;
    setBusy(true);
    try {
      await api(`/machine-sales/${enc(id)}/notes`, { body: { kind: note.kind, body: note.body } });
      if (note.next_step.trim()) {
        const fresh = await api<{ deal: Row }>(`/machine-sales/${enc(id)}`);
        await api(`/machine-sales/${enc(id)}`, { method: "PATCH", body: { next_step: note.next_step, next_step_date: note.next_step_date || null, revision: fresh.deal.revision } });
      }
      setNote({ kind: "call", body: "", next_step: "", next_step_date: "" });
      toast(t("Logged"));
      reload();
    } catch (x) {
      toast((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!sure) {
      setSure(true);
      toast(t("Press Remove again to remove this deal. It stays in the record but is no longer listed."));
      return;
    }
    try {
      await api(`/machine-sales/${enc(id)}`, { method: "DELETE" });
      toast(t("Deal removed"));
      navigate("/machine-sales");
    } catch (x) {
      toast((x as Error).message);
    }
  }

  async function newQuote(copy?: string) {
    setBusy(true);
    try {
      const r = await api<{ id: string }>(`/machine-sales/${enc(id)}/quotes`, { body: copy ? { copy_from: copy } : {} });
      navigate(`/machine-sales/${id}/quotes/${r.id}`);
    } catch (x) {
      toast((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const quotes = data.quotes ?? [];

  if (editing) return <DealEdit me={me} deal={d} onDone={(saved) => { setEditing(false); if (saved) { reload(); toast(t("Saved")); } }} />;

  const needField = move ? stageNeeds(move) : null;
  const timeline = [
    ...data.notes.map((n) => ({ at: n.at as string, who: n.who as string | null, kind: n.kind as string, body: n.body as string, changes: null as Row | null })),
    ...data.history.filter((h) => h.action !== "machine_deal.note").map((h) => ({ at: h.at as string, who: h.who as string | null, kind: h.action === "machine_deal.create" ? "created" : h.action === "machine_deal.quote" ? "quote" : "changed", body: h.action === "machine_deal.quote" ? `${h.quote ?? ""}: ${t(QUOTE_EVENTS[h.status as string] ?? "Changed")}` : "", changes: h.changes as Row | null })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const fact = (label: string, value: React.ReactNode) => <div className="ms-fact"><dt>{label}</dt><dd>{value || "–"}</dd></div>;
  const histLabel = (k: string) => k === "stage" ? t("Stage") : k in DEAL_LABELS ? L(k as DealField) : k;
  const histValue = (k: string, v: unknown) => v == null || v === "" ? "–" : k === "stage" ? S(String(v)) : k === "value" ? t("Changed") : k === "funded" ? (v ? t("Yes") : t("No")) : String(v);

  return (
    <>
      <PageHead title={`${d.number} · ${d.customer}`} sub={[d.title ?? d.machine_type, d.site].filter(Boolean).join(" · ")}>
        {edit && <button className="btn" onClick={() => setEditing(true)}>{t("Edit")}</button>}
        {can(me, "machinesales.remove") && <button className="btn" onClick={remove}>{sure ? t("Remove (press again)") : t("Remove")}</button>}
      </PageHead>

      <div className="panel ms-stages">
        <ol className="ms-bar" aria-label={t("Stage")}>
          {LINE.map((s, i) => {
            const state = at < 0 ? (s === d.prev_stage ? "was" : "") : i < at ? "done" : i === at ? "now" : "";
            return (
              <li key={s} className={state}>
                {edit && i !== at ? <button type="button" disabled={busy} onClick={() => go(s)} title={t("Move to {s}", { s: S(s) })}>{S(s)}</button> : <span aria-current={i === at ? "step" : undefined}>{S(s)}</span>}
              </li>
            );
          })}
        </ol>
        <p className="row ms-stage-line">
          <StagePill stage={d.stage} />
          <span className="muted">{t("{n} days in this stage", { n: daysSince(d.stage_at, today()) })}{STAGE_DAYS[d.stage as Stage] ? ` · ${t("turns red after {n}", { n: STAGE_DAYS[d.stage as Stage]! })}` : ""}</span>
          {edit && d.stage !== "on_hold" && isOpen(d.stage) && <button type="button" className="btn" onClick={() => go("on_hold")}>{t("Put on hold")}</button>}
          {edit && d.stage !== "lost" && d.stage !== "paid" && <button type="button" className="btn" onClick={() => go("lost")}>{t("Mark lost")}</button>}
          {edit && (d.stage === "on_hold" || d.stage === "lost") && d.prev_stage && <button type="button" className="btn primary" onClick={() => go(d.prev_stage)}>{t("Pick back up at {s}", { s: S(d.prev_stage) })}</button>}
        </p>
        {move && needField && (
          <form className="row ms-need" onSubmit={(e) => { e.preventDefault(); if (need.trim()) void patch({ stage: move, [needField]: need }, t("Moved to {s}", { s: S(move) })); }}>
            <label htmlFor="ms-need">{needField === "customer_po" ? t("Customer's PO number, to move to {s}", { s: S(move) }) : needField === "lost_reason" ? t("Why was it lost?") : t("Reconnect on")}</label>
            <input id="ms-need" autoFocus required type={needField === "hold_until" ? "date" : "text"} value={need} onChange={(e) => setNeed(e.target.value)} />
            <button className="btn primary" type="submit" disabled={busy}>{t("Confirm")}</button>
            <button className="btn" type="button" onClick={() => setMove(null)}>{t("Cancel")}</button>
          </form>
        )}
      </div>

      <div className="ms-page">
        <div className="panel">
          <h2>{t("Facts")}</h2>
          <dl className="ms-facts">
            {fact(L("customer"), d.customer)}
            {fact(L("site"), d.site)}
            {fact(L("machine_type"), d.machine_type)}
            {fact(L("speed_bpm"), d.speed_bpm)}
            {fact(L("formats"), d.formats)}
            {prices && fact(L("value"), money(d.value))}
            {fact(L("chance"), `${chanceOf(d)}%`)}
            {prices && fact(t("Weighted value"), money(weighted(d)))}
            {fact(L("expected_po"), month(d.expected_po))}
            {fact(L("funded"), d.funded ? t("Yes") : t("No"))}
            {fact(L("decision_date"), d.decision_date && day(d.decision_date))}
            {fact(L("owner"), d.owner)}
            {fact(L("lead_source"), d.lead_source)}
            {fact(L("competitor"), d.competitor)}
            {fact(L("customer_po"), d.customer_po)}
            {fact(L("target_ship"), d.target_ship && day(d.target_ship))}
            {fact(L("machine"), d.machine)}
            {d.stage === "lost" && fact(L("lost_reason"), d.lost_reason)}
            {d.stage === "on_hold" && fact(L("hold_until"), day(d.hold_until))}
          </dl>
          {d.notes && <p className="ms-notes">{d.notes}</p>}
        </div>

        <div className="stack">
          <div className={`panel ms-due${fs.length ? " warn" : ""}`}>
            <h2>{t("What's due")}</h2>
            {d.next_step ? <p><strong>{d.next_step}</strong>{d.next_step_date ? ` · ${day(d.next_step_date)}` : ""}</p> : <p className="muted">{isOpen(d.stage) && d.stage !== "on_hold" ? t("No next step yet. Log a call or visit below and set one.") : t("Nothing due.")}</p>}
            <Flags deal={d} />
            {edit && d.next_step && <p><button type="button" className="btn" disabled={busy} onClick={() => void patch({ next_step: null, next_step_date: null }, t("Next step done"))}>{t("Mark done")}</button></p>}
          </div>
          {edit && (
            <form className="panel stack ms-log" onSubmit={log}>
              <h2>{t("Log a call, visit or note")}</h2>
              <div className="seg" role="radiogroup" aria-label={t("What are you logging?")}>
                {NOTE_KINDS.map((k) => <button key={k} type="button" role="radio" aria-checked={note.kind === k} className={note.kind === k ? "on" : ""} onClick={() => setNote({ ...note, kind: k })}>{t(NOTE_LABELS[k])}</button>)}
              </div>
              <textarea rows={3} aria-label={t("What happened")} placeholder={t("What happened")} value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} />
              <div className="row ms-nextrow">
                <input aria-label={L("next_step")} placeholder={t("Next step (optional)")} value={note.next_step} onChange={(e) => setNote({ ...note, next_step: e.target.value })} />
                <input aria-label={L("next_step_date")} type="date" value={note.next_step_date} onChange={(e) => setNote({ ...note, next_step_date: e.target.value })} />
                <button className="btn primary" type="submit" disabled={busy || !note.body.trim()}>{t("Log it")}</button>
              </div>
            </form>
          )}
          <div className="panel">
            <h2>{t("Timeline")}</h2>
            {!timeline.length && <Empty>{t("Nothing logged yet.")}</Empty>}
            <ul className="cp-history">
              {timeline.map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="muted">{fmtTime(h.at)} · {h.who ?? "–"}</span>{" "}
                  {h.kind in NOTE_LABELS ? <><span className="pill p-info">{t(NOTE_LABELS[h.kind as keyof typeof NOTE_LABELS])}</span><div className="ms-notes">{h.body}</div></> : <strong>{h.kind === "created" ? t("Deal added") : h.kind === "quote" ? `${t("Quote")} ${h.body}` : t("Changed")}</strong>}
                  {h.changes && <ul>{Object.entries(h.changes).map(([k, v]) => <li key={k}>{histLabel(k)}: {histValue(k, (v as unknown[])[0])} → {histValue(k, (v as unknown[])[1])}</li>)}</ul>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <h2>{t("Quotes")}</h2>
            {!quotes.length && <Empty>{t("No quote yet.")}</Empty>}
            <ul className="cp-history ms-quotes">
              {quotes.map((q) => (
                <li key={q.id}>
                  {prices ? <Link to={`/machine-sales/${id}/quotes/${q.id}`} className="mono">{q.number}</Link> : <span className="mono">{q.number}</span>}{" "}
                  <QuoteStatusPill status={q.status} />
                  <div className="muted">{t(QUOTE_KIND_LABELS[q.kind as QuoteKind] ?? q.kind)}{q.totals ? ` · ${money(q.totals.total)}` : ""}{q.sent_at ? ` · ${day(q.sent_at)}` : ""}</div>
                </li>
              ))}
            </ul>
            {edit && prices && <p><button type="button" className="btn" disabled={busy} onClick={() => void newQuote(quotes[0]?.id)}>{quotes.length ? t("New revision") : t("New quote")}</button></p>}
            {!prices && !!quotes.length && <p className="muted">{t("Quotes open for people who may see deal values.")}</p>}
          </div>
          <div className="panel">
            <h2>{t("Contact")}</h2>
            {d.contact || d.contact_email || d.contact_phone ? (
              <p>{d.contact}<br />{d.contact_email && <a href={`mailto:${d.contact_email}`}>{d.contact_email}</a>}{d.contact_email && d.contact_phone ? <br /> : null}{d.contact_phone && <a href={`tel:${d.contact_phone}`}>{d.contact_phone}</a>}</p>
            ) : <Empty>{t("No contact yet.")}</Empty>}
          </div>
          {can(me, "machines.view") && (
            <div className="panel">
              <h2>{t("This customer's machines")}</h2>
              {data.machines.length ? <ul className="cp-history">{data.machines.map((m) => <li key={m.id}><Link to={`/machines/${m.id}`} className="mono">{m.serial}</Link> <span className="muted">{[m.model, m.site].filter(Boolean).join(" · ")}</span></li>)}</ul> : <Empty>{t("No machines listed for this customer.")}</Empty>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------- New deal and editing ----------

export function NewMachineDeal({ me }: { me: Me }) {
  if (!can(me, "machinesales.add")) return <ErrorNote error="Your role doesn't allow this." />;
  return <DealEdit me={me} onDone={() => navigate("/machine-sales")} />;
}

const FORM: DealField[] = ["customer", "site", "title", "machine_type", "speed_bpm", "formats", "value", "chance", "expected_po", "decision_date", "owner", "lead_source", "next_step", "next_step_date", "contact", "contact_email", "contact_phone", "competitor", "customer_po", "target_ship", "machine"];

function DealEdit({ me, deal, onDone }: { me: Me; deal?: Row; onDone: (saved: boolean) => void }) {
  const prices = can(me, "machinesales.prices");
  const [f, setF] = useState<Row>(() => {
    const out: Row = { stage: deal?.stage ?? "lead", funded: !!deal?.funded, notes: deal?.notes ?? "", lost_reason: deal?.lost_reason ?? "", hold_until: deal?.hold_until ?? "" };
    for (const k of FORM) out[k] = deal?.[k] ?? "";
    return out;
  });
  const [err, setErr] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const b: Row = { ...f };
    if (!prices) delete b.value;
    try {
      if (deal) {
        await api(`/machine-sales/${enc(deal.id)}`, { method: "PATCH", body: { ...b, revision: deal.revision } });
        onDone(true);
      } else {
        const r = await api<{ id: string; number: string }>("/machine-sales", { body: b });
        toast(t("Made {n}", { n: r.number }));
        navigate(`/machine-sales/${r.id}`);
      }
    } catch (x) {
      setErr((x as Error).message);
      setStale((x as { status?: number }).status === 409);
    } finally {
      setBusy(false);
    }
  }
  const input = (k: DealField, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className="field" key={k}>
      <label htmlFor={`ms-${k}`}>{L(k)}</label>
      <input id={`ms-${k}`} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} type="text" {...extra} />
    </div>
  );

  return (
    <form onSubmit={save} className="stack">
      <PageHead title={deal ? t("Edit {n}", { n: deal.number }) : t("New machine deal")} />
      <div className="panel grid g2 cp-form">
        {input("customer", { required: true, autoFocus: !deal })}
        <div className="field">
          <label htmlFor="ms-stage">{t("Stage")}</label>
          <select id="ms-stage" value={f.stage} onChange={(e) => set("stage", e.target.value)}>
            {STAGES.map((s) => <option key={s} value={s}>{S(s)}</option>)}
          </select>
        </div>
        {input("site", { placeholder: t("e.g. Atlanta, GA plant") })}
        {input("title", { placeholder: t("e.g. 24-head filler with capper") })}
        {input("machine_type", { placeholder: t("e.g. EXACTA filler, SIRIO capper") })}
        {input("speed_bpm", { type: "number", min: 0, step: "any" })}
        {input("formats", { placeholder: t("e.g. 250 ml, 500 ml and 1 L round") })}
        {prices && input("value", { type: "number", min: 0, step: "1" })}
        {input("chance", { type: "number", min: 0, max: 100, step: "1", placeholder: t("Leave empty to use the stage's usual chance") })}
        {input("expected_po", { type: "month" })}
        {input("decision_date", { type: "date" })}
        {input("owner")}
        <div className="field">
          <label htmlFor="ms-lead_source">{L("lead_source")}</label>
          <input id="ms-lead_source" list="ms-sources" value={f.lead_source ?? ""} onChange={(e) => set("lead_source", e.target.value)} />
          <datalist id="ms-sources">{LEAD_SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="ms-funded">{L("funded")}</label>
          <select id="ms-funded" value={f.funded ? "1" : "0"} onChange={(e) => set("funded", e.target.value === "1")}>
            <option value="0">{t("No")}</option><option value="1">{t("Yes")}</option>
          </select>
        </div>
        {input("next_step", { placeholder: t("e.g. Send the firm quote") })}
        {input("next_step_date", { type: "date" })}
        {input("contact")}
        {input("contact_email", { type: "email" })}
        {input("contact_phone", { type: "tel" })}
        {input("competitor")}
        {input("customer_po")}
        {input("target_ship", { type: "date" })}
        {input("machine", { placeholder: "4222TP" })}
        {f.stage === "lost" && input("lost_reason", { placeholder: t("e.g. price, lead time, project cancelled") })}
        {f.stage === "on_hold" && input("hold_until", { type: "date" })}
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="ms-notes">{L("notes")}</label>
          <textarea id="ms-notes" rows={4} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
      <ErrorNote error={err} />
      {stale && deal && <div><button className="btn" type="button" onClick={() => onDone(true)}>{t("Show their changes")}</button></div>}
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>{deal ? t("Save") : t("Add deal")}</button>
        <button className="btn" type="button" onClick={() => onDone(false)}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

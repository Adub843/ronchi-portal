// A machine quote: one revision of the priced offer on a machine deal (rules: src/shared/machine-quotes.ts).
// A draft is edited here line by line; a sent quote is read-only and is changed by making a new revision.
// The printable quote is in English, since it goes to US customers.
import { useEffect, useState } from "react";
import {
  ORIGINS, ORIGIN_LABELS, QUOTE_KINDS, QUOTE_KIND_LABELS, QUOTE_LABELS, QUOTE_STATUS_LABELS, quoteTotals,
  type Origin, type QuoteField, type QuoteKind, type QuoteLine, type QuoteStatus,
} from "../../../src/shared/machine-quotes";
import { api, can, fmtTime, type Me } from "../api";
import logoUrl from "../assets/ronchi-logo.png";
import { ErrorNote, PageHead, toast, useLoad } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";

type Row = Record<string, any>;
type Draft = { description: string; detail: string; origin: Origin; qty: string; unit_price: string; optional: boolean };
const enc = encodeURIComponent;
const QL = (f: QuoteField) => t(QUOTE_LABELS[f]);
const usd = (n: number | null | undefined, l = loc()) => (n == null ? "–" : n.toLocaleString(l, { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 0 }));
const day = (iso: string | null | undefined, l = loc()) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(l, { month: "long", day: "numeric", year: "numeric" }) : "–");
const blank = (): Draft => ({ description: "", detail: "", origin: "italy", qty: "1", unit_price: "", optional: false });
const toDraft = (l: QuoteLine): Draft => ({ description: l.description, detail: l.detail ?? "", origin: l.origin, qty: String(l.qty), unit_price: l.unit_price == null ? "" : String(l.unit_price), optional: l.optional });
const TERMS: QuoteField[] = ["lead_time", "payment_terms", "delivery_terms", "warranty"];
const HINTS: Partial<Record<QuoteField, string>> = {
  lead_time: "For example: 26 weeks from order and approved samples",
  payment_terms: "For example: a deposit with the order, the balance before shipment",
  delivery_terms: "For example: delivered to the customer's dock, unloading by the customer",
  warranty: "For example: 12 months from start-up",
};

export function QuoteStatusPill({ status }: { status: string }) {
  const cls = status === "accepted" ? "p-ok" : status === "sent" ? "p-info" : status === "declined" ? "p-acc" : "p-warn";
  return <span className={`pill ${cls}`}>{t(QUOTE_STATUS_LABELS[status as QuoteStatus] ?? status)}</span>;
}

export function MachineQuotePage({ dealId, quoteId, me }: { dealId: string; quoteId: string; me: Me }) {
  const url = `/machine-sales/${enc(dealId)}/quotes/${enc(quoteId)}`;
  const { data, error, reload } = useLoad<{ deal: Row; quote: Row }>(() => api(url), [url]);
  const [f, setF] = useState<Row>({});
  const [lines, setLines] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!data) return;
    const q = data.quote;
    setF({ kind: q.kind, valid_until: q.valid_until ?? "", lead_time: q.lead_time ?? "", payment_terms: q.payment_terms ?? "", delivery_terms: q.delivery_terms ?? "", warranty: q.warranty ?? "", notes: q.notes ?? "", discount_pct: q.discount_pct ?? "" });
    setLines((q.lines as QuoteLine[]).map(toDraft));
    setDirty(false);
  }, [data]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <div className="boot" aria-busy="true" />;
  const d = data.deal;
  const q = data.quote;
  const mayEdit = can(me, "machinesales.edit") && can(me, "machinesales.prices");
  const draft = q.status === "draft" && mayEdit;
  const live = lines.filter((l) => l.description.trim());
  const totals = quoteTotals(live.map((l) => ({ qty: Number(l.qty) || 0, unit_price: l.unit_price === "" ? null : Number(l.unit_price.replace(/[$,\s]/g, "")), optional: l.optional, origin: l.origin })), f.discount_pct === "" ? null : Number(f.discount_pct));
  const set = (k: string, v: unknown) => { setF({ ...f, [k]: v }); setDirty(true); };
  const setLine = (i: number, k: keyof Draft, v: string | boolean) => { setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l))); setDirty(true); };

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await work();
      if (done) toast(done);
      reload();
      return true;
    } catch (x) {
      toast((x as Error).message);
      if ((x as { status?: number }).status === 409) reload();
      return false;
    } finally {
      setBusy(false);
    }
  }
  const body = () => ({ ...f, valid_until: f.valid_until || null, discount_pct: f.discount_pct === "" ? null : f.discount_pct, lines: live.map((l) => ({ ...l, unit_price: l.unit_price === "" ? null : l.unit_price })), revision: q.revision });
  const save = () => run(() => api(url, { method: "PATCH", body: body() }), t("Saved"));
  /** Send: saves what is on screen first, then marks the quote sent. */
  async function send() {
    await run(async () => {
      let rev = q.revision;
      if (dirty) rev = (await api<{ revision: number }>(url, { method: "PATCH", body: body() })).revision;
      await api(`${url}/status`, { body: { status: "sent", revision: rev } });
    }, t("Quote marked sent. The deal's value now matches it."));
  }
  const answer = (status: QuoteStatus) => run(() => api(`${url}/status`, { body: { status, revision: q.revision } }));
  async function revise() {
    setBusy(true);
    try {
      const r = await api<{ id: string }>(`/machine-sales/${enc(dealId)}/quotes`, { body: { copy_from: q.id } });
      navigate(`/machine-sales/${dealId}/quotes/${r.id}`);
    } catch (x) {
      toast((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!sure) { setSure(true); toast(t("Press Remove again to throw this draft away.")); return; }
    if (await run(() => api(url, { method: "DELETE" }), t("Draft removed"))) navigate(`/machine-sales/${dealId}`);
  }

  if (printing) return <PrintQuote deal={d} quote={{ ...q, ...f, lines: live.map((l) => ({ ...l, qty: Number(l.qty) || 0, unit_price: l.unit_price === "" ? null : Number(l.unit_price) })) }} totals={totals} onClose={() => setPrinting(false)} />;

  return (
    <>
      <PageHead title={`${t("Quote")} ${q.number}`} sub={[d.customer, d.title ?? d.machine_type].filter(Boolean).join(" · ")}>
        <button className="btn" onClick={() => setPrinting(true)}>{t("Print or save as PDF")}</button>
        {mayEdit && q.status !== "draft" && <button className="btn" disabled={busy} onClick={revise}>{t("New revision")}</button>}
        {draft && <button className="btn" disabled={busy} onClick={remove}>{sure ? t("Remove (press again)") : t("Remove")}</button>}
        {draft && <button className="btn" disabled={busy || !dirty} onClick={save}>{t("Save")}</button>}
        {draft && <button className="btn primary" disabled={busy || !live.length} onClick={send}>{t("Mark as sent")}</button>}
      </PageHead>

      <div className="panel row mq-status">
        <QuoteStatusPill status={q.status} />
        <span className="muted">
          {q.status === "draft" ? t("A draft. Nobody outside has seen it. Mark it as sent once it has gone to the customer.")
            : q.status === "superseded" ? t("A newer revision replaced this quote.")
            : `${t("Sent")} ${q.sent_at ? fmtTime(q.sent_at) : ""}. ${t("A sent quote is not changed. Press New revision to change it.")}`}
        </span>
        {mayEdit && q.status === "sent" && <><button className="btn primary" disabled={busy} onClick={() => answer("accepted")}>{t("Customer accepted")}</button><button className="btn" disabled={busy} onClick={() => answer("declined")}>{t("Customer declined")}</button></>}
        {mayEdit && (q.status === "accepted" || q.status === "declined") && <button className="btn" disabled={busy} onClick={() => answer("sent")}>{t("Back to sent")}</button>}
      </div>

      <div className="panel tbl">
        <h2>{t("What is offered")}</h2>
        <table className="mq-lines">
          <thead><tr><th>{t("Description")}</th><th>{t("Built in")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Price each")}</th><th className="num">{t("Amount")}</th><th>{t("Option")}</th>{draft && <th />}</tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const amount = (Number(l.qty) || 0) * (Number(l.unit_price.replace(/[$,\s]/g, "")) || 0);
              return draft ? (
                <tr key={i}>
                  <td>
                    <input value={l.description} aria-label={t("Description")} placeholder={t("For example: EXACTA filler, 16 heads")} onChange={(e) => setLine(i, "description", e.target.value)} />
                    <textarea rows={2} value={l.detail} aria-label={t("More about this line")} placeholder={t("More about this line (optional)")} onChange={(e) => setLine(i, "detail", e.target.value)} />
                  </td>
                  <td><select value={l.origin} aria-label={t("Built in")} onChange={(e) => setLine(i, "origin", e.target.value)}>{ORIGINS.map((o) => <option key={o} value={o}>{t(ORIGIN_LABELS[o])}</option>)}</select></td>
                  <td className="num"><input className="mq-n" inputMode="decimal" value={l.qty} aria-label={t("Qty")} onChange={(e) => setLine(i, "qty", e.target.value)} /></td>
                  <td className="num"><input className="mq-p" inputMode="decimal" value={l.unit_price} aria-label={t("Price each")} onChange={(e) => setLine(i, "unit_price", e.target.value)} /></td>
                  <td className="num">{usd(amount)}</td>
                  <td><input type="checkbox" checked={l.optional} aria-label={t("Option")} onChange={(e) => setLine(i, "optional", e.target.checked)} /></td>
                  <td><button type="button" className="btn" aria-label={t("Remove line")} onClick={() => { setLines(lines.filter((_, j) => j !== i)); setDirty(true); }}>×</button></td>
                </tr>
              ) : (
                <tr key={i}>
                  <td><strong>{l.description}</strong>{l.detail && <div className="ms-notes muted">{l.detail}</div>}</td>
                  <td>{t(ORIGIN_LABELS[l.origin])}</td><td className="num">{l.qty}</td><td className="num">{usd(l.unit_price === "" ? null : Number(l.unit_price))}</td><td className="num">{usd(amount)}</td><td>{l.optional ? t("Option") : ""}</td>
                </tr>
              );
            })}
            {!lines.length && <tr><td colSpan={draft ? 7 : 6} className="muted">{t("No lines yet.")}</td></tr>}
          </tbody>
        </table>
        {draft && <p style={{ margin: "10px 12px" }}><button type="button" className="btn" onClick={() => { setLines([...lines, blank()]); setDirty(true); }}>{t("Add a line")}</button></p>}
        <dl className="mq-totals">
          <div><dt>{t("Subtotal")}</dt><dd>{usd(totals.subtotal)}</dd></div>
          <div><dt>{QL("discount_pct")}</dt><dd>{draft ? <input className="mq-n" inputMode="decimal" value={f.discount_pct ?? ""} aria-label={QL("discount_pct")} onChange={(e) => set("discount_pct", e.target.value)} /> : `${q.discount_pct ?? 0}%`}{totals.discount ? ` · −${usd(totals.discount)}` : ""}</dd></div>
          <div className="big"><dt>{t("Total")}</dt><dd>{usd(totals.total)}</dd></div>
          {!!totals.options && <div><dt>{t("Options, not in the total")}</dt><dd>{usd(totals.options)}</dd></div>}
          {!!totals.italy && !!totals.us && <div><dt>{t("Built in Italy")} / {t("Built in the US")}</dt><dd>{usd(totals.italy)} / {usd(totals.us)}</dd></div>}
        </dl>
      </div>

      <div className="panel stack">
        <h2>{t("Terms")}</h2>
        <div className="mq-terms">
          <label>{QL("kind")}
            {draft ? <select value={f.kind} onChange={(e) => set("kind", e.target.value)}>{QUOTE_KINDS.map((k) => <option key={k} value={k}>{t(QUOTE_KIND_LABELS[k])}</option>)}</select> : <span>{t(QUOTE_KIND_LABELS[q.kind as QuoteKind] ?? q.kind)}</span>}
          </label>
          <label>{QL("valid_until")}
            {draft ? <input type="date" value={f.valid_until ?? ""} onChange={(e) => set("valid_until", e.target.value)} /> : <span>{day(q.valid_until)}</span>}
          </label>
          {TERMS.map((k) => (
            <label key={k}>{QL(k)}
              {draft ? <input value={f[k] ?? ""} placeholder={t(HINTS[k]!)} onChange={(e) => set(k, e.target.value)} /> : <span>{q[k] || "–"}</span>}
            </label>
          ))}
          <label className="wide">{QL("notes")}
            {draft ? <textarea rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /> : <span className="ms-notes">{q.notes || "–"}</span>}
          </label>
        </div>
      </div>
    </>
  );
}

/** The quote as the customer gets it: one page to print or save as PDF. English, like the other papers that leave the building. */
function PrintQuote({ deal: d, quote: q, totals, onClose }: { deal: Row; quote: Row; totals: ReturnType<typeof quoteTotals>; onClose: () => void }) {
  const lines = q.lines as QuoteLine[];
  const firm = lines.filter((l) => !l.optional);
  const options = lines.filter((l) => l.optional);
  const money = (n: number | null | undefined) => usd(n, "en-US");
  const table = (ls: QuoteLine[]) => (
    <table className="mini" style={{ marginTop: 8 }}>
      <thead><tr><th>#</th><th>Description</th><th>Qty</th><th style={{ textAlign: "right" }}>Price each</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
      <tbody>{ls.map((l, i) => <tr key={i}><td>{i + 1}</td><td><b>{l.description}</b>{l.detail && <div style={{ whiteSpace: "pre-wrap" }}>{l.detail}</div>}</td><td>{l.qty}</td><td style={{ textAlign: "right" }}>{money(l.unit_price)}</td><td style={{ textAlign: "right" }}>{money(l.unit_price == null ? null : l.qty * l.unit_price)}</td></tr>)}</tbody>
    </table>
  );
  const term = (label: string, v: string | null | undefined) => (v ? <p style={{ margin: "4px 0" }}><b>{label}:</b> {v}</p> : null);
  return (
    <div className="printdoc">
      <div className="row noprint" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => window.print()}>{t("Print or save as PDF")}</button>
        <button className="btn" onClick={onClose}>{t("Close")}</button>
      </div>
      <div className="paper">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <img src={logoUrl} alt="Ronchi" style={{ height: 40 }} />
          <span className="spacer" />
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0 }}>{q.kind === "budget" ? "Budget quotation" : "Quotation"}</h1>
            <div className="mono">{q.number}</div>
            <div>Date: {day(q.sent_at ?? new Date().toISOString(), "en-US")}</div>
            {q.valid_until && <div>Valid until: {day(q.valid_until, "en-US")}</div>}
          </div>
        </div>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <div><b>From</b><div>Ronchi America</div>{d.owner && <div>{d.owner}</div>}</div>
          <div><b>To</b><div>{d.customer}</div>{d.site && <div>{d.site}</div>}{d.contact && <div>Attn: {d.contact}</div>}</div>
        </div>
        {(d.title || d.machine_type) && <p style={{ marginTop: 12 }}><b>Subject:</b> {[d.title, d.machine_type].filter(Boolean).join(" · ")}</p>}
        {table(firm)}
        <div style={{ textAlign: "right", marginTop: 8 }}>
          {!!totals.discount && <><div>Subtotal: {money(totals.subtotal)}</div><div>Discount ({q.discount_pct}%): −{money(totals.discount)}</div></>}
          <div style={{ fontSize: 18 }}><b>Total: {money(totals.total)}</b></div>
          <div className="small1">US dollars. Taxes not included.</div>
        </div>
        {!!options.length && <><h2 style={{ fontSize: 16, marginTop: 16 }}>Options, not included in the total</h2>{table(options)}</>}
        <div style={{ marginTop: 16 }}>
          {term("Lead time", q.lead_time)}
          {term("Payment terms", q.payment_terms)}
          {term("Delivery terms", q.delivery_terms)}
          {term("Warranty", q.warranty)}
          {q.notes && <p style={{ whiteSpace: "pre-wrap" }}>{q.notes}</p>}
        </div>
        {q.kind === "budget" && <p className="small1" style={{ marginTop: 12 }}>This is a budget quotation for planning. A firm quotation follows once the specification and samples are confirmed.</p>}
      </div>
    </div>
  );
}

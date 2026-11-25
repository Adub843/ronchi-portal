// The Ronchi workbook's job paperwork on each work order (Aaron, 2026-11-25): the job chat, and each field
// service engineer's time sheet and service report, brought in from the old standalone "Ronchi Field
// Service Workbook" app. Everything saves as it is typed (components/autosave.tsx); photos, receipts and
// the signature save the moment they are added. Reviewers see every engineer's paperwork and approve it or
// send it back. Server: src/portal/routes/reports.ts. Shared maths and checks: src/shared/reports.ts.
//
// No money: expenses have a type, description, quantity and receipt photo, never an amount. No clock:
// times are typed, nothing records when or where someone was.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import logoUrl from "../assets/ronchi-logo.png";
import { api, apiForm, can, fmtDate, type Me } from "../api";
import { SaveStatus, track, useFields } from "../components/autosave";
import { Close } from "../components/icons";
import { Empty, ErrorNote, Link, toast, useLoad } from "../components/ui";
import { loc, t } from "../i18n";
import { EXPENSE_TYPES, expenseType, fmtHours, hoursToMin, sheetTotals, workMinutes, type DocStatus } from "../../../src/shared/reports";
import { BoardPage } from "./Boards";

export const DOC_STATUS_LABEL: Record<DocStatus, string> = { draft: "Draft", sent: "Waiting for review", approved: "Approved", returned: "Sent back" };
const STATUS_PILL: Record<DocStatus, string> = { draft: "", sent: "p-info", approved: "p-ok", returned: "p-warn" };

export function DocStatusPill({ status }: { status: DocStatus }) {
  return <span className={`pill ${STATUS_PILL[status] || "p-draft"}`}>{t(DOC_STATUS_LABEL[status])}</span>;
}

export type PaperTab = "sheet" | "report" | "chat";

// A link from the Reports page opens a work order on one engineer's sheet or report.
let target: { who?: string; tab?: PaperTab } = {};
export function setWorkOrderTarget(next: { who?: string; tab?: PaperTab }) {
  target = next;
}
export function takeWorkOrderTarget() {
  const t0 = target;
  target = {};
  return t0;
}

const fileSrc = (f: { id: string; url?: string }, download = false) => f.url ?? `/api/reports/files/${encodeURIComponent(f.id)}${download ? "?download=1" : ""}`;
const hrs = (min: number) => String(Number((min / 60).toFixed(2)));
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString(loc(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** Everyone's paperwork for one job, for the work order's tabs. */
export function JobPaperwork({ jobId, me, tab, who: initialWho }: { jobId: string; me: Me; tab: PaperTab; who?: string }) {
  const jid = encodeURIComponent(jobId);
  const { data, error, reload } = useLoad<any>(() => api(`/reports/jobs/${jid}`), [jobId]);
  const [who, setWho] = useState<string | null>(initialWho ?? null);
  const [printing, setPrinting] = useState(false);
  const starting = useRef(false);

  const mineSheet = data?.sheets.find((s: any) => s.user_id === me.id);
  // An engineer on the job gets their own time sheet and report the first time they open either tab.
  useEffect(() => {
    if (!data?.canStart || mineSheet || starting.current || tab === "chat") return;
    starting.current = true;
    track(api(`/reports/jobs/${jid}/start`, { body: {} })).then(reload, () => undefined).finally(() => (starting.current = false));
  }, [data, tab]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  if (tab === "chat") return <JobChat jobId={jobId} chat={data.chat} me={me} />;

  // The engineers whose paperwork can be shown: everyone on the job, plus anyone who has paperwork from before.
  const people = new Map<string, string>();
  for (const x of data.job.techs) people.set(x.id, x.name);
  for (const s of data.sheets) people.set(s.user_id, s.user_name);
  for (const r of data.reports) people.set(r.report.user_id, r.report.user_name);
  const visible = [...people].filter(([id]) => data.canReview || id === me.id);
  const current = who && people.has(who) ? who : visible.find(([id]) => id === me.id)?.[0] ?? visible[0]?.[0] ?? null;
  const sheet = data.sheets.find((s: any) => s.user_id === current);
  const rep = data.reports.find((r: any) => r.report.user_id === current);

  if (!visible.length) {
    return <div className="panel"><Empty>{data.canReview ? t("No field service engineers on this job yet.") : t("Only the field service engineers on this job fill in its time sheets and service reports.")}</Empty></div>;
  }
  if (printing && rep) return <ReportPrint job={data.job} data={rep} onClose={() => setPrinting(false)} />;

  return (
    <div className="stack">
      {data.canReview && visible.length > 0 && (
        <div className="wb-people" role="tablist" aria-label={t("Field service engineers")}>
          {visible.map(([id, name]) => {
            const doc = tab === "sheet" ? data.sheets.find((s: any) => s.user_id === id) : data.reports.find((r: any) => r.report.user_id === id)?.report;
            return (
              <button key={id} type="button" role="tab" aria-selected={id === current} className={id === current ? "on" : ""} onClick={() => setWho(id)}>
                <span>{id === me.id ? t("You") : name}</span>
                {doc ? <DocStatusPill status={doc.status} /> : <span className="pill p-none">{t("Not started")}</span>}
              </button>
            );
          })}
        </div>
      )}
      {tab === "sheet" && (sheet ? <TimeSheet key={sheet.id} sheet={sheet} me={me} canReview={data.canReview} reload={reload} /> : <NotStarted mine={current === me.id} />)}
      {tab === "report" && (rep ? <ServiceReport key={rep.report.id} job={data.job} data={rep} me={me} canReview={data.canReview} reload={reload} onPrint={() => setPrinting(true)} /> : <NotStarted mine={current === me.id} />)}
    </div>
  );
}

function NotStarted({ mine }: { mine: boolean }) {
  return <div className="panel"><Empty>{mine ? t("Getting your paperwork ready…") : t("This field service engineer hasn't started yet.")}</Empty></div>;
}

// ───────────────────────────── Review bar ─────────────────────────────

function DocBar({ kind, doc, me, canReview, reload, children }: { kind: "sheets" | "service"; doc: any; me: Me; canReview: boolean; reload: () => void; children?: React.ReactNode }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = doc.user_id === me.id;
  async function step(action: "send" | "recall" | "approve" | "return", body: unknown = {}) {
    setBusy(true);
    try {
      await track(api(`/reports/${kind}/${encodeURIComponent(doc.id)}/${action}`, { body }));
      setNote(null);
      toast(action === "send" ? t("Sent for review") : action === "approve" ? t("Approved") : action === "return" ? t("Sent back") : t("Back to draft"));
      reload();
    } catch {
      /* shown by track() */
    } finally {
      setBusy(false);
    }
  }
  const status = doc.status as DocStatus;
  return (
    <div className="wb-bar">
      <div className="wb-bar-main">
        <DocStatusPill status={status} />
        <span className="muted wb-bar-who">
          {status === "sent" && doc.sent_at ? t("Sent {when}", { when: fmtWhen(doc.sent_at) }) : null}
          {status === "approved" && t("Approved by {name}, {when}", { name: doc.reviewer_name ?? "", when: fmtWhen(doc.reviewed_at) })}
          {status === "returned" && t("Sent back by {name}, {when}", { name: doc.reviewer_name ?? "", when: fmtWhen(doc.reviewed_at) })}
          {status === "draft" && mine && t("Saves as you type. Send it for review when it's complete.")}
        </span>
        <span className="spacer" />
        {mine && (status === "draft" || status === "returned") && <SaveStatus />}
        {children}
        {mine && (status === "draft" || status === "returned") && <button className="btn primary" disabled={busy} onClick={() => step("send")}>{t("Send for review")}</button>}
        {mine && status === "sent" && <button className="btn" disabled={busy} onClick={() => step("recall")}>{t("Take back to edit")}</button>}
        {canReview && status === "sent" && !mine && <button className="btn primary" disabled={busy} onClick={() => step("approve")}>{t("Approve")}</button>}
        {canReview && (status === "sent" || status === "approved") && note === null && <button className="btn" disabled={busy} onClick={() => setNote("")}>{t("Send back")}</button>}
      </div>
      {status === "returned" && doc.review_note && (
        <div className="wb-note" role="note"><b>{t("What needs to change")}</b><span>{doc.review_note}</span></div>
      )}
      {note !== null && (
        <form className="wb-sendback" onSubmit={(e) => { e.preventDefault(); step("return", { note }); }}>
          <label className="field">
            <span className="wb-l">{t("Note for the field service engineer")}</span>
            <textarea autoFocus value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={t("Say what needs to change.")} />
          </label>
          <div className="row">
            <button className="btn primary" disabled={busy || !note.trim()}>{t("Send back")}</button>
            <button type="button" className="btn" onClick={() => setNote(null)}>{t("Cancel")}</button>
          </div>
        </form>
      )}
    </div>
  );
}

const editableFor = (doc: any, me: Me) => doc.user_id === me.id && (doc.status === "draft" || doc.status === "returned") && can(me, "reports.write");

async function addRow(path: string, body: unknown, reload: () => void) {
  try {
    await track(api(path, { body }));
    reload();
  } catch {
    /* shown by track() */
  }
}
async function removeRow(path: string, reload: () => void) {
  try {
    await track(api(path, { method: "DELETE" }));
    reload();
  } catch {
    /* shown by track() */
  }
}

function RemoveBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="iconbtn wb-x" aria-label={label} title={label} onClick={onClick}><Close size={16} /></button>;
}

// ───────────────────────────── Time sheet ─────────────────────────────

type DayVals = { work_date: string; start_time: string; end_time: string; break_min: string; travel_hours: string; production_hours: string; billable: boolean; notes: string };
const dayVals = (d: any): DayVals => ({
  work_date: d.work_date, start_time: d.start_time ?? "", end_time: d.end_time ?? "", break_min: String(d.break_min ?? 0),
  travel_hours: hrs(d.travel_min ?? 0), production_hours: hrs(d.production_min ?? 0), billable: !!d.billable, notes: d.notes ?? "",
});
const asDay = (v: DayVals) => ({ start_time: v.start_time || null, end_time: v.end_time || null, break_min: Number(v.break_min) || 0, travel_min: hoursToMin(v.travel_hours) ?? 0, production_min: hoursToMin(v.production_hours) ?? 0, billable: v.billable ? 1 : 0 });

function TimeSheet({ sheet, me, canReview, reload }: { sheet: any; me: Me; canReview: boolean; reload: () => void }) {
  const sid = encodeURIComponent(sheet.id);
  const edit = editableFor(sheet, me);
  const [local, setLocal] = useState<Record<string, DayVals>>({});
  const days = sheet.days.map((d: any) => ({ ...d, ...(local[d.id] ? asDay(local[d.id]!) : {}) }));
  const tot = sheetTotals(days);
  const cards: [string, number][] = [["Work hours", tot.work], ["Billable", tot.billable], ["Non-billable", tot.nonBillable], ["Travel", tot.travel], ["Production", tot.production]];
  const first = sheet.days[0]?.work_date;
  const last = sheet.days.at(-1)?.work_date;
  const weeks = !first ? t("No days yet") : first === last ? fmtDate(first) : `${fmtDate(first)} – ${fmtDate(last)}`;

  return (
    <section className="panel wb-doc">
      <div className="wb-doc-head">
        <div>
          <h2>{t("Time sheet")}</h2>
          <p className="muted">{sheet.user_name} · {weeks}</p>
        </div>
      </div>
      <DocBar kind="sheets" doc={sheet} me={me} canReview={canReview} reload={reload} />
      <div className="wb-totals">
        {cards.map(([label, min]) => (
          <div key={label} className="wb-total"><span className="wb-l">{t(label)}</span><b>{fmtHours(min)}</b><small>{t("hours")}</small></div>
        ))}
      </div>

      <h3 className="wb-h">{t("Daily hours")}</h3>
      <div className="wb-grid wb-days" role="table" aria-label={t("Daily hours")}>
        <div className="wb-row wb-headrow" role="row">
          {["Date", "Start", "End", "Break (min)", "Travel (h)", "Work (h)", "Billing", "Production (h)", "Notes"].map((h) => <span key={h} role="columnheader">{t(h)}</span>)}
          <span aria-hidden="true" />
        </div>
        {sheet.days.map((d: any) => (
          <DayRow key={d.id} day={d} edit={edit} path={`/reports/sheets/${sid}/days/${encodeURIComponent(d.id)}`} onLocal={(v) => setLocal((x) => ({ ...x, [d.id]: v }))} reload={reload} />
        ))}
        {!sheet.days.length && <Empty>{edit ? t("No days yet. Add the first day worked.") : t("No days entered.")}</Empty>}
      </div>
      {edit && <button className="btn wb-add" onClick={() => addRow(`/reports/sheets/${sid}/days`, {}, reload)}>{t("Add day")}</button>}

      <h3 className="wb-h">{t("Expenses")}</h3>
      <p className="muted wb-hint">{t("Record what it was and attach the receipt photo. No amounts are entered in the portal.")}</p>
      <div className="wb-grid wb-exp" role="table" aria-label={t("Expenses")}>
        <div className="wb-row wb-headrow" role="row">
          {["Date", "Type", "Description", "Quantity", "Receipt"].map((h) => <span key={h} role="columnheader">{t(h)}</span>)}
          <span aria-hidden="true" />
        </div>
        {sheet.expenses.map((x: any) => <ExpenseRow key={x.id} exp={x} sid={sid} edit={edit} reload={reload} />)}
        {!sheet.expenses.length && <Empty>{edit ? t("No expenses. Add one for mileage, hotel nights, a flight or a receipt.") : t("No expenses entered.")}</Empty>}
      </div>
      {edit && <button className="btn wb-add" onClick={() => addRow(`/reports/sheets/${sid}/expenses`, {}, reload)}>{t("Add expense")}</button>}
    </section>
  );
}

function DayRow({ day, edit, path, onLocal, reload }: { day: any; edit: boolean; path: string; onLocal: (v: DayVals) => void; reload: () => void }) {
  const f = useFields<DayVals>(dayVals(day), (p) => api(path, { method: "PATCH", body: p }));
  const v = f.vals;
  useEffect(() => onLocal(v), [JSON.stringify(v)]);
  const work = workMinutes(asDay(v));
  if (!edit) {
    return (
      <div className="wb-row" role="row">
        <span data-l={t("Date")} className="wb-date">{fmtDate(day.work_date)}</span>
        <span data-l={t("Start")}>{day.start_time ?? "–"}</span>
        <span data-l={t("End")}>{day.end_time ?? "–"}</span>
        <span data-l={t("Break (min)")}>{day.break_min}</span>
        <span data-l={t("Travel (h)")}>{fmtHours(day.travel_min)}</span>
        <span data-l={t("Work (h)")} className="wb-num">{fmtHours(work)}</span>
        <span data-l={t("Billing")}>{day.billable ? t("Billable") : t("Non-billable")}</span>
        <span data-l={t("Production (h)")}>{fmtHours(day.production_min)}</span>
        <span data-l={t("Notes")} className="wb-text">{day.notes ?? ""}</span>
        <span />
      </div>
    );
  }
  return (
    <div className="wb-row" role="row">
      <label data-l={t("Date")}><input type="date" aria-label={t("Date")} {...f.bind("work_date")} onChange={(e) => e.target.value && f.set("work_date", e.target.value)} /></label>
      <label data-l={t("Start")}><input type="time" aria-label={t("Start")} {...f.bind("start_time")} /></label>
      <label data-l={t("End")}><input type="time" aria-label={t("End")} {...f.bind("end_time")} /></label>
      <label data-l={t("Break (min)")}><input type="number" min={0} max={720} step={5} inputMode="numeric" aria-label={t("Break (min)")} {...f.bind("break_min")} /></label>
      <label data-l={t("Travel (h)")}><input inputMode="decimal" aria-label={t("Travel (h)")} {...f.bind("travel_hours")} /></label>
      <span data-l={t("Work (h)")} className="wb-num wb-calc" aria-label={t("Work hours")}>{fmtHours(work)}</span>
      <label data-l={t("Billing")}>
        <select aria-label={t("Billing")} value={v.billable ? "1" : "0"} onChange={(e) => f.set("billable", e.target.value === "1", true)}>
          <option value="1">{t("Billable")}</option>
          <option value="0">{t("Non-billable")}</option>
        </select>
      </label>
      <label data-l={t("Production (h)")}><input inputMode="decimal" aria-label={t("Production (h)")} {...f.bind("production_hours")} /></label>
      <label data-l={t("Notes")} className="wb-wide"><input maxLength={1000} aria-label={t("Notes")} placeholder={t("What the day was for")} {...f.bind("notes")} /></label>
      <RemoveBtn label={t("Remove this day")} onClick={() => removeRow(path, reload)} />
    </div>
  );
}

type ExpVals = { exp_date: string; type: string; description: string; quantity: string };

function ExpenseRow({ exp, sid, edit, reload }: { exp: any; sid: string; edit: boolean; reload: () => void }) {
  const path = `/reports/sheets/${sid}/expenses/${encodeURIComponent(exp.id)}`;
  const f = useFields<ExpVals>({ exp_date: exp.exp_date, type: exp.type, description: exp.description ?? "", quantity: exp.quantity === null ? "" : String(exp.quantity) }, (p) => api(path, { method: "PATCH", body: p }));
  const pick = useRef<HTMLInputElement>(null);
  const kind = expenseType(f.vals.type);
  async function upload(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("files", file, file.name);
    try {
      await track(apiForm(`${path}/receipt`, form));
      reload();
    } catch {
      /* shown */
    }
  }
  const receipt = exp.receipt ? (
    <a className="wb-receipt" href={fileSrc(exp.receipt, exp.receipt.ext === "pdf")} target="_blank" rel="noopener noreferrer">
      {["jpg", "jpeg", "png", "gif", "webp"].includes(exp.receipt.ext) ? <img src={fileSrc(exp.receipt)} alt={t("Receipt")} /> : <span className="wb-filetag">{exp.receipt.ext.toUpperCase()}</span>}
      <span>{t("Receipt")}</span>
    </a>
  ) : null;
  if (!edit) {
    return (
      <div className="wb-row" role="row">
        <span data-l={t("Date")} className="wb-date">{fmtDate(exp.exp_date)}</span>
        <span data-l={t("Type")}>{t(expenseType(exp.type).label)}</span>
        <span data-l={t("Description")} className="wb-text">{exp.description ?? ""}</span>
        <span data-l={t("Quantity")}>{exp.quantity ?? ""} {exp.quantity !== null && expenseType(exp.type).unit ? t(exp.quantity === 1 ? expenseType(exp.type).one : expenseType(exp.type).unit) : ""}</span>
        <span data-l={t("Receipt")}>{receipt ?? <span className="muted">{t("None")}</span>}</span>
        <span />
      </div>
    );
  }
  return (
    <div className="wb-row" role="row">
      <label data-l={t("Date")}><input type="date" aria-label={t("Date")} {...f.bind("exp_date")} onChange={(e) => e.target.value && f.set("exp_date", e.target.value)} /></label>
      <label data-l={t("Type")}>
        <select aria-label={t("Type")} value={f.vals.type} onChange={(e) => f.set("type", e.target.value, true)}>
          {EXPENSE_TYPES.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
        </select>
      </label>
      <label data-l={t("Description")} className="wb-wide"><input maxLength={500} aria-label={t("Description")} placeholder={t("Where, or what for")} {...f.bind("description")} /></label>
      <label data-l={t("Quantity")} className="wb-qty">
        <input inputMode="decimal" aria-label={t("Quantity")} {...f.bind("quantity")} />
        {kind.unit && <span className="muted">{t(f.vals.quantity.trim() === "1" ? kind.one : kind.unit)}</span>}
      </label>
      <span data-l={t("Receipt")} className="wb-receipt-cell">
        {receipt}
        <button type="button" className="btn small" onClick={() => pick.current?.click()}>{exp.receipt ? t("Replace") : t("Add receipt")}</button>
        <input ref={pick} type="file" accept="image/*,.heic,.pdf" hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      </span>
      <RemoveBtn label={t("Remove this expense")} onClick={() => removeRow(path, reload)} />
    </div>
  );
}

// ───────────────────────────── Service report ─────────────────────────────

type RepVals = { summary: string; recipe: string; follow_up: string; signer_name: string; signer_title: string; signed_on: string };

export function JobFacts({ job }: { job: any }) {
  const facts: [string, React.ReactNode][] = [
    ["Job number", <span className="mono">{job.job_number}</span>],
    ["Customer", job.customer],
    ["Machine", job.machine ? <span className="mono">{job.machine}</span> : "–"],
    ["Location", job.location ? <span style={{ whiteSpace: "pre-wrap" }}>{job.location}</span> : "–"],
    ["Days of work", job.work_days.length ? `${fmtDate(job.work_days[0])} – ${fmtDate(job.work_days.at(-1))} (${job.work_days.length})` : t("No days set")],
    ["Field service engineers", job.techs.map((x: any) => x.name).join(", ") || "–"],
    ["Point of contact", [job.contact_name, job.contact_phone, job.contact_email].filter(Boolean).join(" · ") || "–"],
  ];
  return (
    <dl className="wb-facts">
      {facts.map(([k, v]) => <div key={k}><dt>{t(k)}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

function ServiceReport({ job, data, me, canReview, reload, onPrint }: { job: any; data: any; me: Me; canReview: boolean; reload: () => void; onPrint: () => void }) {
  const r = data.report;
  const rid = encodeURIComponent(r.id);
  const edit = editableFor(r, me);
  const f = useFields<RepVals>(
    { summary: r.summary ?? "", recipe: r.recipe ?? "", follow_up: r.follow_up ?? "", signer_name: r.signer_name ?? "", signer_title: r.signer_title ?? "", signed_on: r.signed_on ?? "" },
    (p) => api(`/reports/service/${rid}`, { method: "PATCH", body: p }),
  );
  const box = (k: "summary" | "recipe" | "follow_up", label: string, hint: string) => (
    <label className="field wb-field">
      <span className="wb-l">{t(label)}</span>
      {edit ? <textarea maxLength={10000} placeholder={t(hint)} {...f.bind(k, { multiline: true })} /> : <div className="wb-text wb-read">{r[k] || <span className="muted">{t("Nothing written.")}</span>}</div>}
    </label>
  );
  return (
    <section className="panel wb-doc">
      <div className="wb-doc-head">
        <div>
          <h2>{t("Service report")}</h2>
          <p className="muted">{r.user_name}</p>
        </div>
      </div>
      <DocBar kind="service" doc={r} me={me} canReview={canReview} reload={reload}>
        <button className="btn" onClick={onPrint}>{t("Print or save as PDF")}</button>
      </DocBar>

      <h3 className="wb-h">{t("Job details")}</h3>
      <JobFacts job={job} />

      {box("summary", "Summary of the visit", "What was found, what was done, and how the machine was left.")}

      <h3 className="wb-h">{t("Work log")}</h3>
      <div className="wb-log">
        {data.log.map((l: any) => <LogRow key={l.id} row={l} path={`/reports/service/${rid}/log/${encodeURIComponent(l.id)}`} edit={edit} reload={reload} />)}
        {!data.log.length && <Empty>{edit ? t("Add a line for each day: what was done on the machine.") : t("No work log.")}</Empty>}
      </div>
      {edit && <button className="btn wb-add" onClick={() => addRow(`/reports/service/${rid}/log`, {}, reload)}>{t("Add day")}</button>}

      <h3 className="wb-h">{t("Parts used and needed")}</h3>
      <div className="wb-grid wb-parts" role="table" aria-label={t("Parts used and needed")}>
        <div className="wb-row wb-headrow" role="row">
          {["Used or needed", "Ronchi part code", "Description", "Qty"].map((h) => <span key={h} role="columnheader">{t(h)}</span>)}
          <span aria-hidden="true" />
        </div>
        {data.parts.map((p: any) => <PartRow key={p.id} part={p} path={`/reports/service/${rid}/parts/${encodeURIComponent(p.id)}`} edit={edit} reload={reload} />)}
        {!data.parts.length && <Empty>{edit ? t("No parts yet. Add the parts used, and any the customer needs.") : t("No parts listed.")}</Empty>}
      </div>
      <div className="row">
        {edit && <button className="btn wb-add" onClick={() => addRow(`/reports/service/${rid}/parts`, {}, reload)}>{t("Add part")}</button>}
        {data.parts.some((p: any) => p.kind === "needed") && can(me, "psales.edit") && <Link to="/parts-orders" className="btn">{t("Raise a parts order")}</Link>}
        {data.parts.some((p: any) => p.kind === "needed") && !can(me, "psales.edit") && <span className="muted wb-hint">{t("Parts marked needed go to the parts team when the report is approved.")}</span>}
      </div>

      <h3 className="wb-h">{t("Supporting photos")}</h3>
      <Photos rid={rid} photos={data.photos} edit={edit} reload={reload} />

      {box("recipe", "Recipe sheet and settings", "The recipe and machine settings left in place: format, speeds, fill weights, offsets.")}
      {box("follow_up", "Recommendations and follow-up", "What the customer should do next, and anything to check on the next visit.")}

      <h3 className="wb-h">{t("Customer sign-off")}</h3>
      <div className="wb-sign">
        <div className="grid g3">
          <label className="field"><span className="wb-l">{t("Signed by")}</span>{edit ? <input maxLength={120} {...f.bind("signer_name")} /> : <div>{r.signer_name || "–"}</div>}</label>
          <label className="field"><span className="wb-l">{t("Job title")}</span>{edit ? <input maxLength={120} {...f.bind("signer_title")} /> : <div>{r.signer_title || "–"}</div>}</label>
          <label className="field"><span className="wb-l">{t("Date")}</span>{edit ? <input type="date" {...f.bind("signed_on")} onChange={(e) => f.set("signed_on", e.target.value, true)} /> : <div>{r.signed_on ? fmtDate(r.signed_on) : "–"}</div>}</label>
        </div>
        <SignaturePad rid={rid} signature={r.signature} edit={edit} reload={reload} />
      </div>
    </section>
  );
}

function LogRow({ row, path, edit, reload }: { row: any; path: string; edit: boolean; reload: () => void }) {
  const f = useFields({ work_date: row.work_date as string, text: (row.text ?? "") as string }, (p) => api(path, { method: "PATCH", body: p }));
  if (!edit) {
    return <div className="wb-logrow"><span className="wb-date">{fmtDate(row.work_date)}</span><div className="wb-text">{row.text ?? ""}</div></div>;
  }
  return (
    <div className="wb-logrow">
      <input type="date" aria-label={t("Date")} {...f.bind("work_date")} onChange={(e) => e.target.value && f.set("work_date", e.target.value)} />
      <textarea maxLength={5000} aria-label={t("What was done")} placeholder={t("What was done on the machine that day")} {...f.bind("text", { multiline: true })} />
      <RemoveBtn label={t("Remove this day")} onClick={() => removeRow(path, reload)} />
    </div>
  );
}

function PartRow({ part, path, edit, reload }: { part: any; path: string; edit: boolean; reload: () => void }) {
  const f = useFields({ kind: part.kind as string, part_code: (part.part_code ?? "") as string, description: (part.description ?? "") as string, qty: String(part.qty) }, (p) => api(path, { method: "PATCH", body: p }));
  if (!edit) {
    return (
      <div className="wb-row" role="row">
        <span data-l={t("Used or needed")}><span className={`pill ${part.kind === "needed" ? "p-warn" : "p-ok"}`}>{part.kind === "needed" ? t("Needed") : t("Used")}</span></span>
        <span data-l={t("Ronchi part code")} className="mono">{part.part_code ?? ""}</span>
        <span data-l={t("Description")} className="wb-text">{part.description ?? ""}</span>
        <span data-l={t("Qty")} className="wb-num">{part.qty}</span>
        <span />
      </div>
    );
  }
  return (
    <div className="wb-row" role="row">
      <label data-l={t("Used or needed")}>
        <select aria-label={t("Used or needed")} value={f.vals.kind} onChange={(e) => f.set("kind", e.target.value, true)}>
          <option value="used">{t("Used")}</option>
          <option value="needed">{t("Needed")}</option>
        </select>
      </label>
      <label data-l={t("Ronchi part code")}><input className="mono" maxLength={40} aria-label={t("Ronchi part code")} {...f.bind("part_code")} /></label>
      <label data-l={t("Description")} className="wb-wide"><input maxLength={300} aria-label={t("Description")} {...f.bind("description")} /></label>
      <label data-l={t("Qty")}><input type="number" min={1} max={9999} inputMode="numeric" aria-label={t("Qty")} {...f.bind("qty")} /></label>
      <RemoveBtn label={t("Remove this part")} onClick={() => removeRow(path, reload)} />
    </div>
  );
}

function Photos({ rid, photos, edit, reload }: { rid: string; photos: any[]; edit: boolean; reload: () => void }) {
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const form = new FormData();
    for (const f of Array.from(list).slice(0, 10)) form.append("files", f, f.name);
    try {
      await track(apiForm(`/reports/service/${rid}/photos`, form));
      reload();
    } catch {
      /* shown */
    }
  }
  return (
    <div className="stack">
      {photos.length > 0 && (
        <div className="wb-photos">
          {photos.map((p) => <Photo key={p.id} photo={p} path={`/reports/service/${rid}/photos/${encodeURIComponent(p.id)}`} edit={edit} reload={reload} />)}
        </div>
      )}
      {!photos.length && <Empty>{edit ? t("No photos yet. Add before and after photos of the work.") : t("No photos.")}</Empty>}
      {edit && (
        <div className="row">
          <button type="button" className="btn" onClick={() => pick.current?.click()}>{t("Add photos")}</button>
          <button type="button" className="btn touch-only" onClick={() => camera.current?.click()}>{t("Take a photo")}</button>
          <input ref={pick} type="file" multiple accept="image/*,.heic" hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </div>
      )}
    </div>
  );
}

function Photo({ photo, path, edit, reload }: { photo: any; path: string; edit: boolean; reload: () => void }) {
  const f = useFields({ caption: (photo.caption ?? "") as string }, (p) => api(path, { method: "PATCH", body: p }));
  const showable = ["jpg", "jpeg", "png", "gif", "webp"].includes(photo.ext);
  return (
    <figure className="wb-photo">
      <a href={fileSrc(photo)} target="_blank" rel="noopener noreferrer">{showable ? <img src={fileSrc(photo)} alt={photo.caption || photo.name} loading="lazy" /> : <span className="wb-filetag">{photo.ext.toUpperCase()}</span>}</a>
      <figcaption>
        {edit ? <input maxLength={200} aria-label={t("Caption")} placeholder={t("Caption")} {...f.bind("caption")} /> : <span>{photo.caption || photo.name}</span>}
        {edit && <RemoveBtn label={t("Remove photo")} onClick={() => removeRow(path, reload)} />}
      </figcaption>
    </figure>
  );
}

/** The customer signs with a finger or mouse; the drawing is saved as a PNG at once. */
function SignaturePad({ rid, signature, edit, reload }: { rid: string; signature: any; edit: boolean; reload: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [marked, setMarked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#15181c";
  }, [signature, edit]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  function clear() {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setMarked(false);
  }
  async function save() {
    const blob: Blob | null = await new Promise((res) => canvas.current!.toBlob(res, "image/png"));
    if (!blob) return;
    const form = new FormData();
    form.append("file", blob, "signature.png");
    setBusy(true);
    try {
      await track(apiForm(`/reports/service/${rid}/signature`, form));
      setMarked(false);
      reload();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  }
  async function redo() {
    try {
      await track(api(`/reports/service/${rid}/signature`, { method: "DELETE" }));
      reload();
    } catch {
      /* shown */
    }
  }

  if (signature) {
    return (
      <div className="wb-sigbox">
        <span className="wb-l">{t("Customer signature")}</span>
        <img className="wb-sig" src={fileSrc(signature)} alt={t("Customer signature")} />
        {edit && <button type="button" className="btn small" onClick={redo}>{t("Clear and sign again")}</button>}
      </div>
    );
  }
  if (!edit) return <div className="wb-sigbox"><span className="wb-l">{t("Customer signature")}</span><span className="muted">{t("Not signed.")}</span></div>;
  return (
    <div className="wb-sigbox">
      <span className="wb-l">{t("Customer signature")}</span>
      <canvas
        ref={canvas}
        className="wb-pad"
        aria-label={t("Sign here with a finger or the mouse")}
        onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const ctx = e.currentTarget.getContext("2d")!; const [x, y] = point(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); setMarked(true); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = e.currentTarget.getContext("2d")!; const [x, y] = point(e); ctx.lineTo(x, y); ctx.stroke(); }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <span className="wb-pad-line muted">{t("Sign here with a finger or the mouse")}</span>
      <div className="row">
        <button type="button" className="btn primary" disabled={!marked || busy} onClick={save}>{t("Save signature")}</button>
        <button type="button" className="btn" disabled={!marked} onClick={clear}>{t("Clear")}</button>
      </div>
    </div>
  );
}

// ───────────────────────────── Printable report ─────────────────────────────

export function ReportPrint({ job, data, onClose }: { job: any; data: any; onClose: () => void }) {
  // The print view takes over the page (on screen and on paper): everything else in <main> is hidden.
  useEffect(() => {
    document.body.classList.add("print-report");
    window.scrollTo(0, 0);
    return () => document.body.classList.remove("print-report");
  }, []);
  const host = document.querySelector("main");
  const page = <PrintSheet job={job} data={data} onClose={onClose} />;
  return host ? createPortal(page, host) : page;
}

function PrintSheet({ job, data, onClose }: { job: any; data: any; onClose: () => void }) {
  const r = data.report;
  const used = data.parts.filter((p: any) => p.kind === "used");
  const needed = data.parts.filter((p: any) => p.kind === "needed");
  const parts = (list: any[]) => (
    <table className="pr-table">
      <thead><tr><th>{t("Ronchi part code")}</th><th>{t("Description")}</th><th className="num">{t("Qty")}</th></tr></thead>
      <tbody>{list.map((p) => <tr key={p.id}><td className="mono">{p.part_code ?? ""}</td><td>{p.description ?? ""}</td><td className="num">{p.qty}</td></tr>)}</tbody>
    </table>
  );
  const block = (title: string, text: string | null) => text ? <section className="pr-sec"><h3>{t(title)}</h3><p className="pr-text">{text}</p></section> : null;
  return (
    <div className="print-wrap">
      <div className="row print-tools">
        <button className="btn" onClick={onClose}>{t("Back to the report")}</button>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>{t("Print or save as PDF")}</button>
      </div>
      <article className="print-sheet">
        <header className="pr-head">
          <img src={logoUrl} alt="Ronchi" />
          <div className="pr-title">
            <h1>{t("Field service report")}</h1>
            <div className="mono">{job.job_number}</div>
            <div className={`pr-status s-${r.status}`}>{t(DOC_STATUS_LABEL[r.status as DocStatus])}</div>
          </div>
        </header>
        <table className="pr-facts">
          <tbody>
            <tr><th>{t("Customer")}</th><td>{job.customer}</td><th>{t("Machine")}</th><td className="mono">{job.machine ?? "–"}</td></tr>
            <tr><th>{t("Location")}</th><td className="pr-text">{job.location ?? "–"}</td><th>{t("Days of work")}</th><td>{job.work_days.length ? `${fmtDate(job.work_days[0])} – ${fmtDate(job.work_days.at(-1))}` : "–"}</td></tr>
            <tr><th>{t("Field service engineer")}</th><td>{r.user_name}</td><th>{t("Point of contact")}</th><td>{[job.contact_name, job.contact_phone].filter(Boolean).join(" · ") || "–"}</td></tr>
            <tr><th>{t("Also on the job")}</th><td colSpan={3}>{job.techs.filter((x: any) => x.id !== r.user_id).map((x: any) => x.name).join(", ") || "–"}</td></tr>
          </tbody>
        </table>
        {block("Summary of the visit", r.summary)}
        {data.log.length > 0 && (
          <section className="pr-sec">
            <h3>{t("Work log")}</h3>
            <table className="pr-table">
              <tbody>{data.log.map((l: any) => <tr key={l.id}><th className="pr-day">{fmtDate(l.work_date)}</th><td className="pr-text">{l.text ?? ""}</td></tr>)}</tbody>
            </table>
          </section>
        )}
        {used.length > 0 && <section className="pr-sec"><h3>{t("Parts used")}</h3>{parts(used)}</section>}
        {needed.length > 0 && <section className="pr-sec"><h3>{t("Parts needed")}</h3>{parts(needed)}</section>}
        {block("Recipe sheet and settings", r.recipe)}
        {block("Recommendations and follow-up", r.follow_up)}
        {data.photos.length > 0 && (
          <section className="pr-sec">
            <h3>{t("Supporting photos")}</h3>
            <div className="pr-photos">
              {data.photos.map((p: any) => <figure key={p.id}><img src={fileSrc(p)} alt={p.caption || p.name} /><figcaption>{p.caption ?? ""}</figcaption></figure>)}
            </div>
          </section>
        )}
        <section className="pr-sec pr-signoff">
          <h3>{t("Customer sign-off")}</h3>
          <p className="pr-small">{t("By signing, the customer confirms the work described above was carried out and the machine was handed back.")}</p>
          <div className="pr-signrow">
            <div className="pr-sigcell">{r.signature ? <img src={fileSrc(r.signature)} alt={t("Customer signature")} /> : null}<span>{t("Signature")}</span></div>
            <div className="pr-sigcell"><b>{r.signer_name ?? ""}</b><span>{t("Name")}{r.signer_title ? ` · ${r.signer_title}` : ""}</span></div>
            <div className="pr-sigcell"><b>{r.signed_on ? fmtDate(r.signed_on) : ""}</b><span>{t("Date")}</span></div>
          </div>
        </section>
        <footer className="pr-foot">
          <span>Ronchi America</span>
          <span>{t("Job {num}", { num: job.job_number })} · {r.user_name}</span>
          <span>{t("Printed {when}", { when: new Date().toLocaleDateString(loc(), { year: "numeric", month: "short", day: "numeric" }) })}</span>
        </footer>
      </article>
    </div>
  );
}

// ───────────────────────────── Job chat ─────────────────────────────

function JobChat({ jobId, chat, me }: { jobId: string; chat: { id: string | null; member: boolean; canOpen: boolean }; me: Me }) {
  const [id, setId] = useState<string | null>(chat.member ? chat.id : null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (id || !chat.canOpen) return;
    api<{ id: string }>(`/reports/jobs/${encodeURIComponent(jobId)}/chat`, { body: {} }).then((r) => setId(r.id), (e: Error) => setErr(e.message));
  }, [jobId]);
  if (!chat.canOpen) return <div className="panel"><Empty>{t("The job chat is for the field service engineers on this job and the people who schedule it.")}</Empty></div>;
  if (err) return <ErrorNote error={err} />;
  if (!id) return null;
  return <BoardPage key={id} id={id} me={me} embedded />;
}

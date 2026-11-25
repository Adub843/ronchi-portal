// The Ronchi workbook inside a work order (Aaron, 2026-11-25): service report, daily work log, photos
// with captions and recipe screens, billable hours, expenses, customer sign-off, the job's chat and
// Submit. Everything saves to the portal as it's typed in, so the office sees it straight away.
//
// Billable hours are what the customer is billed for, not a time clock (Aaron, 2026-11-25).
import { useEffect, useRef, useState } from "react";
import { api, apiForm, can, fmtDate, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { t } from "../i18n";
import { navigate } from "../router";
import { JobListTabs } from "./Jobs";
import { toCsv } from "../../../src/shared/csv";
import { fileProblem } from "../../../src/shared/files";
import { addDays, EXPENSE_TYPES, fromCents, HOUR_TYPES, hoursTotal, mondayOf, PCT, RECIPE_SCREENS, SCOPES } from "../../../src/shared/workbook";

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the person's own time zone
const enc = encodeURIComponent;
const money = (cents: number) => `$${fromCents(cents)}`;

function Select({ id, value, list, onChange, blank = true, label }: { id: string; value: string; list: readonly string[]; onChange: (v: string) => void; blank?: boolean; label?: (v: string) => string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {blank && <option value="">{t("Choose…")}</option>}
      {list.map((v) => <option key={v} value={v}>{label ? label(v) : v}</option>)}
    </select>
  );
}

export function WorkbookPanel({ job, me, onFiles }: { job: any; me: Me; onFiles: () => void }) {
  const { data, error, reload } = useLoad(() => api(`/workbook/${enc(job.id)}`), [job.id], { live: true });
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const r = data.report;
  const open = r.status !== "submitted";
  const fill = data.canFill && open;
  const refresh = () => { reload(); onFiles(); };

  async function chat() {
    try {
      const c = await api(`/workbook/${enc(job.id)}/chat`, { body: {} });
      navigate(`/chats/${c.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <section className="stack wb">
      <div className="panel row wb-bar">
        <div>
          <h2 style={{ margin: 0 }}>{t("Service report")}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {open ? t("Draft. Everything saves as you go; the office sees it when you press Submit.") : t("Submitted {when} by {name}.", { when: fmtTime(r.submitted_at), name: r.submitted_by_name ?? "" })}
          </p>
        </div>
        <span className="spacer" />
        {can(me, "boards.use") && data.canFill && <button className="btn" onClick={chat}>{data.chat ? t("Open the job chat") : t("Start the job chat")}</button>}
        {fill && <SubmitButton jobId={job.id} recipients={data.recipients} onDone={reload} />}
        {!open && data.canSchedule && (
          <button className="btn" onClick={async () => { try { await api(`/workbook/${enc(job.id)}/reopen`, { body: {} }); toast(t("Reopened")); reload(); } catch (e) { toast((e as Error).message); } }}>{t("Reopen for changes")}</button>
        )}
      </div>

      <ReportTop jobId={job.id} report={r} fill={fill} onSaved={reload} />
      <WorkLog job={job} entries={data.entries} fill={fill} me={me} canSchedule={data.canSchedule} onChange={reload} />
      <Photos jobId={job.id} photos={data.photos} fill={fill} onChange={refresh} />
      {data.hours && <BillableHours job={job} rows={data.hours} fill={fill} me={me} canSchedule={data.canSchedule} onChange={reload} />}
      {data.expenses && <Expenses job={job} rows={data.expenses} fill={fill} me={me} billable={data.billable} onChange={refresh} />}
      <SignOff jobId={job.id} report={r} fill={fill} onSaved={reload} />
    </section>
  );
}

// ---- Report top: type of work, summary, anything left open ----

function ReportTop({ jobId, report, fill, onSaved }: { jobId: string; report: any; fill: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ scope: report.scope ?? "", summary: report.summary ?? "", open_issues: report.open_issues ?? "" });
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setF({ scope: report.scope ?? "", summary: report.summary ?? "", open_issues: report.open_issues ?? "" }); }, [report.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  async function save() {
    try {
      await api(`/workbook/${enc(jobId)}/report`, { method: "PUT", body: { ...f, revision: report.revision ?? 0 } });
      setDirty(false);
      toast(t("Saved"));
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="panel grid g2">
      <div className="field">
        <label htmlFor="wb-scope">{t("Type of work")}</label>
        {fill ? <Select id="wb-scope" value={f.scope} list={SCOPES} label={(v) => t(v)} onChange={(v) => set("scope", v)} /> : <div>{report.scope ? t(report.scope) : <span className="muted">{t("Not set")}</span>}</div>}
      </div>
      <div />
      <div className="field">
        <label htmlFor="wb-summary">{t("Summary for the office")}</label>
        {fill ? <textarea id="wb-summary" rows={4} value={f.summary} onChange={(e) => set("summary", e.target.value)} onBlur={() => dirty && save()} /> : <div style={{ whiteSpace: "pre-wrap" }}>{report.summary || <span className="muted">{t("Nothing added.")}</span>}</div>}
      </div>
      <div className="field">
        <label htmlFor="wb-open">{t("Left open")}</label>
        {fill ? <textarea id="wb-open" rows={4} value={f.open_issues} placeholder={t("Anything left unresolved")} onChange={(e) => set("open_issues", e.target.value)} onBlur={() => dirty && save()} /> : <div style={{ whiteSpace: "pre-wrap" }}>{report.open_issues || <span className="muted">{t("Nothing added.")}</span>}</div>}
      </div>
      {fill && dirty && <div><button className="btn primary" onClick={save}>{t("Save")}</button></div>}
    </div>
  );
}

// ---- Daily work log ----

function WorkLog({ job, entries, fill, me, canSchedule, onChange }: { job: any; entries: any[]; fill: boolean; me: Me; canSchedule: boolean; onChange: () => void }) {
  const firstDay = job.work_days.includes(today()) ? today() : job.work_days[0] ?? today();
  const blank = { day: firstDay, work: "", description: "", done: "", pct: "", issues: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/workbook/${enc(job.id)}/entries`, { body: f });
      setF({ ...blank, day: f.day, work: f.work });
      onChange();
    } catch (x) {
      toast((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/workbook/${enc(job.id)}/entries/${enc(id)}`, { method: "DELETE" });
      onChange();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>{t("Daily work log")}</h3>
      {entries.length ? (
        <ol className="wb-log">
          {entries.map((e) => (
            <li key={e.id}>
              <div className="row">
                <strong>{fmtDate(e.day)}</strong>
                <span className="muted">{e.who}{e.work ? ` · ${t(e.work)}` : ""}</span>
                <span className="spacer" />
                <span className="muted">{e.done === "Y" ? t("Done") : e.pct ? e.pct : e.done === "N" ? t("Not finished") : ""}</span>
                {fill && (e.user_id === me.id || canSchedule) && <button className="linkish" onClick={() => remove(e.id)}>{t("Remove")}</button>}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{e.description}</div>
              {e.issues && <div className="wb-issues"><span className="wo-l">{t("Issues found")}</span> <span style={{ whiteSpace: "pre-wrap" }}>{e.issues}</span></div>}
            </li>
          ))}
        </ol>
      ) : <Empty>{t("No days in the log yet.")}</Empty>}
      {fill && (
        <form className="grid g3 wb-add" onSubmit={add}>
          <div className="field"><label htmlFor="wl-day">{t("Date")}</label><input id="wl-day" type="date" value={f.day} required onChange={(e) => set("day", e.target.value)} /></div>
          <div className="field"><label htmlFor="wl-work">{t("Type of work")}</label><Select id="wl-work" value={f.work} list={SCOPES} label={(v) => t(v)} onChange={(v) => set("work", v)} /></div>
          <div className="field">
            <label htmlFor="wl-done">{t("Finished?")}</label>
            <select id="wl-done" value={f.done} onChange={(e) => set("done", e.target.value)}>
              <option value="">{t("Choose…")}</option><option value="Y">{t("Yes")}</option><option value="N">{t("No")}</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="wl-desc">{t("What was done today")} *</label><textarea id="wl-desc" rows={3} required value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
          {f.done === "N" && <div className="field"><label htmlFor="wl-pct">{t("How far along")}</label><Select id="wl-pct" value={f.pct} list={PCT} onChange={(v) => set("pct", v)} /></div>}
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="wl-issues">{t("Issues found")}</label>
            <textarea id="wl-issues" rows={2} value={f.issues} placeholder={t("One problem per line. Each becomes a quick note on the machine when the report is submitted.")} onChange={(e) => set("issues", e.target.value)} />
          </div>
          <div><button className="btn primary" disabled={busy}>{t("Add to the log")}</button></div>
        </form>
      )}
    </div>
  );
}

// ---- Photos (the job's picture files) with captions and recipe screens ----

const SCREENS = Object.entries(RECIPE_SCREENS).flatMap(([m, list]) => list.map((s) => `${m}: ${s}`));

function Photos({ jobId, photos, fill, onChange }: { jobId: string; photos: any[]; fill: boolean; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function add(list: FileList | null) {
    if (!list?.length) return;
    for (const f of Array.from(list)) {
      const p = fileProblem(f.name, f.size);
      if (p) return toast(`${f.name}: ${t(p)}`);
    }
    const form = new FormData();
    for (const f of Array.from(list)) form.append("files", f);
    setBusy(true);
    try {
      await apiForm(`/jobs/${enc(jobId)}/files`, form);
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function caption(p: any, patch: Record<string, string>) {
    try {
      await api(`/workbook/${enc(jobId)}/photos/${enc(p.id)}`, { method: "PUT", body: { caption: p.caption ?? "", recipe_screen: p.recipe_screen ?? "", ...patch } });
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="panel stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>{t("Photos and recipe screens")}</h3>
        <span className="spacer" />
        {fill && (
          <>
            <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
            <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? t("Adding…") : t("Add photos")}</button>
          </>
        )}
      </div>
      {photos.length ? (
        <div className="wb-photos">
          {photos.map((p) => (
            <figure key={p.id} className="wb-photo">
              <a href={`/api/jobs/files/${enc(p.id)}`} target="_blank" rel="noopener noreferrer"><img src={`/api/jobs/files/${enc(p.id)}`} alt={p.caption || p.name} loading="lazy" /></a>
              {fill ? (
                <figcaption className="stack" style={{ gap: 4 }}>
                  <input aria-label={t("Caption")} defaultValue={p.caption ?? ""} placeholder={t("Caption, e.g. worn star wheel")} onBlur={(e) => e.target.value !== (p.caption ?? "") && caption(p, { caption: e.target.value })} />
                  <select aria-label={t("Recipe screen")} value={p.recipe_screen ?? ""} onChange={(e) => caption(p, { recipe_screen: e.target.value })}>
                    <option value="">{t("Not a recipe screen")}</option>
                    {SCREENS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </figcaption>
              ) : (
                <figcaption>{p.caption}{p.recipe_screen && <div className="muted">{p.recipe_screen}</div>}</figcaption>
              )}
            </figure>
          ))}
        </div>
      ) : <Empty>{t("No photos yet. Add machine photos and pictures of the recipe screens.")}</Empty>}
    </div>
  );
}

// ---- Billable hours: what the customer is billed for, per engineer per day ----

const H_EMPTY = { travel_wd: "", travel_we: "", regular: "", training: "", overtime: "", warranty: "", miles: "" };

function BillableHours({ job, rows, fill, me, canSchedule, onChange }: { job: any; rows: any[]; fill: boolean; me: Me; canSchedule: boolean; onChange: () => void }) {
  const firstDay = job.work_days.includes(today()) ? today() : job.work_days[0] ?? today();
  const [f, setF] = useState<Record<string, string>>({ day: firstDay, user_id: me.id, ...H_EMPTY });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const engineers: any[] = job.techs ?? [];
  async function save(body: Record<string, unknown>) {
    try {
      await api(`/workbook/${enc(job.id)}/hours`, { method: "PUT", body });
      onChange();
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    }
  }
  const total = rows.reduce((s, h) => s + hoursTotal(h), 0);
  return (
    <div className="panel stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>{t("Billable hours")}</h3>
        <span className="muted">{t("Hours to bill the customer for this job. Not a time clock.")}</span>
      </div>
      {rows.length ? (
        <div className="tbl">
          <table>
            <thead><tr><th>{t("Date")}</th><th>{t("Field service engineer")}</th>{HOUR_TYPES.map((h) => <th key={h.key}>{t(h.label)}</th>)}<th>{t("Miles")}</th><th>{t("Total")}</th><th /></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td>{fmtDate(h.day)}</td><td>{h.who}</td>
                  {HOUR_TYPES.map((x) => <td key={x.key} className="num">{h[x.key] || ""}</td>)}
                  <td className="num">{h.miles || ""}</td><td className="num"><strong>{hoursTotal(h)}</strong></td>
                  <td>{fill && (h.user_id === me.id || canSchedule) && <button className="linkish" onClick={() => save({ day: h.day, user_id: h.user_id })}>{t("Remove")}</button>}</td>
                </tr>
              ))}
              <tr><td colSpan={2}><strong>{t("Total")}</strong></td>{HOUR_TYPES.map((x) => <td key={x.key} className="num">{rows.reduce((s, h) => s + (h[x.key] || 0), 0) || ""}</td>)}<td className="num">{rows.reduce((s, h) => s + (h.miles || 0), 0) || ""}</td><td className="num"><strong>{total}</strong></td><td /></tr>
            </tbody>
          </table>
        </div>
      ) : <Empty>{t("No billable hours yet.")}</Empty>}
      {fill && (
        <form className="wb-hours-add" onSubmit={async (e) => { e.preventDefault(); if (await save(f)) setF((x) => ({ ...x, ...H_EMPTY })); }}>
          <div className="field"><label htmlFor="bh-day">{t("Date")}</label><input id="bh-day" type="date" required value={f.day} onChange={(e) => set("day", e.target.value)} /></div>
          {canSchedule && engineers.length > 0 && (
            <div className="field">
              <label htmlFor="bh-who">{t("Field service engineer")}</label>
              <select id="bh-who" value={f.user_id} onChange={(e) => set("user_id", e.target.value)}>
                {!engineers.some((x) => x.id === me.id) && <option value={me.id}>{me.name}</option>}
                {engineers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          )}
          {[...HOUR_TYPES, { key: "miles", label: "Miles" }].map((h) => (
            <div className="field" key={h.key}><label htmlFor={`bh-${h.key}`}>{t(h.label)}</label><input id={`bh-${h.key}`} inputMode="decimal" value={f[h.key]} placeholder="0" onChange={(e) => set(h.key, e.target.value)} /></div>
          ))}
          <div><button className="btn primary">{t("Save the day")}</button></div>
          <p className="muted small-note" style={{ gridColumn: "1 / -1", margin: 0 }}>{t("Saving a date again replaces that day's hours.")}</p>
        </form>
      )}
    </div>
  );
}

// ---- Expenses ----

function Expenses({ job, rows, fill, me, billable, onChange }: { job: any; rows: any[]; fill: boolean; me: Me; billable: "Y" | "N"; onChange: () => void }) {
  const firstDay = job.work_days.includes(today()) ? today() : job.work_days[0] ?? today();
  const blank: Record<string, string> = { day: firstDay, type: "", amount: "", pay: "Credit", description: "", billable };
  const [f, setF] = useState<Record<string, string>>(blank);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let receipt_file: string | undefined;
      if (receipt) {
        const p = fileProblem(receipt.name, receipt.size);
        if (p) throw new Error(`${receipt.name}: ${t(p)}`);
        const form = new FormData();
        form.append("files", receipt);
        receipt_file = (await apiForm(`/jobs/${enc(job.id)}/files`, form)).ids[0];
      }
      await api(`/workbook/${enc(job.id)}/expenses`, { body: { ...f, receipt_file } });
      setF({ ...blank, day: f.day ?? firstDay });
      setReceipt(null);
      onChange();
    } catch (x) {
      toast((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/workbook/${enc(job.id)}/expenses/${enc(id)}`, { method: "DELETE" });
      onChange();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  const total = rows.reduce((s, x) => s + x.amount_cents, 0);
  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>{t("Expenses")}</h3>
      {rows.length ? (
        <div className="tbl">
          <table>
            <thead><tr><th>{t("Date")}</th><th>{t("Field service engineer")}</th><th>{t("Kind")}</th><th>{t("What it was for")}</th><th>{t("Paid by")}</th><th>{t("Billable")}</th><th className="num">{t("Amount")}</th><th /></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{fmtDate(x.day)}</td><td>{x.who}</td><td>{t(x.type)}</td>
                  <td>{x.description}{x.receipt_file && <> · <a href={`/api/jobs/files/${enc(x.receipt_file)}`} target="_blank" rel="noopener noreferrer">{t("Receipt")}</a></>}</td>
                  <td>{t(x.pay)}</td><td>{x.billable === "Y" ? t("Yes") : t("No")}</td><td className="num">{money(x.amount_cents)}</td>
                  <td>{fill && x.user_id === me.id && <button className="linkish" onClick={() => remove(x.id)}>{t("Remove")}</button>}</td>
                </tr>
              ))}
              <tr><td colSpan={6}><strong>{t("Total")}</strong></td><td className="num"><strong>{money(total)}</strong></td><td /></tr>
            </tbody>
          </table>
        </div>
      ) : <Empty>{t("No expenses yet.")}</Empty>}
      {fill && (
        <form className="grid g3 wb-add" onSubmit={add}>
          <div className="field"><label htmlFor="ex-day">{t("Date")}</label><input id="ex-day" type="date" required value={f.day} onChange={(e) => set("day", e.target.value)} /></div>
          <div className="field"><label htmlFor="ex-type">{t("Kind")} *</label><Select id="ex-type" value={f.type ?? ""} list={EXPENSE_TYPES} label={(v) => t(v)} onChange={(v) => set("type", v)} /></div>
          <div className="field"><label htmlFor="ex-amount">{t("Amount")} *</label><input id="ex-amount" inputMode="decimal" required placeholder="0.00" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <div className="field"><label htmlFor="ex-desc">{t("What it was for")}</label><input id="ex-desc" value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div className="field">
            <label htmlFor="ex-pay">{t("Paid by")}</label>
            <select id="ex-pay" value={f.pay} onChange={(e) => set("pay", e.target.value)}><option value="Credit">{t("Credit")}</option><option value="Cash">{t("Cash")}</option></select>
          </div>
          <div className="field">
            <label htmlFor="ex-bill">{t("Billable")}</label>
            <select id="ex-bill" value={f.billable} onChange={(e) => set("billable", e.target.value)}><option value="Y">{t("Yes")}</option><option value="N">{t("No")}</option></select>
          </div>
          <div className="field"><label htmlFor="ex-rc">{t("Receipt photo")}</label><input id="ex-rc" type="file" accept="image/*,.pdf" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} /></div>
          <div><button className="btn primary" disabled={busy || !f.type}>{t("Add the expense")}</button></div>
        </form>
      )}
    </div>
  );
}

// ---- Customer sign-off with a drawn signature ----

function SignOff({ jobId, report, fill, onSaved }: { jobId: string; report: any; fill: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ sign_name: report.sign_name ?? "", sign_title: report.sign_title ?? "", sign_date: report.sign_date ?? today() });
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!;
    const b = c.getBoundingClientRect();
    return { x: ((e.clientX - b.left) * c.width) / b.width, y: ((e.clientY - b.top) * c.height) / b.height };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = canvas.current!.getContext("2d")!;
    const p = point(e);
    g.lineWidth = 3; g.lineCap = "round"; g.strokeStyle = "#111";
    g.beginPath(); g.moveTo(p.x, p.y);
    drawing.current = true;
    canvas.current!.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const g = canvas.current!.getContext("2d")!;
    const p = point(e);
    g.lineTo(p.x, p.y); g.stroke();
    setDrawn(true);
  }
  function clear() {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  }
  async function save(removeSignature = false) {
    try {
      const signature = removeSignature ? null : drawn ? canvas.current!.toDataURL("image/png") : undefined;
      await api(`/workbook/${enc(jobId)}/report`, { method: "PUT", body: { ...f, ...(signature !== undefined ? { signature } : {}), revision: report.revision ?? 0 } });
      clear();
      toast(t("Saved"));
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>{t("Customer sign-off")}</h3>
      {fill ? (
        <div className="grid g3">
          <div className="field"><label htmlFor="so-name">{t("Printed name")}</label><input id="so-name" value={f.sign_name} onChange={(e) => set("sign_name", e.target.value)} /></div>
          <div className="field"><label htmlFor="so-title">{t("Title")}</label><input id="so-title" value={f.sign_title} placeholder={t("e.g. Maintenance Manager")} onChange={(e) => set("sign_title", e.target.value)} /></div>
          <div className="field"><label htmlFor="so-date">{t("Date")}</label><input id="so-date" type="date" value={f.sign_date} onChange={(e) => set("sign_date", e.target.value)} /></div>
        </div>
      ) : (
        <p style={{ margin: 0 }}>{report.sign_name ? `${report.sign_name}${report.sign_title ? `, ${report.sign_title}` : ""}${report.sign_date ? ` · ${fmtDate(report.sign_date)}` : ""}` : <span className="muted">{t("Not signed yet.")}</span>}</p>
      )}
      {report.signature && <img className="wb-sig" src={report.signature} alt={t("Customer signature")} />}
      {fill && (
        <>
          <div className="wo-l">{report.signature ? t("Sign again to replace it") : t("Customer signs here")}</div>
          <canvas ref={canvas} className="wb-pad" width={900} height={240} onPointerDown={down} onPointerMove={move} onPointerUp={() => (drawing.current = false)} onPointerLeave={() => (drawing.current = false)} />
          <div className="row">
            <button className="btn primary" onClick={() => save()}>{t("Save the sign-off")}</button>
            <button className="btn" onClick={clear} disabled={!drawn}>{t("Clear")}</button>
            {report.signature && <button className="linkish" onClick={() => save(true)}>{t("Remove the signature")}</button>}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Submit ----

function SubmitButton({ jobId, recipients, onDone }: { jobId: string; recipients: { id: string; name: string }[]; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!sure) {
      setSure(true);
      toast(recipients.length
        ? t("Press Submit again to send the report to {names}. The report locks until a scheduler reopens it.", { names: recipients.map((r) => r.name).join(", ") })
        : t("Press Submit again to submit. No one is set to get reports yet; an admin picks them on the Work orders page."));
      return;
    }
    setBusy(true);
    try {
      const r = await api(`/workbook/${enc(jobId)}/submit`, { body: {} });
      const failed = r.sent.filter((s: any) => s.status !== "sent");
      if (failed.length) {
        const to = failed.map((s: any) => s.to).filter(Boolean).join(",");
        window.location.href = `mailto:${to}?subject=${enc(r.subject)}&body=${enc(r.text)}`;
        toast(t("Submitted. Email from the portal isn't set up yet, so your email app opens with the report."));
      } else {
        toast(t("Submitted. Quick notes added: {n}", { n: r.notes.length }));
      }
      onDone();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      setSure(false);
    }
  }
  return <button className="btn primary" disabled={busy} onClick={go}>{sure ? t("Press again to submit") : t("Submit")}</button>;
}

// ---- Who gets submitted reports (admins), on the Work orders list ----

export function ReportRecipients({ me }: { me: Me }) {
  const staff = useLoad(() => (can(me, "settings.manage") ? api("/jobs/staff") : Promise.resolve(null)));
  const current = useLoad(() => (can(me, "settings.manage") ? api("/workbook/settings/recipients") : Promise.resolve(null)));
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  if (!can(me, "settings.manage") || !staff.data || !current.data) return null;
  const ids: string[] = picked ?? current.data.recipients.map((r: any) => r.id);
  const people: any[] = staff.data.staff ?? staff.data.people ?? [];
  async function save() {
    try {
      await api("/workbook/settings/recipients", { method: "PUT", body: { userIds: ids } });
      toast(t("Saved"));
      setOpen(false);
      setPicked(null);
      current.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="panel stack">
      <div className="row">
        <div><strong>{t("Submitted service reports go to")}</strong> <span className="muted">{current.data.recipients.length ? current.data.recipients.map((r: any) => r.name).join(", ") : t("no one yet")}</span></div>
        <span className="spacer" />
        <button className="btn small" onClick={() => setOpen(!open)}>{open ? t("Close") : t("Change")}</button>
      </div>
      {open && (
        <>
          <div className="wb-people">
            {people.map((p) => (
              <label key={p.id} className="check"><input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} /> {p.name}</label>
            ))}
          </div>
          <div><button className="btn primary" onClick={save}>{t("Save")}</button></div>
        </>
      )}
    </div>
  );
}

// ---- Billing: every engineer's billable hours and expenses for a week ----

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BillingWeek({ me }: { me: Me }) {
  const [start, setStart] = useState(() => mondayOf(today()));
  const { data, error } = useLoad(() => api(`/workbook/billing/week?start=${start}`), [start], { live: true });
  if (!can(me, "workbook.billing")) return <ErrorNote error={t("Your role doesn't allow this.")} />;
  const hours: any[] = data?.hours ?? [];
  const expenses: any[] = data?.expenses ?? [];
  const people = [...new Set([...hours.map((h) => h.who), ...expenses.map((x) => x.who)])].sort();

  function csv() {
    const hRows = hours.map((h) => [h.who, h.customer, h.job_number, h.day, ...HOUR_TYPES.map((x) => h[x.key] || 0), hoursTotal(h), h.miles || 0]);
    const xRows = expenses.map((x) => [x.who, x.customer, x.job_number, x.day, x.type, fromCents(x.amount_cents), x.pay, x.billable, x.description ?? ""]);
    download(`Billable hours ${start}.csv`, toCsv(["Field service engineer", "Customer", "Project #", "Date", ...HOUR_TYPES.map((x) => x.label), "Total hours", "Mileage"], hRows));
    if (xRows.length) setTimeout(() => download(`Expenses ${start}.csv`, toCsv(["Field service engineer", "Customer", "Project #", "Date", "Kind", "Amount", "Paid by", "Billable", "What it was for"], xRows)), 400);
  }

  return (
    <>
      <PageHead title={t("Billing from work orders")} sub={t("Billable hours and expenses for every field service engineer, one week at a time.")}>
        <button className="btn" onClick={() => setStart(addDays(start, -7))}>{t("Previous week")}</button>
        <button className="btn" onClick={() => setStart(mondayOf(today()))}>{t("This week")}</button>
        <button className="btn" onClick={() => setStart(addDays(start, 7))}>{t("Next week")}</button>
        <button className="btn" onClick={csv} disabled={!hours.length && !expenses.length}>{t("Download (CSV)")}</button>
      </PageHead>
      <JobListTabs me={me} on="billing" />
      <p className="muted">{t("Week of {date}", { date: fmtDate(start) })}</p>
      {error && <ErrorNote error={error} />}
      {data && !people.length && <div className="panel"><Empty>{t("Nothing entered for this week yet.")}</Empty></div>}
      {people.map((who) => {
        const hs = hours.filter((h) => h.who === who);
        const xs = expenses.filter((x) => x.who === who);
        return (
          <section key={who} className="panel stack">
            <h2 style={{ margin: 0 }}>{who}</h2>
            {hs.length > 0 && (
              <div className="tbl">
                <table>
                  <thead><tr><th>{t("Date")}</th><th>{t("Job")}</th>{HOUR_TYPES.map((h) => <th key={h.key}>{t(h.label)}</th>)}<th>{t("Miles")}</th><th>{t("Total")}</th></tr></thead>
                  <tbody>
                    {hs.map((h) => (
                      <tr key={h.id}>
                        <td>{fmtDate(h.day)}</td><td><Link to={`/jobs/${h.job_id}/work-order`} className="mono">{h.job_number}</Link> <span className="muted">{h.customer}</span></td>
                        {HOUR_TYPES.map((x) => <td key={x.key} className="num">{h[x.key] || ""}</td>)}<td className="num">{h.miles || ""}</td><td className="num"><strong>{hoursTotal(h)}</strong></td>
                      </tr>
                    ))}
                    <tr><td colSpan={2}><strong>{t("Week total")}</strong></td>{HOUR_TYPES.map((x) => <td key={x.key} className="num">{hs.reduce((s, h) => s + (h[x.key] || 0), 0) || ""}</td>)}<td className="num">{hs.reduce((s, h) => s + (h.miles || 0), 0) || ""}</td><td className="num"><strong>{hs.reduce((s, h) => s + hoursTotal(h), 0)}</strong></td></tr>
                  </tbody>
                </table>
              </div>
            )}
            {xs.length > 0 && (
              <div className="tbl">
                <table>
                  <thead><tr><th>{t("Date")}</th><th>{t("Job")}</th><th>{t("Kind")}</th><th>{t("What it was for")}</th><th>{t("Billable")}</th><th className="num">{t("Amount")}</th></tr></thead>
                  <tbody>
                    {xs.map((x) => (
                      <tr key={x.id}>
                        <td>{fmtDate(x.day)}</td><td><Link to={`/jobs/${x.job_id}/work-order`} className="mono">{x.job_number}</Link></td><td>{t(x.type)}</td>
                        <td>{x.description}{x.receipt_file && <> · <a href={`/api/jobs/files/${enc(x.receipt_file)}`} target="_blank" rel="noopener noreferrer">{t("Receipt")}</a></>}</td>
                        <td>{x.billable === "Y" ? t("Yes") : t("No")}</td><td className="num">{money(x.amount_cents)}</td>
                      </tr>
                    ))}
                    <tr><td colSpan={5}><strong>{t("Week total")}</strong></td><td className="num"><strong>{money(xs.reduce((s, x) => s + x.amount_cents, 0))}</strong></td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

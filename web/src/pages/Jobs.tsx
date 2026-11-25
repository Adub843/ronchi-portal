// Tech jobs: the schedule list, one job's page, and the form schedulers use to make or change a job.
// Each job's work order (the Ronchi workbook) is a tab on the job page, in WorkOrders.tsx. An admin can
// switch the workbook off; then the tab is gone and jobs work as before.
import { useRef, useState } from "react";
import { api, apiForm, can, fmtDate, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { t } from "../i18n";
import { navigate } from "../router";
import { LinkedShipments } from "./Shipping";
import { ACCEPT, fileProblem, fmtSize } from "../../../src/shared/files";
import { dayRange, type JobStatus } from "../../../src/shared/jobs";
import { ReportRecipients } from "./Workbook";
import { WorkOrderTab } from "./WorkOrders";

export const STATUS_LABEL: Record<JobStatus, string> = { scheduled: "Scheduled", in_progress: "In progress", done: "Done", cancelled: "Cancelled" };
const STATUS_CLASS: Record<JobStatus, string> = { scheduled: "p-info", in_progress: "p-warn", done: "p-ok", cancelled: "p-acc" };

export function JobStatusPill({ status }: { status: JobStatus }) {
  return <span className={`pill ${STATUS_CLASS[status] ?? "p-info"}`}>{t(STATUS_LABEL[status] ?? status)}</span>;
}

/** "Tue, Dec 1 – Thu, Dec 3 · 3 days" in the reader's language. */
export function DaysText({ days }: { days: string[] }) {
  if (!days.length) return <span className="muted">{t("No days set")}</span>;
  if (days.length === 1) return <>{fmtDate(days[0]!)}</>;
  return <>{fmtDate(days[0]!)} – {fmtDate(days[days.length - 1]!)} · {t("{n} days", { n: days.length })}</>;
}

/** The address, with buttons that open it in Google Maps, Waze or Apple Maps. */
export function Location({ location, maps }: { location: string | null; maps: { google: string; waze: string; apple: string } | null }) {
  if (!location || !maps) return <span className="muted">{t("No location yet.")}</span>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <a href={maps.google} target="_blank" rel="noopener noreferrer" className="addr">{location}</a>
      <div className="row maprow">
        <a className="btn small" href={maps.google} target="_blank" rel="noopener noreferrer">Google Maps</a>
        <a className="btn small" href={maps.waze} target="_blank" rel="noopener noreferrer">Waze</a>
        <a className="btn small" href={maps.apple} target="_blank" rel="noopener noreferrer">Apple Maps</a>
      </div>
    </div>
  );
}

export function Contact({ job }: { job: any }) {
  if (!job.contact_name && !job.contact_phone && !job.contact_email) return <span className="muted">{t("No contact yet.")}</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {job.contact_name && <b>{job.contact_name}</b>}
      {job.contact_phone && <a href={`tel:${job.contact_phone.replace(/[^\d+]/g, "")}`}>{job.contact_phone}</a>}
      {job.contact_email && <a href={`mailto:${job.contact_email}`}>{job.contact_email}</a>}
    </div>
  );
}

// ---- The list ----

const VIEWS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "mine", label: "My jobs" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
] as const;

export function JobList({ me, workbook }: { me: Me; workbook: boolean }) {
  // Schedulers open on what's coming up; field service engineers on their own jobs.
  const [view, setView] = useState<string>(can(me, "jobs.schedule") ? "upcoming" : "mine");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error } = useLoad(() => api(`/jobs?view=${view}&q=${encodeURIComponent(query)}`), [view, query], { live: true });
  return (
    <>
      <PageHead title={t("Jobs")} sub={workbook ? t("Field service visits: who is going where and when, with each visit's work order.") : t("Field service visits: who is going where, and when.")}>
        {can(me, "jobs.schedule") && <Link to="/jobs/new" className="btn primary">{t("Schedule a job")}</Link>}
      </PageHead>
      {workbook && <JobListTabs me={me} on="jobs" />}
      {workbook && <ReportRecipients me={me} />}
      <div className="row">
        <div className="seg" role="radiogroup" aria-label={t("Show")}>
          {VIEWS.map((v) => <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>{t(v.label)}</button>)}
        </div>
        <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
          <input className="panel" style={{ flex: 1, minWidth: 180, padding: "8px 12px", font: "inherit" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search by job number, customer, machine or address")} aria-label={t("Search jobs")} />
          <button className="btn" type="submit">{t("Search")}</button>
        </form>
      </div>
      <ErrorNote error={error} />
      <div className="panel tbl">
        {data && !data.jobs.length && <Empty>{query ? t("No jobs match.") : t("No jobs here yet.")}</Empty>}
        {!!data?.jobs.length && (
          <table className="jobs">
            <thead><tr><th>{t("Job")}</th><th>{t("Customer")}</th><th>{t("Days of work")}</th><th>{t("Field service engineers")}</th><th>{t("Status")}</th></tr></thead>
            <tbody>
              {data.jobs.map((j: any) => (
                <tr key={j.id}>
                  <td className="mono"><Link to={`/jobs/${j.id}`}>{j.job_number}</Link>{j.machine && <div className="muted">{j.machine}</div>}</td>
                  <td>{j.customer}{j.location && <div className="muted small1">{j.location.split("\n")[0]}</div>}</td>
                  <td><DaysText days={j.work_days} /></td>
                  <td>{j.techs.length ? j.techs.map((x: any) => x.name).join(", ") : <span className="muted">{t("No field service engineers yet")}</span>}</td>
                  <td><JobStatusPill status={j.status} />{j.files > 0 && <div className="muted small1">{t("{n} files", { n: j.files })}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** With the workbook on, people who bill customers get a second tab on the Jobs list: the billing week. */
export function JobListTabs({ me, on }: { me: Me; on: "jobs" | "billing" }) {
  if (!can(me, "workbook.billing")) return null;
  return (
    <div className="row cp-tabs" role="tablist">
      <Link to="/jobs" className={`btn${on === "jobs" ? " primary" : ""}`} aria-current={on === "jobs" ? "page" : undefined}>{t("Jobs")}</Link>
      <Link to="/jobs/billing" className={`btn${on === "billing" ? " primary" : ""}`} aria-current={on === "billing" ? "page" : undefined}>{t("Billing from work orders")}</Link>
    </div>
  );
}

// ---- After saving: did the emails go out? ----

export interface EmailResult { userId: string; name: string; status: "sent" | "not_set_up" | "no_address" | "failed"; to: string | null; subject?: string; text?: string }

const mailto = (r: EmailResult) => `mailto:${encodeURIComponent(r.to ?? "")}?subject=${encodeURIComponent(r.subject ?? "")}&body=${encodeURIComponent(r.text ?? "")}`;

export function EmailReport({ emails, onClose }: { emails: EmailResult[]; onClose: () => void }) {
  if (!emails.length) return null;
  const notSent = emails.filter((e) => e.status !== "sent");
  return (
    <div className="panel stack emailreport" role="status">
      <div className="row"><h2 style={{ margin: 0 }}>{t("Job emails")}</h2><span className="spacer" /><button className="btn small" onClick={onClose}>{t("Close")}</button></div>
      {emails.map((e) => (
        <div key={e.userId} className="row">
          <b>{e.name}</b>
          {e.status === "sent" && <span className="pill p-ok">{t("Email sent")}</span>}
          {e.status === "not_set_up" && <span className="pill p-warn">{t("Not sent: portal email isn't set up yet")}</span>}
          {e.status === "no_address" && <span className="pill p-warn">{t("Not sent: no email address on their login")}</span>}
          {e.status === "failed" && <span className="pill p-acc">{t("Not sent: the email service refused it")}</span>}
          {e.status !== "sent" && e.subject && <a className="btn small" href={mailto(e)}>{t("Send it from my email")}</a>}
        </div>
      ))}
      {notSent.some((e) => e.status === "no_address") && <p className="muted" style={{ margin: 0 }}>{t("An admin can add an email for job notices on the People page.")}</p>}
    </div>
  );
}

// ---- Files on a job ----

export function JobFiles({ jobId, files, me, canRemoveAll, onChange }: { jobId: string; files: any[]; me: Me; canRemoveAll: boolean; onChange: () => void }) {
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
      await apiForm(`/jobs/${encodeURIComponent(jobId)}/files`, form);
      toast(t("Added"));
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove(f: any) {
    try {
      await api(`/jobs/files/${encodeURIComponent(f.id)}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {files.length ? (
        <ul className="filelist">
          {files.map((f) => (
            <li key={f.id}>
              <a href={f.url ?? `/api/jobs/files/${encodeURIComponent(f.id)}?download=1`} download={f.name}>{f.name}</a>
              <span className="muted"> · {fmtSize(f.size)} · {f.by_name ?? ""} · {fmtTime(f.created_at)}</span>
              {(f.user_id === me.id || canRemoveAll) && <button className="linkish" style={{ marginLeft: 8 }} onClick={() => remove(f)} aria-label={t("Remove {name}", { name: f.name })}>{t("Remove")}</button>}
            </li>
          ))}
        </ul>
      ) : <Empty>{t("No files yet. Add service reports, photos and drawings here.")}</Empty>}
      {can(me, "files.send") && (
        <div>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => add(e.target.files)} />
          <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? t("Adding…") : t("Add files")}</button>
        </div>
      )}
    </div>
  );
}

// ---- One job ----

/** One job. With the workbook on it has two tabs: the job itself, and its work order (`tab`). */
export function JobPage({ id, me, tab = "job" }: { id: string; me: Me; tab?: "job" | "work-order" }) {
  const { data, error, reload } = useLoad(() => api(`/jobs/${encodeURIComponent(id)}`), [id], { live: true });
  const [editing, setEditing] = useState(false);
  const [emails, setEmails] = useState<EmailResult[]>(() => {
    const r = justScheduled?.id === id ? justScheduled.emails : [];
    justScheduled = null;
    return r;
  });
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const j = data.job;
  const scheduler = can(me, "jobs.schedule");
  const onWo = tab === "work-order" && data.workbook;

  async function resend() {
    try {
      const r = await api(`/jobs/${encodeURIComponent(id)}/email`, { body: {} });
      setEmails(r.emails);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (editing) return <JobForm me={me} job={{ ...j, techIds: data.techs.map((x: any) => x.id) }} onDone={(r) => { setEditing(false); setEmails(r?.emails ?? []); reload(); }} />;

  return (
    <>
      <PageHead title={t("Job {number}", { number: j.job_number })} sub={[j.customer, j.machine].filter(Boolean).join(" · ")}>
        <JobStatusPill status={j.status} />
        {scheduler && <button className="btn" onClick={() => setEditing(true)}>{t("Edit")}</button>}
      </PageHead>
      <EmailReport emails={emails} onClose={() => setEmails([])} />
      {data.workbook && (
        <div className="row cp-tabs no-print" role="tablist">
          <Link to={`/jobs/${j.id}`} className={`btn${onWo ? "" : " primary"}`} aria-current={onWo ? undefined : "page"}>{t("Schedule")}</Link>
          <Link to={`/jobs/${j.id}/work-order`} className={`btn${onWo ? " primary" : ""}`} aria-current={onWo ? "page" : undefined}>{t("Work order")}</Link>
        </div>
      )}
      {onWo ? <WorkOrderTab job={j} me={me} onFiles={reload} /> : (
      <div className="grid g2">
        <div className="panel stack"><h2 style={{ margin: 0 }}>{t("Location")}</h2><Location location={j.location} maps={data.maps} /></div>
        <div className="panel stack"><h2 style={{ margin: 0 }}>{t("Point of contact")}</h2><Contact job={j} /></div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Days of work")}</h2>
          <p style={{ margin: 0 }}><DaysText days={j.work_days} /></p>
          {j.work_days.length > 1 && <div className="row daychips">{j.work_days.map((d: string) => <span key={d} className="chip">{fmtDate(d)}</span>)}</div>}
        </div>
        <div className="panel stack">
          <div className="row"><h2 style={{ margin: 0 }}>{t("Field service engineers")}</h2><span className="spacer" />{scheduler && data.techs.length > 0 && <button className="btn small" onClick={resend}>{t("Send the email again")}</button>}</div>
          {data.techs.length ? data.techs.map((x: any) => (
            <div key={x.id} className="row">
              <span>{x.name}</span>
              {x.email_status === "sent" && <span className="pill p-ok">{t("Emailed {when}", { when: fmtTime(x.emailed_at) })}</span>}
              {x.email_status && x.email_status !== "sent" && <span className="pill p-warn">{t("Email not sent")}</span>}
            </div>
          )) : <Empty>{t("No field service engineers yet")}</Empty>}
        </div>
        <div className="panel stack" style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ margin: 0 }}>{t("Other information")}</h2>
          {j.notes ? <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{j.notes}</p> : <span className="muted">{t("Nothing added.")}</span>}
          {data.machine && <p style={{ margin: 0 }}><Link to={`/machines/${data.machine.id}`}>{t("Machine {serial}", { serial: data.machine.serial })}</Link></p>}
        </div>
        <div className="panel stack" style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ margin: 0 }}>{t("Files")}</h2>
          <JobFiles jobId={j.id} files={data.files} me={me} canRemoveAll={scheduler} onChange={reload} />
        </div>
        <LinkedShipments me={me} link={{ type: "job", id: j.id }} shipLabel={t("Ship parts for this job")} />
      </div>
      )}
    </>
  );
}

// ---- Make or change a job ----

const EMPTY = { job_number: "", customer: "", machine: "", location: "", contact_name: "", contact_phone: "", contact_email: "", notes: "", work_days: [] as string[], techIds: [] as string[], status: "scheduled" };

// The email results of a job just scheduled, shown once on its page after the form closes.
let justScheduled: { id: string; emails: EmailResult[] } | null = null;

export function NewJob({ me }: { me: Me }) {
  return <JobForm me={me} job={null} onDone={(r) => {
    if (!r) return navigate("/jobs");
    justScheduled = r;
    navigate(`/jobs/${r.id}`);
  }} />;
}

export function JobForm({ me, job, onDone }: { me: Me; job: any | null; onDone: (r: { id: string; emails: EmailResult[] } | null) => void }) {
  const staff = useLoad(() => api("/jobs/staff"));
  const [f, setF] = useState(() => (job ? { ...EMPTY, ...Object.fromEntries(Object.entries(job).map(([k, v]) => [k, v ?? ""])), work_days: job.work_days, techIds: job.techIds } : EMPTY));
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [weekdays, setWeekdays] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const addDays = (list: string[]) => set("work_days", [...new Set([...f.work_days, ...list])].sort());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { techIds, work_days, ...rest } = f as any;
    const payload: any = { ...Object.fromEntries(Object.keys(EMPTY).filter((k) => k in rest).map((k) => [k, rest[k]])), work_days, techIds };
    try {
      if (job) {
        const r = await api(`/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", body: { ...payload, revision: job.revision } });
        toast(t("Saved"));
        onDone({ id: job.id, emails: r.emails });
      } else {
        delete payload.status;
        const r = await api("/jobs", { body: payload });
        onDone(r);
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const text = (k: keyof typeof EMPTY, label: string, opts: { required?: boolean; type?: string; placeholder?: string; mono?: boolean } = {}) => (
    <div className="field">
      <label htmlFor={`j-${k}`}>{label}{opts.required && " *"}</label>
      <input id={`j-${k}`} type={opts.type ?? "text"} value={(f as any)[k]} required={opts.required} placeholder={opts.placeholder} className={opts.mono ? "mono" : undefined} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <>
      <PageHead title={job ? t("Edit job {number}", { number: job.job_number }) : t("Schedule a job")} sub={t("The field service engineers you pick get an email with a link to the job.")} />
      <form className="stack" onSubmit={save}>
        <div className="panel grid g2">
          {text("job_number", t("Job number"), { required: true, mono: true, placeholder: "J-1042" })}
          {text("customer", t("Customer"), { required: true })}
          {text("machine", t("Machine number"), { mono: true, placeholder: "4110MB" })}
          {job && (
            <div className="field">
              <label htmlFor="j-status">{t("Status")}</label>
              <select id="j-status" value={f.status} onChange={(e) => set("status", e.target.value)}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </select>
            </div>
          )}
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="j-location">{t("Customer location (address)")}</label>
            <textarea id="j-location" rows={2} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder={t("Street, city, state and ZIP. Field service engineers can open it in Google Maps, Waze or Apple Maps.")} />
          </div>
        </div>
        <div className="panel grid g3">
          <h2 style={{ gridColumn: "1 / -1", margin: 0 }}>{t("Point of contact")}</h2>
          {text("contact_name", t("Name"))}
          {text("contact_phone", t("Phone"), { type: "tel" })}
          {text("contact_email", t("Email"), { type: "email" })}
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Days of work")}</h2>
          <div className="row">
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label={t("Day")} />
            <button type="button" className="btn" disabled={!day} onClick={() => { addDays([day]); setDay(""); }}>{t("Add day")}</button>
            <span className="muted">{t("or")}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("From")} />
            <span>–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("To")} />
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={weekdays} onChange={(e) => setWeekdays(e.target.checked)} />{t("Weekdays only")}</label>
            <button type="button" className="btn" disabled={!from || !to} onClick={() => { addDays(dayRange(from, to, { weekdays })); setFrom(""); setTo(""); }}>{t("Add these days")}</button>
          </div>
          {f.work_days.length ? (
            <div className="row daychips">
              {f.work_days.map((d: string) => (
                <span key={d} className="chip">{fmtDate(d)}<button type="button" aria-label={t("Remove {name}", { name: fmtDate(d) })} onClick={() => set("work_days", f.work_days.filter((x: string) => x !== d))}>×</button></span>
              ))}
            </div>
          ) : <span className="muted">{t("No days set")}</span>}
        </div>
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t("Field service engineers")}</h2>
          <ErrorNote error={staff.error} />
          <div className="techpick">
            {staff.data?.people.map((p: any) => (
              <label key={p.id} className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={f.techIds.includes(p.id)} onChange={(e) => set("techIds", e.target.checked ? [...f.techIds, p.id] : f.techIds.filter((x: string) => x !== p.id))} />
                <span>{p.name}{!p.emailTo && <small className="muted"> · {t("no email")}</small>}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="field">
            <label htmlFor="j-notes">{t("Other information")}</label>
            <textarea id="j-notes" rows={5} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("Parts to bring, site rules, hotel, anything the field service engineers should know.")} />
          </div>
        </div>
        <ErrorNote error={err} />
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>{job ? t("Save") : t("Schedule and email the field service engineers")}</button>
          <button className="btn" type="button" onClick={() => onDone(null)}>{t("Cancel")}</button>
        </div>
      </form>
    </>
  );
}

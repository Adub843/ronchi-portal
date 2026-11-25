// The Ronchi workbook: each job's Work order tab (Aaron, 2026-11-25: a job and its work order are the
// same visit, so they share one page). The field service engineer's email opens this tab: the service
// report, log, photos, billable hours and expenses, then the log of past work orders for the same machine
// and what else the portal knows about it. An admin can switch the workbook off (Settings); then the tab
// is gone and the job email links to the plain job page instead.
import { api, fmtDate, type Me } from "../api";
import { Empty, ErrorNote, Link, useLoad } from "../components/ui";
import { t } from "../i18n";
import { toCsv } from "../../../src/shared/csv";
import { DaysText, JobStatusPill } from "./Jobs";
import { WorkbookPanel } from "./Workbook";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkOrderTab({ job, me, onFiles }: { job: { id: string }; me: Me; onFiles: () => void }) {
  const { data, error, reload } = useLoad(() => api(`/jobs/${encodeURIComponent(job.id)}/workbook`), [job.id], { live: true });
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const j = data.job;
  const all = [j, ...data.log];

  function exportLog() {
    const rows = all.map((w: any) => [w.job_number, w.status, w.work_days.join(" "), w.customer, w.machine ?? "", w.location ?? "", w.techs.map((x: any) => x.name).join(", "), w.notes ?? "", w.files.map((f: any) => f.name).join(", ")]);
    download(`Work orders ${j.machine ?? j.customer}.csv`, toCsv(["Job number", "Status", "Days of work", "Customer", "Machine", "Location", "Field service engineers", "Other information", "Files"], rows));
  }

  return (
    <>
      <div className="row no-print" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => window.print()}>{t("Print or save as PDF")}</button>
        <button className="btn" onClick={exportLog}>{t("Download the log (CSV)")}</button>
      </div>
      {/* On paper the job's details print above the report. */}
      <section className="panel wo print-only">
        <div className="wo-head"><span className="wo-tag">{t("Work order")}</span><span className="mono wo-num">{j.job_number}</span></div>
        <p style={{ margin: 0 }}>{[j.customer, j.machine, j.location?.split("\n")[0]].filter(Boolean).join(" · ")}</p>
        <p style={{ margin: 0 }}><DaysText days={j.work_days} /> · {j.techs.map((x: any) => x.name).join(", ")}</p>
      </section>

      <WorkbookPanel job={j} me={me} onFiles={() => { reload(); onFiles(); }} />

      {data.machine && (
        <section className="panel stack">
          <div className="row"><h2 style={{ margin: 0 }}>{t("Machine {serial}", { serial: data.machine.serial })}</h2><span className="spacer" /><Link to={`/machines/${data.machine.id}`} className="btn small">{t("Machine page")}</Link></div>
          <p className="muted" style={{ margin: 0 }}>{[data.machine.model, data.machine.customer, data.machine.site].filter(Boolean).join(" · ")}</p>
          {data.machine.notes && <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{data.machine.notes}</p>}
          {data.machine.sharepoint_url && <p style={{ margin: 0 }}><a href={data.machine.sharepoint_url} target="_blank" rel="noopener noreferrer">{t("Open the SharePoint folder")}</a></p>}
          {data.notes.length > 0 && (
            <div>
              <div className="wo-l">{t("Quick notes and articles for this machine")}</div>
              <ul className="filelist">{data.notes.map((n: any) => <li key={n.id}><Link to={`/kb/${n.id}`}><span className="mono">{n.code}</span> {n.title}</Link></li>)}</ul>
            </div>
          )}
          {data.orders.length > 0 && (
            <div>
              <div className="wo-l">{t("Change parts")}</div>
              <ul className="filelist">{data.orders.map((o: any) => <li key={o.id}><Link to={`/change-parts/${o.id}`}>{o.part || t("Order")}</Link> <span className="muted">· {o.status ?? ""}</span></li>)}</ul>
            </div>
          )}
        </section>
      )}

      <section className="stack">
        <h2 style={{ margin: "8px 0 0" }}>{data.logBy === "machine" ? t("Past work orders for this machine") : t("Past work orders for this customer")}</h2>
        {!data.log.length && <div className="panel"><Empty>{t("No past work orders yet. Finished jobs will build up here.")}</Empty></div>}
        <ol className="wo-log">
          {data.log.map((w: any) => (
            <li key={w.id} className="panel wo">
              <div className="wo-head">
                <span className="wo-date">{w.work_days.length ? fmtDate(w.work_days[0]) : t("No days set")}</span>
                <Link to={`/jobs/${w.id}/work-order`} className="mono wo-num">{w.job_number}</Link>
                <JobStatusPill status={w.status} />
                <span className="spacer" />
                <span className="muted">{w.techs.map((x: any) => x.name).join(", ")}</span>
              </div>
              {w.notes && <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{w.notes}</p>}
              {w.files.length > 0 && (
                <ul className="filelist">
                  {w.files.map((f: any) => <li key={f.id}><a href={f.url ?? `/api/jobs/files/${encodeURIComponent(f.id)}?download=1`} download={f.name}>{f.name}</a></li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

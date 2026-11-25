// The Ronchi workbook: Work orders (Aaron, 2026-11-25). When a tech is scheduled, their email opens the
// job's work order here: the current work order on top, then the log of past work orders for the same
// machine with their notes and files, and what else the portal knows about that machine.
// An admin can switch the whole workbook off (Settings); then these pages and their menu item are gone,
// and the job email links to the plain job page instead.
import { api, can, fmtDate, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, useLoad } from "../components/ui";
import { t } from "../i18n";
import { toCsv } from "../../../src/shared/csv";
import { Contact, DaysText, JobFiles, JobList, JobStatusPill, Location } from "./Jobs";
import { ReportRecipients, WorkbookPanel } from "./Workbook";

export function WorkOrders({ me }: { me: Me }) {
  return (
    <>
      {can(me, "workbook.billing") && (
        <div className="row" style={{ justifyContent: "flex-end" }}><Link to="/work-orders/billing" className="btn">{t("Billing from work orders")}</Link></div>
      )}
      <ReportRecipients me={me} />
      <JobList me={me} base="/work-orders" title={t("Work orders")} sub={t("The Ronchi workbook: every work order, with each machine's log of past work orders.")} />
    </>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkOrderPage({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useLoad(() => api(`/jobs/${encodeURIComponent(id)}/workbook`), [id], { live: true });
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const j = data.job;
  const scheduler = can(me, "jobs.schedule");
  const all = [j, ...data.log];

  function exportLog() {
    const rows = all.map((w: any) => [w.job_number, w.status, w.work_days.join(" "), w.customer, w.machine ?? "", w.location ?? "", w.techs.map((x: any) => x.name).join(", "), w.notes ?? "", w.files.map((f: any) => f.name).join(", ")]);
    download(`Work orders ${j.machine ?? j.customer}.csv`, toCsv(["Job number", "Status", "Days of work", "Customer", "Machine", "Location", "Field service engineers", "Other information", "Files"], rows));
  }

  return (
    <>
      <PageHead title={t("Work orders")} sub={[j.machine, j.customer].filter(Boolean).join(" · ")}>
        <button className="btn" onClick={() => window.print()}>{t("Print or save as PDF")}</button>
        <button className="btn" onClick={exportLog}>{t("Download the log (CSV)")}</button>
        <Link to={`/jobs/${j.id}`} className="btn">{scheduler ? t("Edit job") : t("Job details")}</Link>
      </PageHead>

      <section className="panel wo current">
        <div className="wo-head">
          <span className="wo-tag">{t("Current work order")}</span>
          <span className="mono wo-num">{j.job_number}</span>
          <JobStatusPill status={j.status} />
        </div>
        <div className="grid g3 wo-grid">
          <div><div className="wo-l">{t("Customer")}</div><div>{j.customer}</div>{j.machine && <div className="mono">{j.machine}</div>}</div>
          <div><div className="wo-l">{t("Days of work")}</div><DaysText days={j.work_days} /></div>
          <div><div className="wo-l">{t("Field service engineers")}</div>{j.techs.length ? j.techs.map((x: any) => x.name).join(", ") : <span className="muted">{t("No field service engineers yet")}</span>}</div>
          <div><div className="wo-l">{t("Location")}</div><Location location={j.location} maps={data.maps} /></div>
          <div><div className="wo-l">{t("Point of contact")}</div><Contact job={j} /></div>
          <div><div className="wo-l">{t("Other information")}</div>{j.notes ? <div style={{ whiteSpace: "pre-wrap" }}>{j.notes}</div> : <span className="muted">{t("Nothing added.")}</span>}</div>
        </div>
        <div className="wo-l" style={{ marginTop: 14 }}>{t("Files")}</div>
        <JobFiles jobId={j.id} files={j.files} me={me} canRemoveAll={scheduler} onChange={reload} />
      </section>

      <WorkbookPanel job={j} me={me} onFiles={reload} />

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
                <Link to={`/work-orders/${w.id}`} className="mono wo-num">{w.job_number}</Link>
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

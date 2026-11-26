// Aaron's original Field Service Workbook, unchanged, inside each job's Work order tab (Aaron, 2026-11-25:
// "put the timesheet and service report all back the way it was built ... only add to it").
// The workbook itself is web/public/field-service-workbook.html and works exactly as it did: Service
// Report, Time Sheet and Guidance tabs, saved on this device, PDF and Excel downloads.
// What the portal adds around it: the frame, a button that copies this job's details into the empty
// Job details boxes, opening it in its own window, and the job chat.
import { useRef, useState } from "react";
import { api, can, type Me } from "../api";
import { PageHead, toast, useLoad } from "../components/ui";
import { JobListTabs } from "./Jobs";
import { t } from "../i18n";
import { navigate } from "../router";

const PAGE = "/field-service-workbook";

/** Job details box in the workbook (its ids are "job-<key>") and what the job holds for it. */
function detailsFor(job: any): [string, string][] {
  const contact = [job.contact_name, job.contact_phone, job.contact_email].filter(Boolean).join(", ");
  return [["job", job.job_number ?? ""], ["customer", job.customer ?? ""], ["location", (job.location ?? "").split("\n").join(", ")], ["contact", contact], ["serial", job.machine ?? ""]];
}

/** The Jobs list's Work order tab: the workbook on its own, without a job. */
export function WorkbookPage({ me }: { me: Me }) {
  return (
    <>
      <PageHead title={t("Jobs")} />
      <JobListTabs me={me} on="workbook" />
      <FieldServiceWorkbook job={null} me={me} />
    </>
  );
}

export function FieldServiceWorkbook({ job, me }: { job: any | null; me: Me }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [note, setNote] = useState("");
  const { data } = useLoad(() => (job ? api(`/workbook/${encodeURIComponent(job.id)}`) : Promise.resolve(null)), [job?.id]);

  function fill() {
    if (!job) return;
    const doc = frame.current?.contentDocument;
    const win = frame.current?.contentWindow as (Window & typeof globalThis) | null;
    const box = (k: string) => doc?.getElementById(`job-${k}`) as HTMLInputElement | null;
    if (!doc || !win || !box("job")) return setNote(t("The workbook is still opening. Try again in a moment."));
    // Open the Service Report tab so the Job details boxes are there to fill.
    (doc.getElementById("tab-sr") as HTMLButtonElement | null)?.click();
    const current = box("job")!.value.trim();
    if (current && current !== job.job_number) {
      return setNote(t("The workbook on this device has job {other} open. If you still need it, download it first. Then press Start new report and fill in this job.", { other: current }));
    }
    let filled = 0;
    for (const [k, v] of detailsFor(job)) {
      const el = box(k);
      if (!el || !v || el.value.trim()) continue; // never overwrite what was typed
      el.value = v;
      el.dispatchEvent(new win.Event("input", { bubbles: true }));
      filled++;
    }
    setNote(filled ? t("Filled in {n} job details. Everything else is as you left it.", { n: filled }) : t("The job details were already filled in."));
  }

  async function chat() {
    try {
      const c = await api(`/workbook/${encodeURIComponent(job!.id)}/chat`, { body: {} });
      navigate(`/chats/${c.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <section className="stack">
      <div className="panel row no-print">
        <div>
          <h2 style={{ margin: 0 }}>{t("Field Service Workbook")}</h2>
          <p className="muted" style={{ margin: 0 }}>{note || t("Service report and time sheet. It saves on this device; download the PDF or Excel when you're done.")}</p>
        </div>
        <span className="spacer" />
        {job && <button className="btn" onClick={fill}>{t("Fill in this job's details")}</button>}
        {job && can(me, "boards.use") && data?.canFill && <button className="btn" onClick={chat}>{data.chat ? t("Open the job chat") : t("Start the job chat")}</button>}
        <a className="btn" href={PAGE} target="_blank" rel="noopener">{t("Open in its own window")}</a>
      </div>
      <iframe ref={frame} src={PAGE} title={t("Field Service Workbook")} className="no-print" style={{ width: "100%", height: "85vh", border: 0, borderRadius: 8, background: "#fff" }} />
    </section>
  );
}

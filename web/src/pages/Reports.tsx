// Time sheets and reports (/reports): the field service engineers' time sheets and service reports from every
// job, for the people who approve them (reports.review). Queues for waiting for review, sent back, approved
// and in progress; filters by engineer, job and week; approve or send back with a note; hours as CSV.
// Server: src/portal/routes/reports.ts. Part of the Ronchi workbook: gone when the workbook is switched off.
import { useState } from "react";
import { api, can, fmtDate, type Me } from "../api";
import { Empty, ErrorNote, Link, PageHead, toast, useLoad } from "../components/ui";
import { loc, t } from "../i18n";
import { navigate } from "../router";
import { fmtHours, weekOf, type DocStatus } from "../../../src/shared/reports";
import { DocStatusPill, setWorkOrderTarget } from "./Workbook";

const QUEUES: { id: DocStatus; label: string }[] = [
  { id: "sent", label: "Waiting for review" },
  { id: "returned", label: "Sent back" },
  { id: "approved", label: "Approved" },
  { id: "draft", label: "In progress" },
];

export function Reports({ me, path: _path }: { me: Me; path: string }) {
  const [status, setStatus] = useState<DocStatus>("sent");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [day, setDay] = useState("");
  const [kind, setKind] = useState("");
  const week = day ? weekOf(day) : "";
  const params = new URLSearchParams({ status, ...(who ? { user: who } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(week ? { week } : {}), ...(kind ? { kind } : {}) });
  const { data, error, reload } = useLoad<any>(() => api(`/reports/queue?${params}`), [params.toString()]);
  const [returning, setReturning] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function step(item: any, action: "approve" | "return") {
    setBusy(true);
    try {
      await api(`/reports/${item.kind === "sheet" ? "sheets" : "service"}/${encodeURIComponent(item.id)}/${action}`, { body: action === "return" ? { note } : {} });
      toast(action === "approve" ? t("Approved") : t("Sent back"));
      setReturning(null);
      setNote("");
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    const p = new URLSearchParams(params);
    p.delete("kind");
    try {
      const res = await fetch(`/api/reports/export?${p}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `Ronchi hours${week ? ` week of ${week}` : ""}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  function open(item: any) {
    setWorkOrderTarget({ who: item.user_id, tab: item.kind === "sheet" ? "sheet" : "report" });
    navigate(`/work-orders/${item.job_id}`);
  }

  if (!can(me, "reports.review")) return <><PageHead title={t("Time sheets and reports")} /><ErrorNote error="Your role doesn't allow this." /></>;
  const items: any[] = data?.items ?? [];
  const filtered = !!(who || q || day || kind);

  return (
    <>
      <PageHead title={t("Time sheets and reports")} sub={t("The field service engineers' time sheets and service reports from every job. Approve them, or send them back with a note.")} tip="reports-review">
        <button className="btn" onClick={exportCsv}>{t("Download hours (CSV)")}</button>
      </PageHead>

      <div className="wb-tabs" role="tablist" aria-label={t("Time sheets and reports")}>
        {QUEUES.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={status === x.id} className={status === x.id ? "on" : ""} onClick={() => setStatus(x.id)}>
            {t(x.label)}{data?.counts?.[x.id] ? <span className="wb-count">{data.counts[x.id]}</span> : null}
          </button>
        ))}
      </div>

      <div className="panel rp-filters">
        <label className="field"><span className="wb-l">{t("Field service engineer")}</span>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{t("Everyone")}</option>
            {(data?.people ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field"><span className="wb-l">{t("Job")}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Job number, customer or machine")} />
        </label>
        <label className="field"><span className="wb-l">{week ? t("Week of {day}", { day: fmtDate(week) }) : t("Week")}</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="field"><span className="wb-l">{t("Paperwork")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("Time sheets and reports")}</option>
            <option value="sheet">{t("Time sheets")}</option>
            <option value="service">{t("Service reports")}</option>
          </select>
        </label>
        {filtered && <button className="btn small rp-clear" onClick={() => { setWho(""); setQ(""); setDay(""); setKind(""); }}>{t("Clear filters")}</button>}
      </div>

      <ErrorNote error={error} />
      <section className="panel">
        {data && !items.length && <Empty>{filtered ? t("Nothing matches these filters.") : status === "sent" ? t("Nothing is waiting for review.") : t("Nothing here.")}</Empty>}
        {items.length > 0 && (
          <table className="rp-table">
            <thead>
              <tr><th>{t("Paperwork")}</th><th>{t("Field service engineer")}</th><th>{t("Job")}</th><th>{t("Dates")}</th><th className="num">{t("Work hours")}</th><th className="num">{t("Billable")}</th><th>{t("Status")}</th><th aria-label={t("Actions")} /></tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <Row key={x.kind + x.id} x={x} me={me} returning={returning === x.id} busy={busy} note={note} setNote={setNote}
                  onOpen={() => open(x)} onApprove={() => step(x, "approve")} onReturn={() => { setReturning(returning === x.id ? null : x.id); setNote(""); }} onConfirmReturn={() => step(x, "return")} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Row({ x, me, returning, busy, note, setNote, onOpen, onApprove, onReturn, onConfirmReturn }: {
  x: any; me: Me; returning: boolean; busy: boolean; note: string; setNote: (s: string) => void;
  onOpen: () => void; onApprove: () => void; onReturn: () => void; onConfirmReturn: () => void;
}) {
  const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(loc(), { month: "short", day: "numeric" });
  const dates = x.dates?.[0] ? (x.dates[1] && x.dates[1] !== x.dates[0] ? `${short(x.dates[0])} – ${short(x.dates[1])}` : short(x.dates[0])) : "–";
  const when = x.sent_at ?? x.updated_at;
  return (
    <>
      <tr>
        <td data-l={t("Paperwork")}><b>{x.kind === "sheet" ? t("Time sheet") : t("Service report")}</b></td>
        <td data-l={t("Field service engineer")}>{x.user_name}</td>
        <td data-l={t("Job")}><div className="rp-cell">
          <Link to={`/work-orders/${x.job_id}`} className="mono">{x.job_number}</Link>
          <div className="muted rp-sub">{[x.customer, x.machine].filter(Boolean).join(" · ")}</div>
        </div></td>
        <td data-l={t("Dates")} className="rp-dates">{dates}</td>
        <td data-l={t("Work hours")} className="num">{x.hours ? fmtHours(x.hours.work) : "–"}</td>
        <td data-l={t("Billable")} className="num">{x.hours ? fmtHours(x.hours.billable) : "–"}</td>
        <td data-l={t("Status")}><div className="rp-cell">
          <DocStatusPill status={x.status} />
          <div className="muted rp-sub">{new Date(when).toLocaleDateString(loc(), { month: "short", day: "numeric" })}{x.reviewer_name && x.status !== "sent" ? ` · ${x.reviewer_name}` : ""}</div>
          {x.status === "returned" && x.review_note && <div className="rp-note">{x.review_note}</div>}
        </div></td>
        <td className="rp-actions">
          <button className="btn small" onClick={onOpen}>{t("Review")}</button>
          {x.status === "sent" && x.user_id !== me.id && <button className="btn small primary" disabled={busy} onClick={onApprove}>{t("Approve")}</button>}
          {(x.status === "sent" || x.status === "approved") && <button className="btn small" onClick={onReturn}>{t("Send back")}</button>}
        </td>
      </tr>
      {returning && (
        <tr className="rp-returnrow">
          <td colSpan={8}>
            <form className="wb-sendback" onSubmit={(e) => { e.preventDefault(); onConfirmReturn(); }}>
              <label className="field">
                <span className="wb-l">{t("Note for {name}", { name: x.user_name })}</span>
                <textarea autoFocus value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={t("Say what needs to change.")} />
              </label>
              <div className="row">
                <button className="btn primary" disabled={busy || !note.trim()}>{t("Send back")}</button>
                <button type="button" className="btn" onClick={onReturn}>{t("Cancel")}</button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

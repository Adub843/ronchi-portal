// Lola's hours view: everyone's days, time changes to approve, and exports.
import { useState } from "react";
import { api, can, fmtDate, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, PageHead, toast, useLoad } from "../components/ui";
import { DEMO } from "../router";

/** Only a YYYY-MM-DD date ever goes into the export link. */
function isoOnly(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function Hours({ me }: { me: Me }) {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 13 * 86400000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const hours = useLoad(() => api(`/clock/hours?from=${from}&to=${to}`), [from, to]);
  const edits = useLoad(() => (can(me, "hours.approve") ? api("/clock/edits") : Promise.resolve({ edits: [] })));

  async function decide(id: string, approve: boolean) {
    try {
      await api(`/clock/edits/${id}/decide`, { body: { approve } });
      toast(approve ? "Approved" : "Declined");
      edits.reload();
      hours.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const exportUrl = (kind: string, format: string) =>
    `/api/clock/hours/export?${new URLSearchParams({ from: isoOnly(from), to: isoOnly(to), kind, format }).toString()}`;
  const byPunch = new Map<string, any>((hours.data?.punches ?? []).map((p: any) => [p.id, p]));

  return (
    <>
      <PageHead title="Hours" sub="Everyone's time, from the time clock.">
        <div className="field"><label htmlFor="hf">From</label><input id="hf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label htmlFor="ht">To</label><input id="ht" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </PageHead>
      {can(me, "hours.approve") && (
        <div className="panel">
          <h2>Time changes to approve</h2>
          {edits.data && !edits.data.edits.length && <Empty>Nothing waiting.</Empty>}
          {edits.data?.edits.map((e: any) => (
            <div key={e.id} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <b>{e.requested_by_name}</b> · clock {e.kind} · {fmtTime(e.old_at)} → <b>{fmtTime(e.new_at)}</b>
                <div className="muted">{e.reason}</div>
              </div>
              {e.requested_by === me.id ? (
                <span className="muted">Needs another approver</span>
              ) : (
                <>
                  <button className="btn small primary" onClick={() => decide(e.id, true)}>Approve</button>
                  <button className="btn small" onClick={() => decide(e.id, false)}>Decline</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <ErrorNote error={hours.error} />
      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Days</h2>
          <span className="spacer" />
          {can(me, "hours.export") && (
            <>
              {([["days", "csv", "Days, Excel (CSV)"], ["punches", "csv", "Every punch, Excel (CSV)"], ["days", "json", "JSON"]] as const).map(([k, f, label]) =>
                DEMO ? (
                  <button key={label} className="btn small" onClick={() => toast("In the live portal this downloads the file. Downloads are off in this preview.")}>{label}</button>
                ) : (
                  <a key={label} className="btn small" href={exportUrl(k, f)}>{label}</a>
                ),
              )}
            </>
          )}
        </div>
        {hours.data && !hours.data.days.length && <Empty>No hours in this range.</Empty>}
        {!!hours.data?.days.length && (
          <div className="tbl">
            <table>
              <thead><tr><th>Name</th><th>Day</th><th>Hours</th><th>Regular</th><th>Overtime</th><th>Location</th></tr></thead>
              <tbody>
                {[...hours.data.days].sort((a: any, b: any) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name)).map((d: any) => {
                  const shifts = hours.data.shifts.filter((s: any) => s.userId === d.userId && s.day === d.day);
                  const typed = shifts.some((s: any) => byPunch.get(s.inId)?.location_source === "typed" || byPunch.get(s.outId)?.location_source === "typed");
                  const none = shifts.some((s: any) => byPunch.get(s.inId)?.location_source === "none");
                  return (
                    <tr key={`${d.userId}-${d.day}`}>
                      <td>{d.name}</td>
                      <td>{fmtDate(d.day)}{d.open && <span className="pill p-ok" style={{ marginLeft: 6 }}>still in</span>}</td>
                      <td className="mono">{d.hours.toFixed(2)}</td>
                      <td className="mono">{d.regular.toFixed(2)}</td>
                      <td className="mono">{d.overtime ? d.overtime.toFixed(2) : "–"}</td>
                      <td>{typed ? <span className="pill p-warn">entered by hand</span> : none ? <span className="pill p-acc">no location</span> : <span className="pill p-ok">phone</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

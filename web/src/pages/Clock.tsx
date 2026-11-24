// Clock in and out. Location is read only at the moment of the tap.
import { useEffect, useState } from "react";
import { api, fmtDate, fmtTime, type Me } from "../api";
import { Empty, ErrorNote, PageHead, toast, useLoad } from "../components/ui";

function getLocation(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

export function Clock({ me }: { me: Me }) {
  const status = useLoad(() => api("/clock/status"));
  const mine = useLoad(() => api("/clock/mine"));
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // "out", "working" or "on_break", worked out by the server from the latest punch.
  const state: "out" | "working" | "on_break" = status.data?.state ?? "out";
  const clockedIn = state !== "out";
  // Typed-address mode is saved on the server and stays on until turned off with the button.
  const addressMode: boolean = !!status.data?.addressMode;

  async function setMode(on: boolean) {
    setError(null);
    try {
      await api("/clock/address-mode", { method: "PUT", body: on ? { on: true, address } : { on: false } });
      setTyping(false);
      status.reload();
      toast(on ? "Typed address is on. Your phone's location won't be read." : "Typed address is off. Phone location is used again.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function punch(kind: "in" | "out" | "break_start" | "break_end") {
    setBusy(true);
    setError(null);
    try {
      let body: Record<string, unknown> = { kind };
      // HARD RULE: in typed-address mode the phone's location is never requested or read.
      if (!addressMode) {
        const pos = await getLocation();
        if (pos) body = { ...body, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      }
      const r = await api("/clock/punch", { body });
      const what = { in: "Clocked in", out: "Clocked out", break_start: "Break started", break_end: "Back from break" }[r.kind as string] ?? "Saved";
      toast(`${what} at ${new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${r.location === "none" ? " (no location)" : ""}`);
      status.reload();
      mine.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestEdit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/clock/punches/${encodeURIComponent(editing.id)}/edit`, { body: { newAt: new Date(editing.newAt).toISOString(), reason: editing.reason } });
      toast("Sent to Lola for approval");
      setEditing(null);
      mine.reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }

  return (
    <>
      <PageHead title="Time clock" sub="The time recorded is the portal's clock, not your phone's." />
      <div className="grid g2">
        <div className="panel clock">
          <div className="time">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</div>
          <span className={`pill ${state === "working" ? "p-ok" : state === "on_break" ? "p-warn" : "p-info"}`}>
            {state === "working" ? `Clocked in since ${fmtTime(status.data.shiftStart ?? status.data.last.at)}` : state === "on_break" ? `On break since ${fmtTime(status.data.last.at)}. The clock is stopped.` : "Clocked out"}
          </span>
          {state === "out" && (
            <button className="big" onClick={() => punch("in")} disabled={busy || !status.data}>{busy ? "Saving…" : "Clock in"}</button>
          )}
          {state === "working" && (
            <div className="clock-actions">
              <button className="big brk" onClick={() => punch("break_start")} disabled={busy}>{busy ? "Saving…" : "Start break"}</button>
              <button className="btn out-btn" onClick={() => punch("out")} disabled={busy}>Clock out</button>
            </div>
          )}
          {state === "on_break" && (
            <div className="clock-actions">
              <button className="big" onClick={() => punch("break_end")} disabled={busy}>{busy ? "Saving…" : "End break"}</button>
              <button className="btn out-btn" onClick={() => punch("out")} disabled={busy}>Clock out</button>
            </div>
          )}
          {addressMode ? (
            <>
              <p className="locnote">
                <span className="pill p-warn">Typed address</span> Your location shows as <b>{status.data.typedAddress}</b>.
                Your phone's location is not read or tracked until you turn this off.
              </p>
              <button className="btn" onClick={() => setMode(false)}>Turn off typed address</button>
            </>
          ) : (
            <>
              <p className="locnote">Your location is recorded only at the moment you tap a clock button, never in between.</p>
              {me.canTypeAddress && !typing && <button className="btn" onClick={() => setTyping(true)}>Type the address instead</button>}
              {me.canTypeAddress && typing && (
                <form className="stack" style={{ width: "100%", maxWidth: 340 }} onSubmit={(e) => { e.preventDefault(); setMode(true); }}>
                  <input id="typed-address" className="panel" style={{ padding: "10px 12px", font: "inherit" }} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address or site" maxLength={300} aria-label="Address" required autoFocus />
                  <div className="row" style={{ justifyContent: "center" }}>
                    <button className="btn primary" type="submit">Use this address</button>
                    <button className="btn" type="button" onClick={() => setTyping(false)}>Cancel</button>
                  </div>
                  <span className="muted">Stays on until you turn it off. Shows as “entered by hand” in the hours view.</span>
                </form>
              )}
            </>
          )}
          <ErrorNote error={error} />
        </div>
        <div className="panel">
          <h2>Last two weeks</h2>
          {mine.data && !mine.data.days.length && <Empty>No hours yet.</Empty>}
          {!!mine.data?.days.length && (
            <table>
              <thead><tr><th>Day</th><th>Worked</th><th>Breaks</th><th>Overtime</th></tr></thead>
              <tbody>
                {[...mine.data.days].reverse().map((d: any) => (
                  <tr key={d.day}><td>{fmtDate(d.day)}{d.open && <span className="pill p-ok" style={{ marginLeft: 6 }}>open</span>}</td><td className="mono">{d.hours.toFixed(2)}</td><td className="mono">{d.breakHours ? d.breakHours.toFixed(2) : "–"}</td><td className="mono">{d.overtime ? d.overtime.toFixed(2) : "–"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="panel">
        <h2>My punches</h2>
        <p className="muted">Wrong time? Ask for a change. Lola approves it and the original time is kept on record.</p>
        <div className="tbl">
          <table>
            <thead><tr><th>Time</th><th>Punch</th><th>Location</th><th /></tr></thead>
            <tbody>
              {[...(mine.data?.punches ?? [])].reverse().slice(0, 12).map((p: any) => (
                <tr key={p.id}>
                  <td>{fmtTime(p.at)}</td>
                  <td>{PUNCH_LABEL[p.kind] ?? p.kind}</td>
                  <td className="muted">{p.location_source === "typed" ? `Entered by hand: ${p.address}` : p.location_source === "gps" ? "Phone location" : "None"}</td>
                  <td><button className="linkish" onClick={() => setEditing({ id: p.id, newAt: toLocalInput(p.at), reason: "" })}>Ask for a change</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editing && (
          <form className="stack" onSubmit={requestEdit} style={{ marginTop: 12 }}>
            <div className="grid g2">
              <div className="field"><label htmlFor="na">Correct time</label><input id="na" type="datetime-local" value={editing.newAt} onChange={(e) => setEditing({ ...editing, newAt: e.target.value })} required /></div>
              <div className="field"><label htmlFor="rs">Reason</label><input id="rs" value={editing.reason} onChange={(e) => setEditing({ ...editing, reason: e.target.value })} maxLength={300} required /></div>
            </div>
            <div className="row"><button className="btn primary" type="submit">Send for approval</button><button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
          </form>
        )}
        {!!mine.data?.edits.length && (
          <p className="muted">Waiting for approval: {mine.data.edits.filter((e: any) => e.status === "pending").length}</p>
        )}
      </div>
    </>
  );
}

const PUNCH_LABEL: Record<string, string> = { in: "In", out: "Out", break_start: "Break start", break_end: "Break end" };

/** ISO time -> the value a datetime-local box expects, in the phone's own time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

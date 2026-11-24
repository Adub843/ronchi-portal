// Paolo's page: invite people, set roles, and cut off access.
import { useState } from "react";
import { api, fmtTime, type Me } from "../api";
import { ErrorNote, PageHead, toast, useLoad } from "../components/ui";

export function People({ me }: { me: Me }) {
  const { data, error, reload } = useLoad(() => api("/users"));
  const roles = useLoad(() => api("/users/roles"));
  const audit = useLoad(() => api("/users/audit/recent"));
  const [form, setForm] = useState({ name: "", email: "", role: "tech", canTypeAddress: false });
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api("/users/invite", { body: form });
      setLink(r.link);
      setForm({ name: "", email: "", role: "tech", canTypeAddress: false });
      reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  async function update(id: string, body: Record<string, unknown>) {
    try {
      await api(`/users/${id}`, { method: "PATCH", body });
      toast("Saved. They've been signed out so the change applies right away.");
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  async function signOutAll(id: string) {
    try {
      const r = await api(`/users/${id}/sign-out-everywhere`, { body: {} });
      toast(`Signed out of ${r.sessions} device(s)`);
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }

  const roleNames: Record<string, string> = roles.data?.roles ?? {};

  return (
    <>
      <PageHead title="People" sub="Invite staff, set what they can see, and cut off access." />
      <form className="panel grid g2" onSubmit={invite}>
        <div className="field"><label htmlFor="pn">Full name</label><input id="pn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} /></div>
        <div className="field"><label htmlFor="pe">Work email</label><input id="pe" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div className="field">
          <label htmlFor="pr">Role</label>
          <select id="pr" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(roleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <label className="row" style={{ gap: 6, alignSelf: "end" }}>
          <input type="checkbox" checked={form.canTypeAddress} onChange={(e) => setForm({ ...form, canTypeAddress: e.target.checked })} /> May type an address at clock in/out
        </label>
        <ErrorNote error={err} />
        <div><button className="btn primary" type="submit">Create invite link</button></div>
      </form>
      {link && (
        <div className="panel stack">
          <b>Invite link (shown once, works for 3 days)</b>
          <code className="mono" style={{ overflowWrap: "anywhere" }}>{link}</code>
          <div className="row">
            <button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Copied"))}>Copy</button>
            <button className="btn" onClick={() => setLink(null)}>Done</button>
          </div>
          <span className="muted">Send it to them directly (Teams or text). Anyone with the link can create this login, so don't post it anywhere public.</span>
        </div>
      )}
      <ErrorNote error={error} />
      <div className="panel tbl">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Devices</th><th>Typed address</th><th /></tr></thead>
          <tbody>
            {data?.users.map((u: any) => (
              <tr key={u.id}>
                <td><b>{u.name}</b><div className="muted">{u.email}</div></td>
                <td>
                  <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })} disabled={u.id === me.id} aria-label={`Role for ${u.name}`}>
                    {Object.entries(roleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td><span className={`pill ${u.status === "active" ? "p-ok" : "p-acc"}`}>{u.status}</span></td>
                <td className="muted">{u.passkeys} passkey(s), {u.sessions} signed in</td>
                <td><input type="checkbox" checked={!!u.can_type_address} onChange={(e) => update(u.id, { canTypeAddress: e.target.checked })} aria-label={`Typed address for ${u.name}`} /></td>
                <td className="row" style={{ gap: 6 }}>
                  <button className="btn small" onClick={() => signOutAll(u.id)}>Sign out everywhere</button>
                  {u.id !== me.id && (
                    <button className="btn small danger" onClick={() => update(u.id, { status: u.status === "active" ? "disabled" : "active" })}>{u.status === "active" ? "Disable" : "Re-enable"}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!!data?.invites.length && (
          <>
            <h2 style={{ marginTop: 16 }}>Invites not used yet</h2>
            {data.invites.map((i: any) => (
              <div key={i.id} className="row" style={{ padding: "4px 0" }}>
                <span>{i.name} ({i.email}), expires {fmtTime(i.expires_at)}</span>
                <button className="linkish" onClick={async () => { await api(`/users/invites/${i.id}`, { method: "DELETE" }); reload(); }}>Cancel</button>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="panel tbl">
        <h2>Recent activity (audit log)</h2>
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>From</th></tr></thead>
          <tbody>
            {audit.data?.entries.slice(0, 50).map((a: any, i: number) => (
              <tr key={i}><td>{fmtTime(a.at)}</td><td>{a.who ?? "–"}</td><td className="mono">{a.action}</td><td className="mono muted">{a.ip}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

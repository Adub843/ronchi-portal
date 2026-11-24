// Paolo's page: invite people, set roles, and cut off access.
import { useState } from "react";
import { api, fmtTime, type Me } from "../api";
import { t } from "../i18n";
import { ErrorNote, PageHead, toast, useLoad } from "../components/ui";

export function People({ me }: { me: Me }) {
  const { data, error, reload } = useLoad(() => api("/users"));
  const roles = useLoad(() => api("/users/roles"));
  const audit = useLoad(() => api("/users/audit/recent"));
  const [form, setForm] = useState({ name: "", email: "", role: "tech" });
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api("/users/invite", { body: form });
      setLink(r.link);
      setForm({ name: "", email: "", role: "tech" });
      reload();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  async function update(id: string, body: Record<string, unknown>) {
    try {
      await api(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body });
      toast(t("Saved. They've been signed out so the change applies right away."));
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  async function signOutAll(id: string) {
    try {
      const r = await api(`/users/${encodeURIComponent(id)}/sign-out-everywhere`, { body: {} });
      toast(t("Signed out of {n} device(s)", { n: r.sessions }));
      reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }

  const roleNames: Record<string, string> = roles.data?.roles ?? {};

  return (
    <>
      <PageHead title={t("People")} sub={t("Invite staff, set what they can see, and cut off access.")} />
      <form className="panel grid g2" onSubmit={invite}>
        <div className="field"><label htmlFor="pn">{t("Full name")}</label><input id="pn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} /></div>
        <div className="field"><label htmlFor="pe">{t("Work email")}</label><input id="pe" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div className="field">
          <label htmlFor="pr">{t("Role")}</label>
          <select id="pr" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(roleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <ErrorNote error={err} />
        <div><button className="btn primary" type="submit">{t("Create invite link")}</button></div>
      </form>
      {link && (
        <div className="panel stack">
          <b>{t("Invite link (shown once, works for 3 days)")}</b>
          <code className="mono" style={{ overflowWrap: "anywhere" }}>{link}</code>
          <div className="row">
            <button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast(t("Copied")))}>{t("Copy")}</button>
            <button className="btn" onClick={() => setLink(null)}>{t("Done")}</button>
          </div>
          <span className="muted">{t("Send it to them directly (Teams or text). Anyone with the link can create this login, so don't post it anywhere public.")}</span>
        </div>
      )}
      <ErrorNote error={error} />
      <div className="panel tbl">
        <table>
          <thead><tr><th>{t("Name")}</th><th>{t("Role")}</th><th>{t("Status")}</th><th>{t("Devices")}</th><th /></tr></thead>
          <tbody>
            {data?.users.map((u: any) => (
              <tr key={u.id}>
                <td><b>{u.name}</b><div className="muted">{u.email}</div></td>
                <td>
                  <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })} disabled={u.id === me.id} aria-label={t("Role for {name}", { name: u.name })}>
                    {Object.entries(roleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td><span className={`pill ${u.status === "active" ? "p-ok" : "p-acc"}`}>{u.status === "active" ? t("active") : t("disabled")}</span></td>
                <td className="muted">{t("{p} passkey(s), {s} signed in", { p: u.passkeys, s: u.sessions })}</td>
                <td className="row" style={{ gap: 6 }}>
                  <button className="btn small" onClick={() => signOutAll(u.id)}>{t("Sign out everywhere")}</button>
                  {u.id !== me.id && (
                    <button className="btn small danger" onClick={() => update(u.id, { status: u.status === "active" ? "disabled" : "active" })}>{u.status === "active" ? t("Disable") : t("Re-enable")}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!!data?.invites.length && (
          <>
            <h2 style={{ marginTop: 16 }}>{t("Invites not used yet")}</h2>
            {data.invites.map((i: any) => (
              <div key={i.id} className="row" style={{ padding: "4px 0" }}>
                <span>{t("{name} ({email}), expires {when}", { name: i.name, email: i.email, when: fmtTime(i.expires_at) })}</span>
                <button className="linkish" onClick={async () => { await api(`/users/invites/${encodeURIComponent(i.id)}`, { method: "DELETE" }); reload(); }}>{t("Cancel")}</button>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="panel tbl">
        <h2 id="audit">{t("Recent activity (audit log)")}</h2>
        <table>
          <thead><tr><th>{t("When")}</th><th>{t("Who")}</th><th>{t("What")}</th><th>{t("From")}</th></tr></thead>
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

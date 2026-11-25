// Paolo's page: invite people, set roles, and cut off access.
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, fmtTime, type Me } from "../api";
import { t } from "../i18n";
import { ErrorNote, PageHead, toast, useLoad } from "../components/ui";

export function People({ me }: { me: Me }) {
  const { data, error, reload } = useLoad(() => api("/users"));
  const roles = useLoad(() => api("/users/roles"));
  const audit = useLoad(() => api("/users/audit/recent"));
  // The starting role, link lifetime and pause switch are admin controls in Settings.
  const people = me.settings?.people;
  const startRole: string = people?.defaultRole ?? "tech";
  const permList = useLoad(() => api("/users/permissions"));
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: startRole });
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api("/users/invite", { body: form });
      setLink(r.link);
      setForm({ name: "", email: "", role: startRole });
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
        <div className="field"><label htmlFor="pe">{t("Work email or username")}</label><input id="pe" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div className="field">
          <label htmlFor="pr">{t("Role")}</label>
          <select id="pr" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(roleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <ErrorNote error={err} />
        {people?.invitesPaused && <p className="note-inline">{t("New invites are paused. Turn them back on in Settings > Admin controls.")}</p>}
        <div><button className="btn primary" type="submit" disabled={people?.invitesPaused}>{t("Create invite link")}</button></div>
      </form>
      {link && (
        <div className="panel stack">
          <b>{(people?.inviteHours ?? 72) % 24 === 0 ? t("Invite link (shown once, works for {n} day(s))", { n: (people?.inviteHours ?? 72) / 24 }) : t("Invite link (shown once, works for {n} hour(s))", { n: people?.inviteHours ?? 72 })}</b>
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
            {data?.users.map((u: any) => {
              const changed = Object.keys(u.access ?? {}).length;
              const adjustable = u.role !== "admin" && u.id !== me.id;
              return (
              <Fragment key={u.id}>
              <tr>
                <td><b>{u.name}</b><div className="muted">{u.email}</div></td>
                <td>
                  <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })} disabled={u.id === me.id} aria-label={t("Role for {name}", { name: u.name })}>
                    {Object.entries(roleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {changed > 0 && <div className="access-note">{changed === 1 ? t("1 change from the role") : t("{n} changes from the role", { n: changed })}</div>}
                </td>
                <td><span className={`pill ${u.status === "active" ? "p-ok" : "p-acc"}`}>{u.status === "active" ? t("active") : t("disabled")}</span></td>
                <td className="muted">{t("{p} passkey(s), {s} signed in", { p: u.passkeys, s: u.sessions })}</td>
                <td className="row" style={{ gap: 6 }}>
                  {adjustable && <button className={`btn small${open === u.id ? " on" : ""}`} aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)}>{t("Access")}</button>}
                  <button className="btn small" onClick={() => signOutAll(u.id)}>{t("Sign out everywhere")}</button>
                  {u.id !== me.id && (
                    <button className="btn small danger" onClick={() => update(u.id, { status: u.status === "active" ? "disabled" : "active" })}>{u.status === "active" ? t("Disable") : t("Re-enable")}</button>
                  )}
                </td>
              </tr>
              {open === u.id && permList.data && (
                <tr className="access-row"><td colSpan={5}><Access person={u} roleName={roleNames[u.role] ?? u.role} list={permList.data} onSaved={reload} onClose={() => setOpen(null)} /></td></tr>
              )}
              </Fragment>
              );
            })}
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

type PermList = { groups: { group: string; perms: { id: string; label: string; hint: string; adjustable: boolean; view: boolean }[] }[]; byRole: Record<string, string[]> };

/** Switch single permissions on or off for one person, on top of their role. */
function Access({ person, roleName, list, onSaved, onClose }: { person: any; roleName: string; list: PermList; onSaved: () => void; onClose: () => void }) {
  const [changes, setChanges] = useState<Record<string, boolean>>(person.access ?? {});
  const [busy, setBusy] = useState(false);
  const fromRole = new Set(list.byRole[person.role] ?? []);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await api(`/users/${encodeURIComponent(person.id)}/access`, { method: "PUT", body });
      setChanges(r.changes);
      onSaved();
    } catch (x) {
      toast((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const set = (perm: string, value: boolean | null) => save({ changes: { [perm]: value } });
  const count = Object.keys(changes).length;
  // View only: switch off everything that adds, changes or removes; keep the pages they can see.
  const viewOnly = () => {
    const off: Record<string, boolean | null> = {};
    for (const g of list.groups) for (const p of g.perms) {
      if (!p.adjustable) continue;
      const on = changes[p.id] ?? fromRole.has(p.id);
      if (!p.view && on) off[p.id] = fromRole.has(p.id) ? false : null;
    }
    if (Object.keys(off).length) save({ changes: off });
  };
  const phone = usePhone();
  useEffect(() => {
    if (!phone) return;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc);
    return () => { document.body.style.overflow = was; removeEventListener("keydown", esc); };
  }, [phone, onClose]);

  const panel = (
    <div className={`access${phone ? " sheet" : ""}`} role={phone ? "dialog" : undefined} aria-modal={phone || undefined} aria-label={t("What {name} can do", { name: person.name })}>
      <div className="access-head">
        <div>
          <b>{t("What {name} can do", { name: person.name })}</b>
          <div className="muted">{t("Starts from the role {role}. Switch anything on or off for this person only. It applies on their next click.", { role: roleName })}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" disabled={busy} onClick={viewOnly}>{t("View only")}</button>
          {count > 0 && <button className="btn small" disabled={busy} onClick={() => save({ reset: true })}>{t("Back to the role")}</button>}
          <button className="btn small" onClick={onClose}>{t("Done")}</button>
        </div>
      </div>
      <div className="access-groups">
        {list.groups.map((g) => (
          <section key={g.group} className="access-group">
            <h3>{t(g.group)}</h3>
            {g.perms.map((p) => {
              const own = changes[p.id];
              const role = fromRole.has(p.id);
              const on = own ?? role;
              return (
                <div key={p.id} className={`access-perm${own !== undefined ? " changed" : ""}`}>
                  <span className={`access-dot${on ? " on" : ""}`} aria-hidden="true" />
                  <div className="access-text">
                    <span>{t(p.label)}</span>
                    <small className="muted">{t(p.hint)}</small>
                  </div>
                  {p.adjustable ? (
                    <div className="seg" role="radiogroup" aria-label={t(p.label)}>
                      <button type="button" role="radio" aria-checked={own === undefined} disabled={busy} className={own === undefined ? "on" : ""} onClick={() => set(p.id, null)}>
                        {role ? t("Role: on") : t("Role: off")}
                      </button>
                      <button type="button" role="radio" aria-checked={own === true} disabled={busy} className={own === true ? "on" : ""} onClick={() => set(p.id, true)}>{t("On")}</button>
                      <button type="button" role="radio" aria-checked={own === false} disabled={busy} className={own === false ? "on" : ""} onClick={() => set(p.id, false)}>{t("Off")}</button>
                    </div>
                  ) : (
                    <span className="access-lock">{t("Admins only")}</span>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
  return phone ? createPortal(panel, document.body) : panel;
}

/** True on phone-width screens, where the people table scrolls sideways. */
function usePhone(): boolean {
  const q = "(max-width: 700px)";
  const [on, setOn] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

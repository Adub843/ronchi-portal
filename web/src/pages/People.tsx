// Aaron's page: add and remove employees, make roles, set what each person can do, cut off access.
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, fmtTime, type Me } from "../api";
import { t } from "../i18n";
import { ErrorNote, PageHead, toast, useLoad } from "../components/ui";
import { refreshRoleNames, roleDisplayName } from "../roles";

export function People({ me }: { me: Me }) {
  const { data, error, reload } = useLoad(() => api("/users"));
  const roles = useLoad(() => api("/users/roles"));
  const audit = useLoad(() => api("/users/audit/recent"));
  // The starting role, link lifetime and pause switch are admin controls in Settings.
  const people = me.settings?.people;
  const startRole: string = people?.defaultRole ?? "tech";
  const permList = useLoad(() => api("/users/permissions"));
  const [open, setOpen] = useState<string | null>(null);
  const [mail, setMail] = useState<{ id: string; value: string } | null>(null);
  const [tab, setTab] = useState<"people" | "roles">("people");
  const [removing, setRemoving] = useState<string | null>(null);
  const [restoreRole, setRestoreRole] = useState<Record<string, string>>({});
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
      toast("notify_email" in body ? t("Saved") : t("Saved. They've been signed out so the change applies right away."));
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

  async function remove(id: string) {
    try {
      await api(`/users/${encodeURIComponent(id)}/remove`, { body: {} });
      toast(t("Removed. They're signed out and can't sign in."));
      setRemoving(null);
      setOpen(null);
      reload();
      roles.reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  async function restore(id: string) {
    try {
      await api(`/users/${encodeURIComponent(id)}/restore`, { body: restoreRole[id] ? { role: restoreRole[id] } : {} });
      toast(t("Restored. They can sign in again with their passkey."));
      reload();
      roles.reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  const rolesChanged = () => { roles.reload(); permList.reload(); reload(); void refreshRoleNames(); };

  // Built-in roles show their short name in the person's language; roles an admin made or renamed keep the typed name.
  const roleNames: Record<string, string> = {};
  for (const [id, name] of Object.entries((roles.data?.roles ?? {}) as Record<string, string>)) roleNames[id] = roleDisplayName(id, name);
  const pickable = Object.entries(roleNames).filter(([k]) => k !== "admin");
  const current = (data?.users ?? []).filter((u: any) => !u.removed_at);
  const removed = (data?.users ?? []).filter((u: any) => u.removed_at);

  return (
    <>
      <PageHead title={t("People")} sub={t("Add and remove employees, make roles, and set what each person can do.")} tip="people.head" />
      <div className="seg people-tabs" role="tablist" aria-label={t("People")}>
        <button type="button" role="tab" aria-selected={tab === "people"} className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>{t("Employees")} <span className="count">{current.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "roles"} className={tab === "roles" ? "on" : ""} onClick={() => setTab("roles")}>{t("Roles")} <span className="count">{Object.keys(roleNames).length}</span></button>
      </div>
      {tab === "roles" && roles.data?.list && permList.data && <Roles list={roles.data.list} perms={permList.data} onChanged={rolesChanged} />}
      {tab === "people" && <>
      <h2 className="sec-title">{t("Add an employee")}</h2>
      <form className="panel grid g2" onSubmit={invite}>
        <div className="field"><label htmlFor="pn">{t("Full name")}</label><input id="pn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} /></div>
        <div className="field"><label htmlFor="pe">{t("Work email or username")}</label><input id="pe" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div className="field">
          <label htmlFor="pr">{t("Role")}</label>
          <select id="pr" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {pickable.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <ErrorNote error={err} />
        {people?.invitesPaused && <p className="note-inline">{t("New invites are paused. The portal owner can turn them back on in Settings > Command center.")}</p>}
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
            {current.map((u: any) => {
              const changed = Object.keys(u.access ?? {}).length;
              const adjustable = u.role !== "admin" && u.id !== me.id;
              return (
              <Fragment key={u.id}>
              <tr>
                <td>
                  <b>{u.name}</b><div className="muted">{u.email}</div>
                  {mail?.id === u.id ? (
                    <form className="row" style={{ gap: 6, marginTop: 4 }} onSubmit={(e) => { e.preventDefault(); update(u.id, { notify_email: mail!.value }); setMail(null); }}>
                      <input type="email" value={mail!.value} onChange={(e) => setMail({ id: u.id, value: e.target.value })} placeholder={t("Email for job notices")} aria-label={t("Email for job notices")} />
                      <button className="btn small" type="submit">{t("Save")}</button>
                      <button className="btn small" type="button" onClick={() => setMail(null)}>{t("Cancel")}</button>
                    </form>
                  ) : (
                    <button className="linkish small1" onClick={() => setMail({ id: u.id, value: u.notify_email ?? "" })}>
                      {u.notify_email ? t("Job emails: {email}", { email: u.notify_email }) : u.email.includes("@") ? t("Job emails go to the login") : t("Add an email for job notices")}
                    </button>
                  )}
                </td>
                <td>
                  <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })} disabled={u.id === me.id} aria-label={t("Role for {name}", { name: u.name })}>
                    {(u.role === "admin" ? Object.entries(roleNames) : pickable).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {changed > 0 && <div className="access-note">{changed === 1 ? t("1 change from the role") : t("{n} changes from the role", { n: changed })}</div>}
                </td>
                <td><span className={`pill ${u.status === "active" ? "p-ok" : "p-acc"}`}>{u.status === "active" ? t("active") : t("disabled")}</span></td>
                <td className="muted">{t("{p} passkey(s), {s} signed in", { p: u.passkeys, s: u.sessions })}</td>
                <td><div className="acts">
                  {adjustable && <button className={`btn small${open === u.id ? " on" : ""}`} aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)}>{t("Access")}</button>}
                  <button className="btn small" onClick={() => signOutAll(u.id)}>{t("Sign out everywhere")}</button>
                  {u.id !== me.id && (
                    <button className="btn small" title={t("Blocks sign-in for now. They stay on the list.")} onClick={() => update(u.id, { status: u.status === "active" ? "disabled" : "active" })}>{u.status === "active" ? t("Disable") : t("Re-enable")}</button>
                  )}
                  {u.id !== me.id && u.role !== "admin" && (removing === u.id ? (
                    <span className="row confirm" style={{ gap: 6 }}>
                      <button className="btn small danger" onClick={() => remove(u.id)}>{t("Yes, remove {name}", { name: u.name.split(" ")[0] })}</button>
                      <button className="btn small" onClick={() => setRemoving(null)}>{t("Keep")}</button>
                    </span>
                  ) : (
                    <button className="btn small danger" onClick={() => setRemoving(u.id)}>{t("Remove")}</button>
                  ))}
                </div></td>
              </tr>
              {open === u.id && permList.data && (
                <tr className="access-row"><td colSpan={5}><Access person={u} roleName={roleNames[u.role] ?? u.role} list={permList.data} people={data.users} onSaved={reload} onClose={() => setOpen(null)} /></td></tr>
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
      {removed.length > 0 && (
        <details className="panel removed">
          <summary><b>{t("Removed employees")}</b> <span className="count">{removed.length}</span><span className="muted">{t("They can't sign in. Their history, orders and messages stay.")}</span></summary>
          {removed.map((u: any) => {
            const roleGone = !roleNames[u.role];
            return (
              <div key={u.id} className="removed-row">
                <div className="removed-who"><b>{u.name}</b><span className="muted">{u.email} · {t("removed {when}", { when: fmtTime(u.removed_at) })}</span></div>
                {roleGone ? (
                  <select value={restoreRole[u.id] ?? ""} onChange={(e) => setRestoreRole({ ...restoreRole, [u.id]: e.target.value })} aria-label={t("Role for {name}", { name: u.name })}>
                    <option value="" disabled>{t("Pick a role")}</option>
                    {pickable.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                ) : <span className="muted">{roleNames[u.role]}</span>}
                <button className="btn small" disabled={roleGone && !restoreRole[u.id]} onClick={() => restore(u.id)}>{t("Restore")}</button>
              </div>
            );
          })}
        </details>
      )}
      </>}
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

export type PermList = { groups: { group: string; perms: { id: string; label: string; hint: string; adjustable: boolean; view: boolean }[] }[]; byRole: Record<string, string[]> };

// How long a change lasts (Command center): for good, or until a time.
const LASTS: { id: string; label: () => string; hours: number | null }[] = [
  { id: "always", label: () => t("For good"), hours: null },
  { id: "day", label: () => t("For 1 day"), hours: 24 },
  { id: "week", label: () => t("For 1 week"), hours: 24 * 7 },
  { id: "month", label: () => t("For 30 days"), hours: 24 * 30 },
];

/**
 * Switch single permissions on or off for one person, on top of their role. Used on People > Access
 * and in Settings > Command center. `people` turns on "Copy from", `sectionsOff` explains the switches
 * the owner turned off for everyone.
 */
export function Access({ person, roleName, list, onSaved, onClose, people, sectionsOff, inline }: {
  person: any; roleName: string; list: PermList; onSaved: () => void; onClose?: () => void;
  people?: { id: string; name: string; role: string; removed_at?: string | null }[]; sectionsOff?: ReadonlySet<string>; inline?: boolean;
}) {
  const [changes, setChanges] = useState<Record<string, boolean>>(person.access ?? {});
  const [until, setUntil] = useState<Record<string, string>>(person.until ?? {});
  const [lasts, setLasts] = useState("always");
  const [copy, setCopy] = useState("");
  const [busy, setBusy] = useState(false);
  const fromRole = new Set(list.byRole[person.role] ?? []);
  useEffect(() => { setChanges(person.access ?? {}); setUntil(person.until ?? {}); }, [person.id, person.access, person.until]);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const hours = LASTS.find((l) => l.id === lasts)?.hours ?? null;
      const withEnd = body.changes && hours ? { ...body, until: new Date(Date.now() + hours * 3600_000).toISOString() } : body;
      const r = await api(`/users/${encodeURIComponent(person.id)}/access`, { method: "PUT", body: withEnd });
      setChanges(r.changes);
      if (body.copyFrom) toast(t("Copied. They now have the same role and access."));
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
  // A whole page on or off for this person: every function in the group.
  const wholePage = (perms: { id: string; adjustable: boolean }[], on: boolean) => {
    const next: Record<string, boolean | null> = {};
    for (const p of perms) if (p.adjustable) next[p.id] = fromRole.has(p.id) === on ? null : on;
    save({ changes: next });
  };
  const phone = usePhone() && !inline;
  useEffect(() => {
    if (!phone || !onClose) return;
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
          {onClose && <button className="btn small" onClick={onClose}>{t("Done")}</button>}
        </div>
      </div>
      <div className="row wrap access-tools">
        <label className="row" style={{ gap: 6 }}>
          <span className="muted">{t("New changes last")}</span>
          <select value={lasts} onChange={(e) => setLasts(e.target.value)}>
            {LASTS.map((l) => <option key={l.id} value={l.id}>{l.label()}</option>)}
          </select>
        </label>
        {people && (
          <span className="row" style={{ gap: 6 }}>
            <select aria-label={t("Copy role and access from")} value={copy} onChange={(e) => setCopy(e.target.value)}>
              <option value="">{t("Copy role and access from…")}</option>
              {people.filter((x) => x.id !== person.id && x.role !== "admin" && !x.removed_at).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="btn small" disabled={busy || !copy} onClick={() => { save({ copyFrom: copy }); setCopy(""); }}>{t("Copy")}</button>
          </span>
        )}
      </div>
      <div className="access-groups">
        {list.groups.map((g) => (
          <section key={g.group} className="access-group">
            <div className="row access-group-head">
              <h3>{t(g.group)}</h3>
              <span className="spacer" />
              {g.perms.some((p) => p.adjustable) && (
                <>
                  <button className="btn tiny" disabled={busy} onClick={() => wholePage(g.perms, true)} title={t("Turn every function on this page on for this person")}>{t("All on")}</button>
                  <button className="btn tiny" disabled={busy} onClick={() => wholePage(g.perms, false)} title={t("Turn this whole page off for this person")}>{t("All off")}</button>
                </>
              )}
            </div>
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
                    <small className="access-why">{
                      sectionsOff?.has(p.id) ? t("Off for everyone: the owner switched this section off")
                        : own === undefined ? (role ? t("On from the role") : t("Off from the role"))
                          : until[p.id] ? t("Changed for them until {when}", { when: fmtTime(until[p.id]!) }) : t("Changed for them")
                    }</small>
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

type RoleInfo = { id: string; name: string; builtIn: boolean; changed: boolean; renamed: boolean; perms: string[]; people: number };

const shownName = (r: RoleInfo) => (r.renamed ? r.name : roleDisplayName(r.id, r.name));

/** People > Roles: make roles, rename them, choose their switches, delete unused ones. */
function Roles({ list, perms, onChanged }: { list: RoleInfo[]; perms: PermList; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", copyFrom: "" });
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const total = perms.groups.reduce((n, g) => n + g.perms.filter((p) => p.adjustable).length, 0);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api("/users/roles", { body: { name: form.name, copyFrom: form.copyFrom || null } });
      setForm({ name: "", copyFrom: "" });
      toast(t("Role made. Pick its switches below."));
      onChanged();
      setEditing(r.id);
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  async function act(path: string, method: string, done: string) {
    try {
      await api(path, { method, body: method === "DELETE" ? undefined : {} });
      toast(done);
      setDeleting(null);
      onChanged();
    } catch (x) {
      toast((x as Error).message);
    }
  }

  return (
    <>
      <h2 className="sec-title">{t("Make a role")}</h2>
      <form className="panel grid g2" onSubmit={create}>
        <div className="field"><label htmlFor="rn">{t("Role name")}</label><input id="rn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} placeholder={t("For example: Shipping and receiving")} /></div>
        <div className="field">
          <label htmlFor="rc">{t("Start from")}</label>
          <select id="rc" value={form.copyFrom} onChange={(e) => setForm({ ...form, copyFrom: e.target.value })}>
            <option value="">{t("Nothing switched on")}</option>
            {list.filter((r) => r.id !== "admin").map((r) => <option key={r.id} value={r.id}>{t("Copy {role}", { role: shownName(r) })}</option>)}
          </select>
        </div>
        <ErrorNote error={err} />
        <div><button className="btn primary" type="submit">{t("Make role")}</button></div>
      </form>
      <div className="panel tbl">
        <table>
          <thead><tr><th>{t("Role")}</th><th>{t("People")}</th><th>{t("Switches on")}</th><th /></tr></thead>
          <tbody>
            {list.map((r) => {
              const isAdmin = r.id === "admin";
              const on = r.perms.filter((p) => perms.groups.some((g) => g.perms.some((x) => x.id === p && x.adjustable))).length;
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td>
                      <b>{shownName(r)}</b>
                      <div className="role-tags">
                        <span className="tag">{r.builtIn ? t("Built in") : t("Made here")}</span>
                        {r.changed && <span className="tag accent">{t("Changed")}</span>}
                      </div>
                    </td>
                    <td>{r.people}</td>
                    <td>{isAdmin ? t("Everything, always") : t("{n} of {total}", { n: on, total })}</td>
                    <td><div className="acts">
                      {!isAdmin && <button className={`btn small${editing === r.id ? " on" : ""}`} aria-expanded={editing === r.id} onClick={() => setEditing(editing === r.id ? null : r.id)}>{t("Edit")}</button>}
                      {r.builtIn && r.changed && <button className="btn small" onClick={() => act(`/users/roles/${encodeURIComponent(r.id)}/reset`, "POST", t("Back to how it came."))}>{t("Back to original")}</button>}
                      {!r.builtIn && (deleting === r.id ? (
                        <span className="row" style={{ gap: 6 }}>
                          <button className="btn small danger" onClick={() => act(`/users/roles/${encodeURIComponent(r.id)}`, "DELETE", t("Role deleted."))}>{t("Yes, delete")}</button>
                          <button className="btn small" onClick={() => setDeleting(null)}>{t("Keep")}</button>
                        </span>
                      ) : (
                        <button className="btn small danger" disabled={r.people > 0} title={r.people > 0 ? t("Give its people another role first.") : undefined} onClick={() => setDeleting(r.id)}>{t("Delete")}</button>
                      ))}
                    </div></td>
                  </tr>
                  {editing === r.id && (
                    <tr className="access-row"><td colSpan={4}><RoleEditor role={r} list={perms} onSaved={onChanged} onClose={() => setEditing(null)} /></td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Rename a role and switch what it can do. Saved together; applies to its people on their next click. */
function RoleEditor({ role, list, onSaved, onClose }: { role: RoleInfo; list: PermList; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(role.name);
  const [on, setOn] = useState<Set<string>>(() => new Set(role.perms));
  const [busy, setBusy] = useState(false);
  const adjustable = list.groups.flatMap((g) => g.perms.filter((p) => p.adjustable));
  const dirty = name.trim() !== role.name || adjustable.some((p) => on.has(p.id) !== role.perms.includes(p.id));
  const flip = (id: string, v: boolean) => setOn((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
  const setAll = (pick: (p: (typeof adjustable)[number]) => boolean) => setOn(new Set(adjustable.filter(pick).map((p) => p.id)));

  async function save() {
    setBusy(true);
    try {
      await api(`/users/roles/${encodeURIComponent(role.id)}`, { method: "PATCH", body: { name: name.trim(), perms: adjustable.filter((p) => on.has(p.id)).map((p) => p.id) } });
      toast(t("Saved. Everyone with this role gets it on their next click."));
      onSaved();
      onClose();
    } catch (x) {
      toast((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const phone = usePhone();
  useEffect(() => {
    if (!phone) return;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = was; };
  }, [phone]);

  const panel = (
    <div className={`access${phone ? " sheet" : ""}`} role={phone ? "dialog" : undefined} aria-modal={phone || undefined} aria-label={t("Edit role {role}", { role: role.name })}>
      <div className="access-head">
        <div className="field role-name">
          <label htmlFor={`rname-${role.id}`}>{t("Role name")}</label>
          <input id={`rname-${role.id}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <div className="muted">{role.people === 1 ? t("1 person has this role. Personal changes on People > Access still apply on top.") : t("{n} people have this role. Personal changes on People > Access still apply on top.", { n: role.people })}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" disabled={busy} onClick={() => setAll((p) => p.view)}>{t("View only")}</button>
          <button className="btn small" disabled={busy} onClick={() => setAll(() => true)}>{t("All on")}</button>
          <button className="btn small" disabled={busy} onClick={() => setAll(() => false)}>{t("All off")}</button>
          <button className="btn small" onClick={onClose}>{t("Cancel")}</button>
          <button className="btn small primary" disabled={busy || !dirty || !name.trim()} onClick={save}>{t("Save role")}</button>
        </div>
      </div>
      <div className="access-groups">
        {list.groups.map((g) => (
          <section key={g.group} className="access-group">
            <h3>{t(g.group)}</h3>
            {g.perms.map((p) => {
              const v = on.has(p.id);
              return (
                <div key={p.id} className={`access-perm${v !== role.perms.includes(p.id) ? " changed" : ""}`}>
                  <span className={`access-dot${v && p.adjustable ? " on" : ""}`} aria-hidden="true" />
                  <div className="access-text">
                    <span>{t(p.label)}</span>
                    <small className="muted">{t(p.hint)}</small>
                  </div>
                  {p.adjustable ? (
                    <div className="seg" role="radiogroup" aria-label={t(p.label)}>
                      <button type="button" role="radio" aria-checked={v} disabled={busy} className={v ? "on" : ""} onClick={() => flip(p.id, true)}>{t("On")}</button>
                      <button type="button" role="radio" aria-checked={!v} disabled={busy} className={!v ? "on" : ""} onClick={() => flip(p.id, false)}>{t("Off")}</button>
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

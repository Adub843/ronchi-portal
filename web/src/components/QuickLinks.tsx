// Quick links on Home: buttons that open a website. Admins add, name, reorder and remove them,
// and choose who sees each one (everyone, some roles, or some people).
import { useState } from "react";
import { api, can, type Me } from "../api";
import { t } from "../i18n";
import { roleIds, roleLabel } from "../roles";
import { ErrorNote, toast, useLoad } from "./ui";

type Audience = { roles: string[]; people: string[] } | null;
type QuickLink = { id: string; label: string; url: string; audience: Audience };

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

export function QuickLinks({ me }: { me: Me }) {
  const admin = can(me, "users.manage");
  const [editing, setEditing] = useState(false);
  const mine = useLoad(() => api("/links"));
  const links: QuickLink[] = mine.data?.links ?? [];
  if (!admin && !links.length) return null;

  return (
    <section className="quick">
      <div className="quick-head">
        <h2 className="sec-title">{t("Quick links")}</h2>
        {admin && <button className={`btn small${editing ? " on" : ""}`} onClick={() => setEditing(!editing)}>{editing ? t("Done") : t("Edit quick links")}</button>}
      </div>
      {editing ? (
        <Editor onChanged={mine.reload} />
      ) : links.length ? (
        <div className="quick-row">
          {links.map((l) => (
            <a key={l.id} className="quick-btn" href={l.url} target="_blank" rel="noopener noreferrer">
              <span className="quick-label">{l.label}</span>
              <span className="quick-host">{host(l.url)}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3 5 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </a>
          ))}
        </div>
      ) : (
        <p className="muted quick-empty">{t("No quick links yet. Press Edit quick links to add buttons that open a website.")}</p>
      )}
    </section>
  );
}

function Editor({ onChanged }: { onChanged: () => void }) {
  const all = useLoad(() => api("/links?all=1"));
  const people = useLoad(() => api("/users"));
  const [form, setForm] = useState<{ label: string; url: string; audience: Audience }>({ label: "", url: "", audience: null });
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<QuickLink | null>(null);
  const list: QuickLink[] = all.data?.links ?? [];
  const staff: { id: string; name: string }[] = (people.data?.users ?? []).filter((u: any) => !u.removed_at);
  const refresh = () => { all.reload(); onChanged(); };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api("/links", { body: form });
      setForm({ label: "", url: "", audience: null });
      toast(t("Link added."));
      refresh();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  async function save(l: QuickLink) {
    try {
      await api(`/links/${encodeURIComponent(l.id)}`, { method: "PATCH", body: { label: l.label, url: l.url, audience: l.audience } });
      setEdit(null);
      toast(t("Saved."));
      refresh();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/links/${encodeURIComponent(id)}`, { method: "DELETE" });
      refresh();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  async function move(i: number, by: number) {
    const ids = list.map((l) => l.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + by, 0, x!);
    await api("/links/order", { body: { ids } });
    refresh();
  }
  const who = (a: Audience) => (!a ? t("Everyone") : [...a.roles.map((r) => roleLabel(r, true)), ...a.people.map((p) => staff.find((s) => s.id === p)?.name ?? "?")].join(", "));

  return (
    <div className="panel quick-edit">
      <form className="quick-form" onSubmit={add}>
        <div className="field"><label htmlFor="ql-n">{t("Button name")}</label><input id="ql-n" value={form.label} maxLength={40} required placeholder={t("For example: Ronchi Italy")} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
        <div className="field"><label htmlFor="ql-u">{t("Web address")}</label><input id="ql-u" value={form.url} required inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://" onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
        <Who value={form.audience} staff={staff} onChange={(audience) => setForm({ ...form, audience })} />
        <ErrorNote error={err} />
        <div><button className="btn primary" type="submit">{t("Add link")}</button></div>
      </form>
      {list.length > 0 && (
        <ul className="quick-list">
          {list.map((l, i) => (
            <li key={l.id}>
              {edit?.id === l.id ? (
                <div className="quick-form">
                  <div className="field"><label htmlFor={`e-n-${l.id}`}>{t("Button name")}</label><input id={`e-n-${l.id}`} value={edit.label} maxLength={40} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></div>
                  <div className="field"><label htmlFor={`e-u-${l.id}`}>{t("Web address")}</label><input id={`e-u-${l.id}`} value={edit.url} inputMode="url" autoCapitalize="none" spellCheck={false} onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></div>
                  <Who value={edit.audience} staff={staff} onChange={(audience) => setEdit({ ...edit, audience })} />
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn small primary" onClick={() => save(edit)}>{t("Save")}</button>
                    <button className="btn small" onClick={() => setEdit(null)}>{t("Cancel")}</button>
                  </div>
                </div>
              ) : (
                <div className="quick-item">
                  <div className="quick-item-text"><b>{l.label}</b><span className="muted">{host(l.url)} · {who(l.audience)}</span></div>
                  <div className="acts">
                    <button className="btn small" disabled={i === 0} aria-label={t("Move up")} onClick={() => move(i, -1)}>↑</button>
                    <button className="btn small" disabled={i === list.length - 1} aria-label={t("Move down")} onClick={() => move(i, 1)}>↓</button>
                    <button className="btn small" onClick={() => setEdit(l)}>{t("Edit")}</button>
                    <button className="btn small danger" onClick={() => remove(l.id)}>{t("Remove")}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Who sees a link: everyone, or the roles and people ticked. */
function Who({ value, staff, onChange }: { value: Audience; staff: { id: string; name: string }[]; onChange: (a: Audience) => void }) {
  const a = value ?? { roles: [], people: [] };
  const set = (next: { roles: string[]; people: string[] }) => onChange(next.roles.length || next.people.length ? next : null);
  const flip = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  return (
    <fieldset className="field quick-who">
      <label>{t("Who sees it")}</label>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className={`btn small${!value ? " on" : ""}`} onClick={() => onChange(null)}>{t("Everyone")}</button>
        <details>
          <summary className="btn small">{t("Roles")}{a.roles.length ? ` (${a.roles.length})` : ""}</summary>
          <div className="quick-pick">
            {roleIds().filter((r) => r !== "admin").map((r) => (
              <label key={r}><input type="checkbox" checked={a.roles.includes(r)} onChange={(e) => set({ ...a, roles: flip(a.roles, r, e.target.checked) })} /> {roleLabel(r, true)}</label>
            ))}
          </div>
        </details>
        <details>
          <summary className="btn small">{t("People")}{a.people.length ? ` (${a.people.length})` : ""}</summary>
          <div className="quick-pick">
            {staff.map((p) => (
              <label key={p.id}><input type="checkbox" checked={a.people.includes(p.id)} onChange={(e) => set({ ...a, people: flip(a.people, p.id, e.target.checked) })} /> {p.name}</label>
            ))}
          </div>
        </details>
      </div>
      <span className="muted">{value ? t("Only the roles and people ticked, plus admins when editing.") : t("Everyone on staff sees this button.")}</span>
    </fieldset>
  );
}

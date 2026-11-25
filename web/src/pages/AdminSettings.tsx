// Settings > Command center: every switch and control for the portal, for the portal owner only (Aaron).
// The server (src/portal/routes/settings.ts) checks and enforces every value; this page only shows them.
import { useEffect, useState, type ReactNode } from "react";
import { api, fmtTime } from "../api";
import { ErrorNote, Link, toast, useLoad } from "../components/ui";
import { LANGS, t } from "../i18n";
import { THEMES } from "../theme";
import { STARTING_ROLES, type PortalSettings, type Section } from "../../../src/portal/lib/settings";
import { AccessCenter } from "./AccessCenter";
import "../styles/admin.css";

type Role = PortalSettings["people"]["defaultRole"];

// Plain names for the screen. Kept here (not from the server) so each one is translated.
const roleName = (r: string) =>
  ({ manager: t("Manager"), billing: t("Billing"), scheduling: t("Scheduling"), service: t("Service"), sales: t("Sales"), engineering: t("Engineering"), tech: t("Field service engineer") })[r] ?? r;
// A section added later (lib/settings.ts SECTIONS) shows with the label the server sends until it gets a line here.
const SECTION_NAMES: Partial<Record<string, () => string>> = {
  chats: () => t("Chats and boards"), jobs: () => t("Jobs (field service scheduling)"), machines: () => t("Machines"), catalog: () => t("Parts catalog"),
  customers: () => t("Customers and quote requests"), cpSales: () => t("Change-part sales"), changeParts: () => t("Change parts"), partsOrders: () => t("Parts orders"), knowledge: () => t("Knowledge base"), software: () => t("Software downloads"),
};
const sectionName = (s: string, label?: string) => SECTION_NAMES[s]?.() ?? label ?? s;
const LOCKED = () => [
  t("Admins always have every permission, and only admins can manage people and the activity log."),
  t("Only the portal owner sees the command center. Other admins can't disable, demote or sign out the owner."),
  t("Nobody can remove their own admin access."),
  t("Private chats are members-only. Admins can't read chats they aren't in."),
  t("Customers never see the business side. The help center and parts site are separate, with their own data."),
  t("Sign-in is with passkeys only (Face ID, fingerprint, Windows Hello). There are no passwords."),
  t("Each file can be at most 25 MB, and only safe file types can be sent."),
  t("No money amounts or sales totals are shown anywhere in the portal, except parts order prices and sales, which only people with See parts prices can see."),
  t("The activity log can't be edited or deleted."),
];

type Switches = { workbook: boolean };
interface Loaded {
  settings: PortalSettings; defaults: PortalSettings; updatedAt: string | null; updatedBy: string | null;
  sections: Record<string, { label: string; hint?: string; perms: readonly string[] }>;
  owner: { id: string; name: string } | null; admins: { id: string; name: string }[];
}

export function AdminSettings({ onSaved, switches, onSwitches }: { onSaved: (s: PortalSettings) => void; switches: Switches; onSwitches: (s: Switches) => void }) {
  const loaded = useLoad<Loaded>(() => api("/settings"));
  const stats = useLoad(() => api("/settings/stats"));
  const [draft, setDraft] = useState<PortalSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (loaded.data) setDraft(structuredClone(loaded.data.settings));
  }, [loaded.data]);

  if (loaded.error) return <ErrorNote error={loaded.error} />;
  if (!loaded.data || !draft) return <div className="panel" aria-busy="true">{t("Loading…")}</div>;
  const data = loaded.data;
  const saved = data.settings;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  function set<G extends keyof PortalSettings>(group: G, patch: Partial<PortalSettings[G]>) {
    setDraft((d) => (d ? { ...d, [group]: { ...d[group], ...patch } } : d));
  }
  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const r = await api<{ settings: PortalSettings }>("/settings", { method: "PUT", body: draft });
      onSaved(r.settings);
      loaded.reload();
      toast(t("Saved. Changes apply to everyone within a few seconds."));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function reset(group: keyof PortalSettings) {
    const r = await api<{ settings: PortalSettings }>("/settings/reset", { body: { group } });
    onSaved(r.settings);
    loaded.reload();
    toast(t("Back to how the portal started."));
  }
  async function emergency(path: string, confirmText?: string) {
    if (confirmText !== undefined && confirmText !== "SIGN OUT") return toast(t("Type SIGN OUT to confirm."));
    try {
      const r = await api(path, { body: confirmText ? { confirm: confirmText } : {} });
      toast(r.sessions !== undefined ? t("Signed out of {n} device(s)", { n: r.sessions }) : t("Cancelled {n} invite link(s)", { n: r.invites }));
      stats.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const roles = STARTING_ROLES;
  const s = stats.data;

  return (
    <div className="admin stack">
      <p className="muted" style={{ margin: 0 }}>
        {t("Only you see this, as the portal owner. Every change is checked on the server and recorded in the activity log.")}
        {loaded.data.updatedAt && <> {t("Last changed {when} by {who}.", { when: fmtTime(loaded.data.updatedAt), who: loaded.data.updatedBy ?? "–" })}</>}
      </p>

      <Group title={t("Portal at a glance")} sub={t("How the portal is being used, to help it grow. No money amounts.")}>
        <div className="cp-tiles five">
          <Tile n={s?.active} l={t("Active logins")} />
          <Tile n={s?.seen7} l={t("Used it this week")} />
          <Tile n={s?.posts30} l={t("Messages, last 30 days")} />
          <Tile n={s?.invites} l={t("Invites not used yet")} />
          <Tile n={s?.machines} l={t("Machines on file")} />
        </div>
        <details>
          <summary>{t("When each person last used the portal")}</summary>
          <div className="tbl">
            <table>
              <thead><tr><th>{t("Name")}</th><th>{t("Role")}</th><th>{t("Last used")}</th><th>{t("Messages, last 30 days")}</th></tr></thead>
              <tbody>
                {s?.people.map((p: any) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b>{p.status !== "active" && <> <span className="pill p-acc">{t("disabled")}</span></>}</td>
                    <td>{p.role === "admin" ? t("Admin") : roleName(p.role)}</td>
                    <td>{p.last_seen || p.last_login ? fmtTime(p.last_seen ?? p.last_login) : <span className="muted">{t("Not yet")}</span>}</td>
                    <td className="mono">{p.posts30}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Group>

      <Group title={t("Name and notice")} onReset={() => reset("brand")}>
        <div className="grid g2">
          <Field id="as-name" label={t("Portal name")} hint={t("Shown in the top bar and the browser tab.")}>
            <input id="as-name" value={draft.brand.name} maxLength={60} onChange={(e) => set("brand", { name: e.target.value })} />
          </Field>
          <Field id="as-co" label={t("Company line")} hint={t("The small line under the name.")}>
            <input id="as-co" value={draft.brand.company} maxLength={60} onChange={(e) => set("brand", { company: e.target.value })} />
          </Field>
        </div>
        <Field id="as-notice" label={t("Notice for everyone")} hint={t("A strip at the top of every page for all staff, for example planned downtime or a new feature. Leave empty for none.")}>
          <textarea id="as-notice" rows={2} maxLength={300} value={draft.brand.notice} onChange={(e) => set("brand", { notice: e.target.value })} />
        </Field>
      </Group>

      <Group title={t("People and sign-in")} sub={<>{t("Invite people, change roles and disable logins on the People page.")} <Link to="/people">{t("Open People")}</Link></>} onReset={() => reset("people")}>
        <div className="grid g2">
          <Field id="as-role" label={t("Starting role for new invites")}>
            <select id="as-role" value={draft.people.defaultRole} onChange={(e) => set("people", { defaultRole: e.target.value as Role })}>
              {roles.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
            </select>
          </Field>
          <Field id="as-inv" label={t("Invite links work for")}>
            <select id="as-inv" value={draft.people.inviteHours} onChange={(e) => set("people", { inviteHours: Number(e.target.value) })}>
              {[1, 4, 24, 72, 168, 336].map((h) => <option key={h} value={h}>{h < 24 ? t("{n} hour(s)", { n: h }) : t("{n} day(s)", { n: h / 24 })}</option>)}
            </select>
          </Field>
          <Field id="as-sess" label={t("Stay signed in for up to (days)")} hint={t("After this, people sign in again with their passkey. 1 to 90.")}>
            <input id="as-sess" type="number" min={1} max={90} value={draft.people.sessionDays} onChange={(e) => set("people", { sessionDays: Number(e.target.value) })} />
          </Field>
          <Field id="as-idle" label={t("Sign out after this many days unused")} hint={t("For a lost or shared device. 1 to 30.")}>
            <input id="as-idle" type="number" min={1} max={30} value={draft.people.idleDays} onChange={(e) => set("people", { idleDays: Number(e.target.value) })} />
          </Field>
        </div>
        <Switch checked={draft.people.invitesPaused} onChange={(v) => set("people", { invitesPaused: v })} label={t("Pause new invites")} hint={t("Nobody can make a new invite link until this is turned off. Links already sent still work.")} />
      </Group>

      <Group title={t("Sections of the portal")} sub={t("Turn a section off to hide it from everyone except admins, for example while it's being set up.")} onReset={() => reset("sections")}>
        <div className="grid g2">
          {(Object.keys(draft.sections) as Section[]).map((k) => (
            <Switch key={k} checked={draft.sections[k]} onChange={(v) => set("sections", { [k]: v })} label={sectionName(k, data.sections[k]?.label)} hint={draft.sections[k] ? t("On for everyone whose role allows it") : t("Off: only admins see it")} />
          ))}
        </div>
        <WorkbookSwitch on={switches.workbook} onSwitches={onSwitches} />
      </Group>

      <Group title={t("Each person's access")} sub={t("Pick a person and switch every function of every page on or off for them, for good or for a set time. Roles themselves are edited on People > Roles.")}>
        <AccessCenter switches={switches} sectionsOff={new Set(Object.entries(saved.sections).filter(([, on]) => !on).flatMap(([k]) => data.sections[k]?.perms ?? []))} />
      </Group>

      <Group title={t("Chats and boards")} onReset={() => reset("chats")}>
        <div className="grid g2">
          <Field id="as-people" label={t("Most people in one chat")} hint={t("2 to 50, counting the person who starts it.")}>
            <input id="as-people" type="number" min={2} max={50} value={draft.chats.maxPeople} onChange={(e) => set("chats", { maxPeople: Number(e.target.value) })} />
          </Field>
          <Field id="as-mb" label={t("Largest file (MB)")} hint={t("1 to 25. 25 MB is the most the portal allows.")}>
            <input id="as-mb" type="number" min={1} max={25} value={draft.chats.maxFileMb} disabled={!draft.chats.files} onChange={(e) => set("chats", { maxFileMb: Number(e.target.value) })} />
          </Field>
          <Field id="as-nf" label={t("Files in one message")} hint={t("1 to 10.")}>
            <input id="as-nf" type="number" min={1} max={10} value={draft.chats.maxFiles} disabled={!draft.chats.files} onChange={(e) => set("chats", { maxFiles: Number(e.target.value) })} />
          </Field>
        </div>
        <Switch checked={draft.chats.files} onChange={(v) => set("chats", { files: v })} label={t("Allow photos and files in chats and boards")} hint={t("Files already sent stay where they are.")} />
      </Group>

      <Group title={t("Languages")} sub={t("Menus and buttons only. Messages always show exactly as people wrote them.")} onReset={() => reset("languages")}>
        <div className="row">
          {LANGS.map((l) => {
            const on = draft.languages.allowed.includes(l.id);
            return (
              <label key={l.id} className="row switchrow">
                <input type="checkbox" checked={on} disabled={l.id === "en"} onChange={() => set("languages", { allowed: on ? draft.languages.allowed.filter((x) => x !== l.id) : [...draft.languages.allowed, l.id] })} />
                <span><b>{l.name}</b>{l.id === "en" && <small className="muted">{t("Always on")}</small>}</span>
              </label>
            );
          })}
        </div>
        <Field id="as-lang" label={t("Language new people start with")}>
          <select id="as-lang" value={draft.languages.default} onChange={(e) => set("languages", { default: e.target.value as "en" })}>
            {LANGS.filter((l) => draft.languages.allowed.includes(l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      </Group>

      <Group title={t("Looks and alerts")} sub={t("The customer side always uses the Ronchi look.")} onReset={() => reset("look")}>
        <Field id="as-theme" label={t("Look new people start with")}>
          <select id="as-theme" value={draft.look.defaultTheme} onChange={(e) => set("look", { defaultTheme: e.target.value })}>
            {THEMES.filter((th) => draft.look.allowedThemes.includes(th.id)).map((th) => <option key={th.id} value={th.id}>{th.name}</option>)}
          </select>
        </Field>
        <div className="row">
          <b>{t("Looks staff can pick")}</b>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={() => set("look", { allowedThemes: THEMES.map((th) => th.id) })}>{t("All")}</button>
          <button type="button" className="btn small" onClick={() => set("look", { allowedThemes: ["ronchi"], defaultTheme: "ronchi" })}>{t("Ronchi only")}</button>
        </div>
        <div className="admin-themes">
          {THEMES.map((th) => {
            const on = draft.look.allowedThemes.includes(th.id);
            return (
              <label key={th.id} className="row switchrow">
                <input type="checkbox" checked={on} disabled={th.id === "ronchi"} onChange={() => set("look", { allowedThemes: on ? draft.look.allowedThemes.filter((x) => x !== th.id) : [...draft.look.allowedThemes, th.id] })} />
                <span>{th.name}</span>
              </label>
            );
          })}
        </div>
        <Switch checked={draft.look.popupsDefault} onChange={(v) => set("look", { popupsDefault: v })} label={t("Pop-up message alerts on for new people")} hint={t("Each person can still turn theirs on or off.")} />
      </Group>

      <Group title={t("Other controls")} sub={t("Controls that live on their own pages, one press away.")}>
        <div className="row wrap">
          <Link to="/people" className="btn">{t("People, roles and access")}</Link>
          <Link to="/people" className="btn">{t("Activity log")}</Link>
          <Link to="/kb" className="btn">{t("Knowledge base")}</Link>
          <Link to="/learn" className="btn">{t("Portal training")}</Link>
        </div>
      </Group>

      <Owner owner={data.owner} admins={data.admins} />

      <Group title={t("Emergency")} sub={t("For a lost phone or a link sent to the wrong person. These can't be undone, but nobody loses any data.")}>
        <Emergency onSignOut={(text) => emergency("/settings/sign-out-everyone", text)} onCancelInvites={() => emergency("/settings/cancel-invites")} />
      </Group>

      <Group title={t("Locked rules")} sub={t("These are built into the portal on purpose and can't be switched off here.")}>
        <ul className="admin-locked">{LOCKED().map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="muted" style={{ margin: 0 }}>
          {t("See who did what in the activity log.")} <Link to="/people">{t("Open People")}</Link>
        </p>
      </Group>

      {dirty && (
        <div className="admin-savebar" role="region" aria-label={t("Unsaved changes")}>
          <ErrorNote error={err} />
          <span>{t("You have changes that aren't saved.")}</span>
          <span className="spacer" />
          <button className="btn" onClick={() => { setDraft(structuredClone(saved)); setErr(null); }}>{t("Discard")}</button>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? t("Saving…") : t("Save changes")}</button>
        </div>
      )}
    </div>
  );
}

function Group({ title, sub, onReset, children }: { title: string; sub?: ReactNode; onReset?: () => void; children: ReactNode }) {
  return (
    <section className="panel stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="spacer" />
        {onReset && <button type="button" className="linkish" onClick={onReset}>{t("Reset this group")}</button>}
      </div>
      {sub && <p className="muted" style={{ margin: 0 }}>{sub}</p>}
      {children}
    </section>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="row switchrow">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{label}</b>{hint && <small className="muted">{hint}</small>}</span>
    </label>
  );
}

function Tile({ n, l }: { n: number | undefined; l: string }) {
  return (
    <div className="panel cp-tile" style={{ cursor: "default" }}>
      <span className="n">{n ?? "–"}</span>
      <span className="l">{l}</span>
    </div>
  );
}

function Emergency({ onSignOut, onCancelInvites }: { onSignOut: (text: string) => void; onCancelInvites: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="grid g2">
      <div className="stack">
        <b>{t("Sign everyone else out now")}</b>
        <small className="muted">{t("Every phone and computer except this one is signed out. People sign back in with their passkey.")}</small>
        <div className="row">
          <input aria-label={t("Type SIGN OUT to confirm.")} placeholder="SIGN OUT" value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 160 }} />
          <button className="btn danger" onClick={() => { onSignOut(text); setText(""); }}>{t("Sign everyone out")}</button>
        </div>
      </div>
      <div className="stack">
        <b>{t("Cancel every unused invite link")}</b>
        <small className="muted">{t("Links already sent stop working. Make new ones on the People page.")}</small>
        <div><button className="btn danger" onClick={onCancelInvites}>{t("Cancel all invite links")}</button></div>
      </div>
    </div>
  );
}

/** The Ronchi workbook switch: off = the Work orders pages are gone for everyone. Saves at once. */
function WorkbookSwitch({ on, onSwitches }: { on: boolean; onSwitches: (s: Switches) => void }) {
  return (
    <label className="row switchrow">
      <input type="checkbox" checked={on} onChange={async (e) => {
        const next = e.target.checked;
        if (!next && !window.confirm(t("Switch the Ronchi workbook off for everyone? Work orders leave the menu. Jobs, job emails and job files keep working, and nothing is deleted."))) return;
        try {
          const r = await api("/switches/workbook", { method: "PUT", body: { on: next } });
          onSwitches(r.switches);
          toast(next ? t("The Ronchi workbook is on") : t("The Ronchi workbook is off"));
        } catch (x) {
          toast((x as Error).message);
        }
      }} />
      <span><b>{t("Use the Ronchi workbook (Work orders)")}</b><small className="muted">{t("On: each job has a work order with the machine's log of past work orders, and the field service engineer's email opens it. Off: for teams that keep their Excel sheets. Jobs, job emails and files keep working; switching back on brings everything back.")}</small></span>
    </label>
  );
}

/** Who owns the command center, and handing it to another admin. */
function Owner({ owner, admins }: { owner: { id: string; name: string } | null; admins: { id: string; name: string }[] }) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const others = admins.filter((a) => a.id !== owner?.id);
  async function hand() {
    if (text !== "OWNER") return toast(t("Type OWNER to confirm."));
    try {
      await api("/settings/owner", { body: { userId: to, confirm: text } });
      toast(t("Done. The command center now belongs to them."));
      location.hash = "#my-settings";
      location.reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  return (
    <Group title={t("Owner")} sub={t("Only the owner sees the command center. If the owner's login is ever lost, whoever deploys the portal can run npm run owner on that PC.")}>
      <p style={{ margin: 0 }}>{owner ? t("{who} owns the command center.", { who: owner.name }) : t("Nobody owns the command center yet, so every admin sees it.")}</p>
      {others.length > 0 && (
        <div className="row wrap">
          <select aria-label={t("Hand the command center to")} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{t("Hand the command center to…")}</option>
            {others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input aria-label={t("Type OWNER to confirm.")} placeholder="OWNER" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 110 }} />
          <button className="btn" disabled={!to} onClick={hand}>{t("Hand over")}</button>
        </div>
      )}
    </Group>
  );
}

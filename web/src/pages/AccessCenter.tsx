// Settings > Command center > Each person's access: pick a person and switch every function of every
// page on or off for them, see the pages they get, and review who has what across the whole team.
// The server checks everything (PUT /api/users/:id/access); this page only shows and asks.
import { useMemo, useState } from "react";
import { api, fmtTime } from "../api";
import { t } from "../i18n";
import { menuFor } from "../nav";
import { toast, useLoad } from "../components/ui";
import { roleDisplayName } from "../roles";
import { Access, type PermList } from "./People";

type Person = { id: string; name: string; role: string; status: string; removed_at: string | null; access: Record<string, boolean>; until: Record<string, string>; permissions: string[] };

export function AccessCenter({ sectionsOff, switches }: { sectionsOff: ReadonlySet<string>; switches: { workbook: boolean } }) {
  const people = useLoad<{ users: Person[] }>(() => api("/users"));
  const list = useLoad<PermList>(() => api("/users/permissions"));
  const stats = useLoad<{ people: { id: string; last_seen: string | null; last_login: string | null }[] }>(() => api("/settings/stats"));
  const lastUsed = (id: string) => { const r = stats.data?.people.find((x) => x.id === id); return r ? (r.last_seen ?? r.last_login) : undefined; };
  const unused = (id: string) => { const l = lastUsed(id); return stats.data ? !l || Date.now() - Date.parse(l) > 30 * 86400_000 : false; };
  async function suspend(p: Person, on: boolean) {
    if (on && !window.confirm(t("Suspend {name}? They are signed out everywhere and can't sign in until you turn them back on. Nothing they made is deleted.", { name: p.name }))) return;
    try {
      await api(`/users/${encodeURIComponent(p.id)}`, { method: "PATCH", body: { status: on ? "disabled" : "active" } });
      toast(on ? t("{name} is suspended.", { name: p.name }) : t("{name} can sign in again.", { name: p.name }));
      people.reload();
    } catch (x) {
      toast((x as Error).message);
    }
  }
  const names = useLoad<{ roles: Record<string, string> }>(() => api("/users/roles"));
  const roleName = (id: string) => (id === "admin" ? t("Admin") : roleDisplayName(id, names.data?.roles[id] ?? id));
  const [pick, setPick] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [review, setReview] = useState(false);

  const staff = useMemo(() => (people.data?.users ?? []).filter((p) => !p.removed_at), [people.data]);
  const shown = staff.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const person = staff.find((p) => p.id === pick) ?? null;
  if (!people.data || !list.data) return <div className="muted" aria-busy="true">{t("Loading…")}</div>;
  const groups = list.data.groups.filter((g) => g.perms.some((p) => p.adjustable));

  return (
    <div className="stack">
      <div className="row wrap" style={{ gap: 8 }}>
        <input type="search" placeholder={t("Find a person")} aria-label={t("Find a person")} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
        <span className="spacer" />
        <button className={`btn small${review ? " on" : ""}`} aria-pressed={review} onClick={() => setReview(!review)}>{t("Who has what (whole team)")}</button>
        <button className="btn small" onClick={() => downloadCsv(staff, groups)}>{t("Download as a spreadsheet")}</button>
      </div>

      {review ? (
        <div className="tbl">
          <table className="access-review">
            <thead><tr><th>{t("Name")}</th><th>{t("Role")}</th><th>{t("Last used")}</th>{groups.map((g) => <th key={g.group}>{t(g.group)}</th>)}</tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td><button className="linklike" onClick={() => { setPick(p.id); setReview(false); }}><b>{p.name}</b></button>{p.status !== "active" && <> <span className="pill p-acc">{t("disabled")}</span></>}</td>
                  <td>{roleName(p.role)}</td>
                  <td className={unused(p.id) ? "lvl-stale" : ""}>{lastUsed(p.id) ? fmtTime(lastUsed(p.id)!) : t("Not yet")}{unused(p.id) && <> · {t("unused 30+ days")}</>}</td>
                  {groups.map((g) => {
                    const level = levelOf(p, g.perms);
                    return <td key={g.group} className={`lvl lvl-${level}`}>{levelLabel(level)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="access-center">
          <ul className="access-people" aria-label={t("People")}>
            {shown.map((p) => (
              <li key={p.id}>
                <button className={`access-person${p.id === pick ? " on" : ""}`} aria-current={p.id === pick || undefined} onClick={() => setPick(p.id)}>
                  <b>{p.name}</b>
                  <small className="muted">{p.status !== "active" ? `${t("Suspended")} · ` : ""}{roleName(p.role)}{Object.keys(p.access).length ? ` · ${t("{n} change(s)", { n: Object.keys(p.access).length })}` : ""}</small>
                </button>
              </li>
            ))}
          </ul>
          <div className="stack" style={{ minWidth: 0 }}>
            {!person && <p className="muted">{t("Pick a person to switch each page's functions on or off for them.")}</p>}
            {person && person.role === "admin" && <p className="muted">{t("Admins always have everything. Change their role on People first.")}</p>}
            {person && person.role !== "admin" && (
              <>
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className="muted">{lastUsed(person.id) ? t("Last used the portal {when}", { when: fmtTime(lastUsed(person.id)!) }) : t("Hasn't used the portal yet")}{unused(person.id) && <b className="lvl-stale"> · {t("unused 30+ days")}</b>}</span>
                  <span className="spacer" />
                  {person.status === "active"
                    ? <button className="btn small danger" onClick={() => suspend(person, true)}>{t("Suspend login")}</button>
                    : <button className="btn small primary" onClick={() => suspend(person, false)}>{t("Turn login back on")}</button>}
                </div>
                <div className="access-sees">
                  <span className="muted">{t("Pages {name} sees:", { name: person.name })}</span>{" "}
                  {menuFor(new Set(person.permissions), switches).map((n) => <span key={n.to} className="pill">{t(n.label)}</span>)}
                </div>
                <Access key={person.id} inline person={person} roleName={roleName(person.role)} list={list.data} people={staff} sectionsOff={sectionsOff} onSaved={people.reload} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Level = "all" | "some" | "view" | "none";
function levelOf(p: Person, perms: { id: string; adjustable: boolean; view: boolean }[]): Level {
  const has = new Set(p.permissions);
  const mine = perms.filter((x) => x.adjustable);
  const n = mine.filter((x) => has.has(x.id)).length;
  if (n === 0) return "none";
  if (n === mine.length) return "all";
  return mine.every((x) => !has.has(x.id) || x.view) ? "view" : "some";
}
const levelLabel = (l: Level) => ({ all: t("Everything"), some: t("Some"), view: t("View only"), none: "–" })[l];

function downloadCsv(people: Person[], groups: PermList["groups"]) {
  const perms = groups.flatMap((g) => g.perms.filter((p) => p.adjustable));
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    ["Name", "Role", "Status", ...perms.map((p) => p.label)].map(cell).join(","),
    ...people.map((p) => [p.name, p.role, p.status, ...perms.map((x) => (p.permissions.includes(x.id) ? (p.access[x.id] !== undefined ? "yes (changed)" : "yes") : p.access[x.id] === false ? "no (changed)" : "no"))].map(cell).join(",")),
  ];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\r\n")], { type: "text/csv" }));
  a.download = `portal-access-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

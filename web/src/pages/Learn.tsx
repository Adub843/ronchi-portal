// Portal training: how to use every part of the portal, for each person's own access, by function,
// and (for admins) by role. The guides live in ../learn/guides.ts.
// Not the machine Training Center (OPLs and how-tos for the machines); those are in the knowledge base.
import { useMemo, useState } from "react";
import { api, can, type Me } from "../api";
import { Link, PageHead, useLoad } from "../components/ui";
import { getLang, t } from "../i18n";
import { AREAS, GUIDES, guidesFor, inLang, rolesThatCan, type Guide, type Text } from "../learn/guides";
import { roleLabel } from "../roles";

type Tab = "me" | "function" | "role";
interface RoleInfo { id: string; name: string; perms: string[] }

const DONE_KEY = (id: string) => `ronchi.learn.done.${id}`;

function readDone(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY(userId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDone(userId: string, done: Set<string>) {
  try {
    localStorage.setItem(DONE_KEY(userId), JSON.stringify([...done]));
  } catch {
    /* storage blocked: progress lasts until reload */
  }
}

export function Learn({ me }: { me: Me }) {
  const isAdmin = can(me, "users.manage");
  const [tab, setTab] = useState<Tab>("me");
  const [q, setQ] = useState("");
  const [done, setDone] = useState(() => readDone(me.id));
  const [roleId, setRoleId] = useState("");
  const roles = useLoad<{ list?: RoleInfo[] }>(() => (isAdmin ? api("/users/roles") : Promise.resolve({})), [isAdmin]);
  const lang = getLang();
  const say = (x: Text) => inLang(x, lang);

  const mine = useMemo(() => new Set(guidesFor(me.permissions).map((g) => g.id)), [me.permissions]);
  const roleList = roles.data?.list ?? [];
  const role = roleList.find((r) => r.id === roleId) ?? roleList[0];
  const roleCan = useMemo(() => new Set(role ? guidesFor(role.perms).map((g) => g.id) : []), [role]);

  function toggleDone(id: string) {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
    saveDone(me.id, next);
  }

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (g: Guide) => {
    if (!words.length) return true;
    const hay = [g.title, g.summary, ...g.steps, ...(g.tip ? [g.tip] : [])].map(say).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  };

  // Which guides this tab lists.
  const shown = GUIDES.filter((g) => {
    if (tab === "me") return mine.has(g.id);
    if (tab === "role") return roleCan.has(g.id);
    return true;
  }).filter(matches);
  const myTotal = mine.size;
  const myDone = [...mine].filter((id) => done.has(id)).length;

  return (
    <>
      <PageHead
        title={t("Portal training")}
        sub={t("How to use every part of Ronchi Portal, step by step. For machine One Point Lessons and how-tos, use the knowledge base.")}
      />
      <div className="row learn-bar">
        <div className="seg" role="tablist" aria-label={t("Portal training")}>
          <button type="button" role="tab" aria-selected={tab === "me"} className={tab === "me" ? "on" : ""} onClick={() => setTab("me")}>{t("For me")}</button>
          <button type="button" role="tab" aria-selected={tab === "function"} className={tab === "function" ? "on" : ""} onClick={() => setTab("function")}>{t("By function")}</button>
          {isAdmin && <button type="button" role="tab" aria-selected={tab === "role"} className={tab === "role" ? "on" : ""} onClick={() => setTab("role")}>{t("By role")}</button>}
        </div>
        <input type="search" className="learn-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search the training")} aria-label={t("Search the training")} />
      </div>

      {tab === "me" && (
        <div className="panel learn-progress">
          <div>
            <b>{t("{n} of {total} guides done", { n: myDone, total: myTotal })}</b>
            <span className="muted"> · {t("These are the guides your access allows, as {role}.", { role: roleLabel(me.role) })}</span>
          </div>
          <progress max={myTotal || 1} value={myDone} aria-label={t("Your progress")} />
        </div>
      )}
      {tab === "function" && <p className="muted">{t("Every part of the portal. Guides marked Not in your access need a switch you don't have; ask an admin if your job needs it.")}</p>}
      {tab === "role" && (
        <div className="panel learn-progress">
          <div className="field">
            <label htmlFor="learn-role">{t("Show the training for")}</label>
            <select id="learn-role" value={role?.id ?? ""} onChange={(e) => setRoleId(e.target.value)}>
              {roleList.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.id) || r.name}</option>)}
            </select>
          </div>
          {role && <p className="muted">{t("{role} can follow {n} of {total} guides. Personal changes on People > Access can add or take away more.", { role: roleLabel(role.id) || role.name, n: roleCan.size, total: GUIDES.length })}</p>}
        </div>
      )}

      {AREAS.map((area) => {
        const list = shown.filter((g) => g.area === area.id);
        if (!list.length) return null;
        return (
          <section key={area.id} className="learn-area" aria-labelledby={`la-${area.id}`}>
            <h2 className="sec-title" id={`la-${area.id}`}>{say(area.title)}</h2>
            <p className="muted learn-blurb">{say(area.blurb)}</p>
            <div className="stack">
              {list.map((g) => {
                const allowed = mine.has(g.id);
                const isDone = done.has(g.id);
                const who = isAdmin ? rolesThatCan(g, roleList) : [];
                return (
                  <details key={g.id} className="panel learn-guide" id={`guide-${g.id}`}>
                    <summary>
                      <span className="learn-title">
                        <b>{say(g.title)}</b>
                        <span className="muted">{say(g.summary)}</span>
                      </span>
                      {isDone && allowed && <span className="pill p-ok">{t("Done")}</span>}
                      {!allowed && <span className="pill p-warn">{t("Not in your access")}</span>}
                    </summary>
                    <ol className="learn-steps">
                      {g.steps.map((s, i) => <li key={i}>{say(s)}</li>)}
                    </ol>
                    {g.tip && <p className="learn-tip"><b>{t("Tip")}:</b> {say(g.tip)}</p>}
                    {isAdmin && (
                      <p className="muted learn-who">
                        {t("Roles that can do this")}:{" "}
                        {who.length ? who.map((r) => roleLabel(r.id) || r.name).join(", ") : t("Only people given the switch on People > Access")}
                      </p>
                    )}
                    {allowed && (
                      <div className="row">
                        <Link to={g.open ?? area.paths[0]!} className="btn small">{t("Open the page")}</Link>
                        <button type="button" className="btn small" aria-pressed={isDone} onClick={() => toggleDone(g.id)}>
                          {isDone ? t("Mark as not done") : t("Mark as done")}
                        </button>
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          </section>
        );
      })}
      {!shown.length && <p className="empty">{t("No guides match. Try other words.")}</p>}
    </>
  );
}

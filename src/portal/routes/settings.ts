// Settings > Admin controls: read and change the portal-wide settings, see how the portal is used,
// and sign everyone out in an emergency. Admin only (settings.manage, which only admins can have).
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, requirePerm } from "../lib/http";
import { ASSIGNABLE, ROLES } from "../lib/roles";
import { LOCKED_RULES, SECTIONS } from "../lib/settings";
import { DEFAULTS, loadSettings, saveSettings } from "../lib/settings-store";

export const settings = new Hono<AppEnv>();

settings.get("/", async (c) => {
  requirePerm(c, "settings.manage");
  const current = await loadSettings(c.env.DB, true);
  const row = await c.env.DB.prepare("SELECT s.updated_at, u.name AS updated_by FROM settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1")
    .first<{ updated_at: string; updated_by: string | null }>()
    .catch(() => null);
  return c.json({
    settings: current,
    defaults: DEFAULTS(),
    permissions: ASSIGNABLE,
    roles: ROLES,
    sections: SECTIONS,
    locked: LOCKED_RULES,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  });
});

/** Save changes. Send only the groups (or fields) that changed; the rest stay as they are. */
settings.put("/", async (c) => {
  const admin = requirePerm(c, "settings.manage");
  const { settings: saved, error } = await saveSettings(c.env.DB, await body(c), { id: admin.id, ip: c.get("ip") });
  if (error) fail(400, error);
  return c.json({ settings: saved });
});

/** Put one group (or everything) back to how the portal started. */
settings.post("/reset", async (c) => {
  const admin = requirePerm(c, "settings.manage");
  const b = await body(c);
  const d = DEFAULTS();
  const group = typeof b.group === "string" ? b.group : null;
  if (group !== null && !(group in d)) fail(400, "Unknown group.");
  const input = group ? { [group]: d[group as keyof typeof d] } : d;
  const { settings: saved, error } = await saveSettings(c.env.DB, input, { id: admin.id, ip: c.get("ip") });
  if (error) fail(400, error);
  return c.json({ settings: saved });
});

/** How the portal is being used: logins, activity and content, for growing it. No money amounts. */
settings.get("/stats", async (c) => {
  requirePerm(c, "settings.manage");
  const db = c.env.DB;
  const t = Date.now();
  const since = (days: number) => new Date(t - days * 86400_000).toISOString();
  const n = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
  const [active, disabled, invites, seen7, seen30, posts30, chats, boards, machines, orders] = await Promise.all([
    n("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
    n("SELECT COUNT(*) AS n FROM users WHERE status = 'disabled'"),
    n("SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL AND user_id IS NULL AND expires_at > ?", now()),
    n("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at > ?", since(7)),
    n("SELECT COUNT(DISTINCT user_id) AS n FROM audit_log WHERE action = 'login' AND at > ?", since(30)),
    n("SELECT COUNT(*) AS n FROM posts WHERE kind = 'post' AND deleted_at IS NULL AND created_at > ?", since(30)),
    n("SELECT COUNT(*) AS n FROM boards WHERE kind = 'chat' AND archived_at IS NULL"),
    n("SELECT COUNT(*) AS n FROM boards WHERE kind = 'board' AND archived_at IS NULL"),
    n("SELECT COUNT(*) AS n FROM machines"),
    n("SELECT COUNT(*) AS n FROM cp_orders WHERE removed_at IS NULL"),
  ]);
  const people = await db.prepare(
    `SELECT u.id, u.name, u.role, u.status,
            (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
            (SELECT MAX(at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login') AS last_login,
            (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.kind = 'post' AND p.deleted_at IS NULL AND p.created_at > ?) AS posts30
       FROM users u ORDER BY u.name`,
  ).bind(since(30)).all();
  return c.json({ active, disabled, invites, seen7, seen30, posts30, chats, boards, machines, orders, people: people.results });
});

/** Emergency: sign out every device except this one (for example after a lost phone or a leaked link). */
settings.post("/sign-out-everyone", async (c) => {
  const admin = requirePerm(c, "settings.manage");
  const b = await body(c);
  if (b.confirm !== "SIGN OUT") fail(400, "Type SIGN OUT to confirm.");
  const r = await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash <> ?").bind(admin.sessionHash).run();
  const n = r.meta.changes ?? 0;
  await audit(c.env.DB, { userId: admin.id, action: "settings.sign_out_everyone", detail: { sessions: n }, ip: c.get("ip") });
  return c.json({ ok: true, sessions: n });
});

/** Emergency: cancel every invite link that hasn't been used yet. */
settings.post("/cancel-invites", async (c) => {
  const admin = requirePerm(c, "settings.manage");
  const r = await c.env.DB.prepare("UPDATE invites SET expires_at = ? WHERE used_at IS NULL AND expires_at > ?").bind(now(), now()).run();
  const n = r.meta.changes ?? 0;
  await audit(c.env.DB, { userId: admin.id, action: "settings.cancel_invites", detail: { invites: n }, ip: c.get("ip") });
  return c.json({ ok: true, invites: n });
});

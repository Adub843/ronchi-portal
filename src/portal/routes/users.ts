// People: invites, roles, disabling, and signing out devices.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, mustStr, requirePerm, requireUser } from "../lib/http";
import { createInvite } from "../lib/invites";
import { adjustable, effective, isPermission, isRole, PERMISSION_GROUPS, readChanges, VIEW_PERMS, type AccessChanges, type Permission } from "../lib/roles";
import { listRoles, roleExists, saveRole } from "../lib/role-store";
import { randomId } from "../../shared/crypto";
import { isEmail } from "../lib/mail";
import { endAllSessions } from "../lib/session";
import { getSettings } from "../lib/settings-store";
import { loginId } from "../../shared/login";

export const users = new Hono<AppEnv>();

/** Every role: built-in ones and the ones an admin made. `roles` is id -> name for pickers. */
users.get("/roles", async (c) => {
  const u = requireUser(c);
  const list = await listRoles(c.env.DB);
  return c.json({
    roles: Object.fromEntries(list.map((r) => [r.id, r.name])),
    // Names an admin typed (new roles and renamed built-ins), for labels around the app.
    named: Object.fromEntries(list.filter((r) => !r.builtIn || r.renamed).map((r) => [r.id, r.name])),
    list: has(u, "users.manage") ? list : undefined,
  });
});

function cleanPerms(value: unknown): Permission[] {
  if (!Array.isArray(value)) fail(400, "Send the list of switches.");
  for (const p of value) {
    if (!isPermission(p)) fail(400, `Unknown permission: ${String(p)}`);
    if (!adjustable(p)) fail(400, "Managing people and the audit log stay with admins.");
  }
  return value as Permission[];
}

async function nameTaken(db: D1Database, name: string, except?: string): Promise<boolean> {
  return (await listRoles(db)).some((r) => r.id !== except && r.name.trim().toLowerCase() === name.trim().toLowerCase());
}

/** Make a new role. It starts from another role's switches (copyFrom) or from the list sent. */
users.post("/roles", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const b = await body(c);
  const name = mustStr(b.name, 60, "Role name");
  if (await nameTaken(c.env.DB, name)) fail(409, "There's already a role with that name.");
  let perms: Permission[] = [];
  if (b.copyFrom !== undefined && b.copyFrom !== null && b.copyFrom !== "") {
    const from = (await listRoles(c.env.DB)).find((r) => r.id === b.copyFrom);
    if (!from) fail(400, "Unknown role to copy.");
    perms = from.perms.filter(adjustable);
  } else if (b.perms !== undefined) perms = cleanPerms(b.perms);
  const id = `r-${randomId().slice(0, 12)}`;
  await saveRole(c.env.DB, { id, name, perms, by: admin.id });
  await audit(c.env.DB, { userId: admin.id, action: "role.create", targetType: "role", targetId: id, detail: { name, perms }, ip: c.get("ip") });
  return c.json({ id });
});

/** Rename a role or change its switches. Applies to everyone with the role on their next click. */
users.patch("/roles/:id", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  if (id === "admin") fail(400, "The admin role always has everything.");
  const role = (await listRoles(c.env.DB)).find((r) => r.id === id);
  if (!role) fail(404, "Not found.");
  const b = await body(c);
  const name = b.name === undefined ? role.name : mustStr(b.name, 60, "Role name");
  if (name !== role.name && (await nameTaken(c.env.DB, name, id))) fail(409, "There's already a role with that name.");
  const perms = b.perms === undefined ? role.perms : cleanPerms(b.perms);
  await saveRole(c.env.DB, { id, name, perms, by: admin.id });
  await audit(c.env.DB, { userId: admin.id, action: "role.update", targetType: "role", targetId: id, detail: { before: { name: role.name, perms: role.perms }, after: { name, perms } }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Put a built-in role back to how it came. */
users.post("/roles/:id/reset", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  if (!isRole(id)) fail(400, "Only built-in roles can go back to how they came.");
  await c.env.DB.prepare("DELETE FROM roles WHERE id = ?").bind(id).run();
  await audit(c.env.DB, { userId: admin.id, action: "role.reset", targetType: "role", targetId: id, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Delete a role an admin made. Only when nobody has it and no invite uses it. */
users.delete("/roles/:id", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  if (isRole(id)) fail(400, "Built-in roles can't be deleted. You can change their switches instead.");
  const row = await c.env.DB.prepare("SELECT name FROM roles WHERE id = ?").bind(id).first<{ name: string }>();
  if (!row) fail(404, "Not found.");
  const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = ? AND removed_at IS NULL").bind(id).first<{ n: number }>();
  if (used?.n) fail(409, `${used.n} ${used.n === 1 ? "person has" : "people have"} this role. Give them another role first.`);
  const invited = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE role = ? AND used_at IS NULL AND expires_at > ?").bind(id, now()).first<{ n: number }>();
  if (invited?.n) fail(409, "An unused invite uses this role. Cancel it first.");
  await c.env.DB.prepare("DELETE FROM roles WHERE id = ?").bind(id).run();
  await audit(c.env.DB, { userId: admin.id, action: "role.delete", targetType: "role", targetId: id, detail: { name: row.name }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** The access screen's list: every permission in plain English, and what each role gives. */
users.get("/permissions", async (c) => {
  requirePerm(c, "users.manage");
  const byRole = Object.fromEntries((await listRoles(c.env.DB)).map((r) => [r.id, r.perms]));
  return c.json({ groups: PERMISSION_GROUPS.map((g) => ({ ...g, perms: g.perms.map((p) => ({ ...p, adjustable: adjustable(p.id), view: VIEW_PERMS.has(p.id) })) })), byRole });
});

async function changesFor(db: D1Database, userId: string): Promise<AccessChanges> {
  const r = await db.prepare("SELECT group_concat(perm || '=' || allow) AS list FROM user_access WHERE user_id = ?").bind(userId).first<{ list: string | null }>();
  return readChanges(r?.list);
}

/**
 * Switch single permissions on or off for one person, on top of their role.
 * Body: { changes: { "files.send": false, "orders.view": true, "kb.publish": null } }
 * true = on, false = off, null = back to what the role gives. { reset: true } clears them all.
 * It applies on their next click, so they aren't signed out.
 */
users.put("/:id/access", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  const b = await body(c);
  const target = await c.env.DB.prepare("SELECT u.id, u.name, u.role, (SELECT r.perms FROM roles r WHERE r.id = u.role) AS role_perms FROM users u WHERE u.id = ?").bind(id).first<{ id: string; name: string; role: string; role_perms: string | null }>();
  if (!target) fail(404, "Not found.");
  if (id === admin.id) fail(400, "You can't change your own access. Ask another admin.");
  if (target.role === "admin") fail(400, "Admins always have everything. Change their role first.");
  const before = await changesFor(c.env.DB, id);
  const at = now();
  const stmts: D1PreparedStatement[] = [];
  if (b.reset === true) {
    stmts.push(c.env.DB.prepare("DELETE FROM user_access WHERE user_id = ?").bind(id));
  } else {
    const changes = b.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) fail(400, "Nothing to change.");
    for (const [perm, on] of Object.entries(changes as Record<string, unknown>)) {
      if (!isPermission(perm)) fail(400, `Unknown permission: ${perm}`);
      if (!adjustable(perm)) fail(400, "Managing people and the audit log stay with admins. Make them an admin instead.");
      if (on === null) stmts.push(c.env.DB.prepare("DELETE FROM user_access WHERE user_id = ? AND perm = ?").bind(id, perm));
      else if (typeof on === "boolean") {
        stmts.push(c.env.DB.prepare(
          "INSERT INTO user_access (user_id, perm, allow, set_by, set_at) VALUES (?,?,?,?,?) ON CONFLICT (user_id, perm) DO UPDATE SET allow = excluded.allow, set_by = excluded.set_by, set_at = excluded.set_at",
        ).bind(id, perm, on ? 1 : 0, admin.id, at));
      } else fail(400, "Use on, off, or back to the role.");
    }
  }
  await c.env.DB.batch(stmts);
  const after = await changesFor(c.env.DB, id);
  await audit(c.env.DB, { userId: admin.id, action: "user.access", targetType: "user", targetId: id, detail: { before, after }, ip: c.get("ip") });
  return c.json({ changes: after, permissions: [...effective(target.role, after, target.role_perms)] });
});

/** Everyone (admin only). */
users.get("/", async (c) => {
  requirePerm(c, "users.manage");
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at, u.removed_at,
            (SELECT n.email FROM notice_emails n WHERE n.user_id = u.id) AS notify_email,
            (SELECT r.perms FROM roles r WHERE r.id = u.role) AS role_perms,
            (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
       FROM users u ORDER BY u.name`,
  ).all();
  const access = await c.env.DB.prepare("SELECT user_id, group_concat(perm || '=' || allow) AS list FROM user_access GROUP BY user_id").all<{ user_id: string; list: string }>();
  const changes = new Map(access.results.map((r) => [r.user_id, readChanges(r.list)]));
  const people = (results as { id: string; role: string; role_perms: string | null }[]).map(({ role_perms, ...u }) => {
    const own = u.role === "admin" ? {} : (changes.get(u.id) ?? {});
    return { ...u, access: own, permissions: [...effective(u.role, own, role_perms)] };
  });
  const pending = await c.env.DB.prepare(
    "SELECT id, email, name, role, expires_at FROM invites WHERE used_at IS NULL AND user_id IS NULL AND expires_at > ? ORDER BY created_at DESC",
  ).bind(now()).all();
  return c.json({ users: people, invites: pending.results });
});

/** Invite a new person. Returns the link once; it is never shown again. */
users.post("/invite", async (c) => {
  const admin = requirePerm(c, "users.manage");
  if (getSettings().people.invitesPaused) fail(403, "New invites are paused. Turn them back on in Settings > Admin controls.");
  const b = await body(c);
  // A work email or a plain username (Aaron, 2026-11-24: "just a username").
  const email = loginId(b.email);
  if (!email) fail(400, "Use a work email or a username of 3 to 40 letters or numbers, with no spaces.");
  const name = mustStr(b.name, 100, "Name");
  if (!(await roleExists(c.env.DB, b.role))) fail(400, "Pick a role.");
  const exists = await c.env.DB.prepare("SELECT removed_at FROM users WHERE email = ?").bind(email).first<{ removed_at: string | null }>();
  if (exists?.removed_at) fail(409, "This person was removed. Find them under Removed employees and press Restore.");
  if (exists) fail(409, "Someone with this email or username already has a login.");
  const link = await createInvite(c.env, { email, name, role: b.role as string, createdBy: admin.id });
  await audit(c.env.DB, { userId: admin.id, action: "invite.create", detail: { email, role: b.role }, ip: c.get("ip") });
  return c.json({ link });
});

/** Change a person's role, or disable them. */
users.patch("/:id", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  const b = await body(c);
  const target = await c.env.DB.prepare("SELECT id, role, status, removed_at FROM users WHERE id = ?").bind(id).first<{ id: string; role: string; status: string; removed_at: string | null }>();
  if (!target) fail(404, "Not found.");
  // A removed person comes back only through Restore, which also clears "removed".
  if (target.removed_at && (b.status !== undefined || b.role !== undefined)) fail(409, "This person was removed. Find them under Removed employees and press Restore.");
  if (id === admin.id && (b.status === "disabled" || (b.role !== undefined && b.role !== "admin"))) {
    fail(400, "You can't remove your own admin access. Ask another admin.");
  }
  const changes: Record<string, unknown> = {};
  if (b.role !== undefined) {
    if (!(await roleExists(c.env.DB, b.role))) fail(400, "Unknown role.");
    changes.role = b.role;
  }
  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "disabled") fail(400, "Unknown status.");
    changes.status = b.status;
  }
  // Where job emails go, for people whose login is a username (Aaron, 2026-11-25: field service
  // engineers get job emails). Kept in its own table (migration 0012); it doesn't sign anyone out.
  if (b.notify_email !== undefined) {
    const v = typeof b.notify_email === "string" ? b.notify_email.trim().toLowerCase() : "";
    if (v && !isEmail(v)) fail(400, "That email doesn't look right.");
    await (v
      ? c.env.DB.prepare("INSERT INTO notice_emails (user_id, email, set_by, set_at) VALUES (?,?,?,?) ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, set_by = excluded.set_by, set_at = excluded.set_at").bind(id, v, admin.id, now())
      : c.env.DB.prepare("DELETE FROM notice_emails WHERE user_id = ?").bind(id)).run();
    await audit(c.env.DB, { userId: admin.id, action: "user.notice_email", targetType: "user", targetId: id, detail: { email: v || null }, ip: c.get("ip") });
    if (!Object.keys(changes).length) return c.json({ ok: true });
  }
  if (!Object.keys(changes).length) fail(400, "Nothing to change.");
  const cols = Object.keys(changes);
  await c.env.DB.prepare(`UPDATE users SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((k) => changes[k]), now(), id)
    .run();
  // A role change or disabling signs them out everywhere, so the new rules apply at once.
  if (changes.role !== undefined || changes.status === "disabled") await endAllSessions(c.env.DB, id);
  await audit(c.env.DB, { userId: admin.id, action: "user.update", targetType: "user", targetId: id, detail: { before: target, after: changes }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Sign a person out on every device (lost phone). */
users.post("/:id/sign-out-everywhere", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  const n = await endAllSessions(c.env.DB, id);
  await audit(c.env.DB, { userId: admin.id, action: "user.sign_out_all", targetType: "user", targetId: id, detail: { sessions: n }, ip: c.get("ip") });
  return c.json({ ok: true, sessions: n });
});

/**
 * Remove someone who has left (Aaron, 2026-11-24: "i need to be able to add and remove employees").
 * They're signed out and can't sign in, and drop off the people lists. What they wrote (posts,
 * orders, notes, articles) keeps their name. Restore brings them back as they were.
 */
users.post("/:id/remove", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  if (id === admin.id) fail(400, "You can't remove yourself. Ask another admin.");
  const target = await c.env.DB.prepare("SELECT id, name, role, removed_at FROM users WHERE id = ?").bind(id).first<{ id: string; name: string; role: string; removed_at: string | null }>();
  if (!target) fail(404, "Not found.");
  if (target.role === "admin") fail(400, "Admins can't be removed. Change their role first.");
  if (target.removed_at) return c.json({ ok: true });
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET status = 'disabled', removed_at = ?, updated_at = ? WHERE id = ?").bind(t, t, id),
    // An unused "add a device" link for them stops working too.
    c.env.DB.prepare("UPDATE invites SET expires_at = ? WHERE user_id = ? AND used_at IS NULL").bind(t, id),
  ]);
  const sessions = await endAllSessions(c.env.DB, id);
  await audit(c.env.DB, { userId: admin.id, action: "user.remove", targetType: "user", targetId: id, detail: { name: target.name, role: target.role, sessions }, ip: c.get("ip") });
  return c.json({ ok: true });
});

users.post("/:id/restore", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  const target = await c.env.DB.prepare("SELECT id, name, role, removed_at FROM users WHERE id = ?").bind(id).first<{ id: string; name: string; role: string; removed_at: string | null }>();
  if (!target) fail(404, "Not found.");
  const b = await body(c);
  let role = target.role;
  if (typeof b.role === "string" && b.role) {
    if (!(await roleExists(c.env.DB, b.role))) fail(400, "Unknown role.");
    if (b.role === "admin") fail(400, "There is only one admin.");
    role = b.role;
  } else if (!(await roleExists(c.env.DB, role))) {
    fail(409, "Their old role was deleted. Pick a role for them, then press Restore.");
  }
  await c.env.DB.prepare("UPDATE users SET status = 'active', removed_at = NULL, role = ?, updated_at = ? WHERE id = ?").bind(role, now(), id).run();
  await audit(c.env.DB, { userId: admin.id, action: "user.restore", targetType: "user", targetId: id, detail: { name: target.name, role }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Cancel an unused invite. */
users.delete("/invites/:id", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE invites SET expires_at = ? WHERE id = ? AND used_at IS NULL").bind(now(), id).run();
  await audit(c.env.DB, { userId: admin.id, action: "invite.cancel", targetType: "invite", targetId: id, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---- My own account ----

users.get("/me/devices", async (c) => {
  const u = requireUser(c);
  const sessions = await c.env.DB.prepare("SELECT id_hash, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC").bind(u.id).all<{ id_hash: string; created_at: string; last_seen_at: string; user_agent: string }>();
  const passkeys = await c.env.DB.prepare("SELECT id, nickname, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at").bind(u.id).all();
  return c.json({
    // The session id is shortened so the full hash never leaves the server.
    sessions: sessions.results.map((s) => ({ id: s.id_hash.slice(0, 16), current: s.id_hash === u.sessionHash, created_at: s.created_at, last_seen_at: s.last_seen_at, user_agent: s.user_agent })),
    passkeys: passkeys.results,
  });
});

users.post("/me/sessions/:id/end", async (c) => {
  const u = requireUser(c);
  const prefix = c.req.param("id");
  if (!/^[0-9a-f]{16}$/.test(prefix)) fail(400, "Unknown device.");
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(id_hash, 1, 16) = ?").bind(u.id, prefix).run();
  await audit(c.env.DB, { userId: u.id, action: "session.end", ip: c.get("ip") });
  return c.json({ ok: true });
});

users.delete("/me/passkeys/:id", async (c) => {
  const u = requireUser(c);
  const id = c.req.param("id");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").bind(u.id).first<{ n: number }>();
  if ((count?.n ?? 0) <= 1) fail(400, "This is your only passkey. Add another device first.");
  const r = await c.env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").bind(id, u.id).run();
  if (!r.meta.changes) fail(404, "Not found.");
  await audit(c.env.DB, { userId: u.id, action: "passkey.remove", targetType: "passkey", targetId: id, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Recent audit log (admin). */
users.get("/audit/recent", async (c) => {
  requirePerm(c, "audit.view");
  const { results } = await c.env.DB.prepare(
    "SELECT a.at, a.action, a.target_type, a.target_id, a.detail, a.ip, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 200",
  ).all();
  return c.json({ entries: results });
});

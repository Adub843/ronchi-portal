// People: invites, roles, disabling, and signing out devices.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, mustStr, requirePerm, requireUser } from "../lib/http";
import { createInvite } from "../lib/invites";
import { isRole, ROLES } from "../lib/roles";
import { endAllSessions } from "../lib/session";

export const users = new Hono<AppEnv>();

users.get("/roles", (c) => {
  requireUser(c);
  return c.json({ roles: ROLES });
});

/** Everyone (admin only). */
users.get("/", async (c) => {
  requirePerm(c, "users.manage");
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.status, u.can_type_address, u.created_at,
            (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
       FROM users u ORDER BY u.name`,
  ).all();
  const pending = await c.env.DB.prepare(
    "SELECT id, email, name, role, expires_at FROM invites WHERE used_at IS NULL AND user_id IS NULL AND expires_at > ? ORDER BY created_at DESC",
  ).bind(now()).all();
  return c.json({ users: results, invites: pending.results });
});

/** Invite a new person. Returns the link once; it is never shown again. */
users.post("/invite", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const b = await body(c);
  const email = mustStr(b.email, 200, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "That email doesn't look right.");
  const name = mustStr(b.name, 100, "Name");
  if (!isRole(b.role)) fail(400, "Pick a role.");
  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) fail(409, "Someone with this email already has a login.");
  const link = await createInvite(c.env, { email, name, role: b.role, canTypeAddress: b.canTypeAddress === true, createdBy: admin.id });
  await audit(c.env.DB, { userId: admin.id, action: "invite.create", detail: { email, role: b.role }, ip: c.get("ip") });
  return c.json({ link });
});

/** Change a person's role, typed-address option, or disable them. */
users.patch("/:id", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const id = c.req.param("id");
  const b = await body(c);
  const target = await c.env.DB.prepare("SELECT id, role, status, can_type_address FROM users WHERE id = ?").bind(id).first<{ id: string; role: string; status: string; can_type_address: number }>();
  if (!target) fail(404, "Not found.");
  if (id === admin.id && (b.status === "disabled" || (b.role !== undefined && b.role !== "admin"))) {
    fail(400, "You can't remove your own admin access. Ask another admin.");
  }
  const changes: Record<string, unknown> = {};
  if (b.role !== undefined) {
    if (!isRole(b.role)) fail(400, "Unknown role.");
    changes.role = b.role;
  }
  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "disabled") fail(400, "Unknown status.");
    changes.status = b.status;
  }
  if (b.canTypeAddress !== undefined) {
    changes.can_type_address = b.canTypeAddress === true ? 1 : 0;
    if (!changes.can_type_address) changes.address_mode = 0; // taking the option away also ends the mode
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

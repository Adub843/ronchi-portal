// Signed-in sessions.
// The browser gets a random 256-bit token in an HttpOnly, Secure, SameSite=Strict cookie.
// Only the SHA-256 hash of the token is stored, so a copy of the database can't be used to sign in.
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, sha256Hex } from "../../shared/crypto";
import type { AppEnv, SessionUser } from "../env";
import { addSeconds, now } from "./db";

const ABSOLUTE_LIFETIME = 30 * 24 * 3600; // signed out after 30 days no matter what
const IDLE_LIFETIME = 14 * 24 * 3600;     // or after 14 days without use

/** "__Host-" cookies must be Secure, on "/", with no Domain. Local http dev can't use that prefix. */
export function cookieName(origin: string): string {
  return origin.startsWith("https://") ? "__Host-rp_session" : "rp_session";
}

export async function startSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken();
  const t = now();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(await sha256Hex(token), userId, t, t, addSeconds(t, ABSOLUTE_LIFETIME), (c.req.header("user-agent") ?? "").slice(0, 200), c.get("ip"))
    .run();
  setCookie(c, cookieName(c.env.ORIGIN), token, {
    httpOnly: true,
    secure: c.env.ORIGIN.startsWith("https://"),
    sameSite: "Strict",
    path: "/",
    maxAge: ABSOLUTE_LIFETIME,
  });
}

export async function loadSession(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, cookieName(c.env.ORIGIN));
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id_hash, s.last_seen_at, s.expires_at, u.id, u.email, u.name, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
  )
    .bind(hash)
    .first<{ id_hash: string; last_seen_at: string; expires_at: string; id: string; email: string; name: string; role: SessionUser["role"]; status: string }>();
  if (!row) return null;
  const t = now();
  const idleExpired = Date.parse(row.last_seen_at) + IDLE_LIFETIME * 1000 < Date.parse(t);
  if (row.status !== "active" || row.expires_at < t || idleExpired) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(hash).run();
    return null;
  }
  // Refresh "last seen" at most every 5 minutes to keep writes low.
  if (Date.parse(t) - Date.parse(row.last_seen_at) > 5 * 60 * 1000) {
    await c.env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").bind(t, hash).run();
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, sessionHash: hash };
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const user = c.get("user");
  if (user) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(user.sessionHash).run();
  deleteCookie(c, cookieName(c.env.ORIGIN), { path: "/", secure: c.env.ORIGIN.startsWith("https://") });
}

/** Sign a person out on every device (used when they're disabled, or lose a phone). */
export async function endAllSessions(db: D1Database, userId: string): Promise<number> {
  const r = await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  return r.meta.changes ?? 0;
}

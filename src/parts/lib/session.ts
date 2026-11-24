// Customer sessions: same design as the staff portal (random token in an HttpOnly, Secure,
// SameSite=Strict cookie; only its SHA-256 hash is stored).
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, sha256Hex } from "../../shared/crypto";
import type { Customer, PartsApp } from "../env";
import { addSeconds, now } from "./http";

const ABSOLUTE_LIFETIME = 30 * 24 * 3600;
const IDLE_LIFETIME = 14 * 24 * 3600;

export function cookieName(origin: string): string {
  return origin.startsWith("https://") ? "__Host-rpp_session" : "rpp_session";
}

export async function startSession(c: Context<PartsApp>, userId: string): Promise<void> {
  const token = randomToken();
  const t = now();
  await c.env.PARTS_DB.prepare("INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?,?,?,?,?,?,?)")
    .bind(await sha256Hex(token), userId, t, t, addSeconds(t, ABSOLUTE_LIFETIME), (c.req.header("user-agent") ?? "").slice(0, 200), c.get("ip"))
    .run();
  setCookie(c, cookieName(c.env.ORIGIN), token, { httpOnly: true, secure: c.env.ORIGIN.startsWith("https://"), sameSite: "Strict", path: "/", maxAge: ABSOLUTE_LIFETIME });
}

export async function loadSession(c: Context<PartsApp>): Promise<Customer | null> {
  const token = getCookie(c, cookieName(c.env.ORIGIN));
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await c.env.PARTS_DB.prepare(
    `SELECT s.last_seen_at, s.expires_at, u.id, u.company_id, u.email, u.name, u.role, u.status, co.name AS company_name, co.status AS company_status
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies co ON co.id = u.company_id WHERE s.id_hash = ?`,
  ).bind(hash).first<{ last_seen_at: string; expires_at: string; id: string; company_id: string; email: string; name: string; role: Customer["role"]; status: string; company_name: string; company_status: string }>();
  if (!row) return null;
  const t = now();
  const idle = Date.parse(row.last_seen_at) + IDLE_LIFETIME * 1000 < Date.parse(t);
  if (row.status !== "active" || row.company_status !== "active" || row.expires_at < t || idle) {
    await c.env.PARTS_DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(hash).run();
    return null;
  }
  if (Date.parse(t) - Date.parse(row.last_seen_at) > 5 * 60 * 1000) {
    await c.env.PARTS_DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").bind(t, hash).run();
  }
  return { id: row.id, companyId: row.company_id, companyName: row.company_name, email: row.email, name: row.name, role: row.role, sessionHash: hash };
}

export async function endSession(c: Context<PartsApp>): Promise<void> {
  const u = c.get("user");
  if (u) await c.env.PARTS_DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(u.sessionHash).run();
  deleteCookie(c, cookieName(c.env.ORIGIN), { path: "/", secure: c.env.ORIGIN.startsWith("https://") });
}

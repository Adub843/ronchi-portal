import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomId } from "../../shared/crypto";
import type { Customer, PartsApp } from "../env";

export function fail(status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429, message: string): never {
  throw new HTTPException(status, { res: Response.json({ error: message }, { status }) });
}

export function requireCustomer(c: Context<PartsApp>): Customer {
  const u = c.get("user");
  if (!u) fail(401, "Please sign in.");
  return u;
}

export function requireBuyer(c: Context<PartsApp>): Customer {
  const u = requireCustomer(c);
  if (u.role !== "buyer") fail(403, "Only your company's buyer can send quote requests. Share a list with them instead.");
  return u;
}

export async function body(c: Context<PartsApp>): Promise<Record<string, unknown>> {
  try {
    const data = await c.req.json();
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  if (t.length > max) fail(400, `Too long (limit ${max} characters).`);
  return t;
}

export function mustStr(value: unknown, max: number, what: string): string {
  const s = str(value, max);
  if (!s) fail(400, `${what} is required.`);
  return s;
}

/** A quantity: a positive number with at most 3 decimals (pipe is sold by the meter). */
export function qty(value: unknown): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 100000) fail(400, "Enter a quantity above zero.");
  return Math.round(n * 1000) / 1000;
}

export function now(): string {
  return new Date().toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

export async function audit(
  db: D1Database,
  e: { userId?: string | null; companyId?: string | null; action: string; target?: string; detail?: unknown; ip?: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (id, at, user_id, company_id, action, target, detail, ip) VALUES (?,?,?,?,?,?,?,?)")
    .bind(randomId(), now(), e.userId ?? null, e.companyId ?? null, e.action, e.target ?? null, e.detail === undefined ? null : JSON.stringify(e.detail), e.ip ?? null)
    .run();
}

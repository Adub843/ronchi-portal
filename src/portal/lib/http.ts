import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, SessionUser } from "../env";
import { can, type Permission } from "./roles";

/** Stop with a plain error the app can show. */
export function fail(status: 400 | 401 | 403 | 404 | 409 | 410 | 429, message: string): never {
  throw new HTTPException(status, { res: Response.json({ error: message }, { status }) });
}

/** The signed-in person, or a 401. */
export function requireUser(c: Context<AppEnv>): SessionUser {
  const user = c.get("user");
  if (!user) fail(401, "Please sign in.");
  return user;
}

/** The signed-in person, and only if their role allows `perm`. */
export function requirePerm(c: Context<AppEnv>, perm: Permission): SessionUser {
  const user = requireUser(c);
  if (!can(user.role, perm)) fail(403, "Your role doesn't allow this.");
  return user;
}

/** Read a JSON body safely. Anything that isn't a JSON object becomes {}. */
export async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const data = await c.req.json();
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A trimmed string field with a length limit, or null when empty. */
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

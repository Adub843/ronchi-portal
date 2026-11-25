import { randomId, randomToken, sha256Hex } from "../../shared/crypto";
import type { Env } from "../env";
import { addSeconds, now } from "./db";
import { getSettings } from "./settings-store";

/**
 * Make a one-time invite link. Only the hash of the token is stored; the link itself
 * is shown once to the person who made it. The token sits after "#" so it never
 * reaches server logs.
 */
export async function createInvite(
  env: Env,
  o: { email: string; name: string; role: string; createdBy: string | null; userId?: string; hours?: number },
): Promise<string> {
  const token = randomToken();
  const t = now();
  await env.DB.prepare(
    "INSERT INTO invites (id, email, name, role, token_hash, created_by, created_at, expires_at, user_id) VALUES (?,?,?,?,?,?,?,?,?)",
  )
    .bind(randomId(), o.email, o.name, o.role, await sha256Hex(token), o.createdBy, t, addSeconds(t, (o.hours ?? getSettings().people.inviteHours) * 3600), o.userId ?? null)
    .run();
  return `${env.ORIGIN}/welcome#${token}`;
}

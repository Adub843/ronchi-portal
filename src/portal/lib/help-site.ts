// The portal's one-way door into the customer help center (Worker ronchi-help).
// It goes through the HELP service binding with the publish key; the help center cannot call back.
import type { Env } from "../env";
import { fail } from "./http";

export function helpSiteReady(env: Env): boolean {
  return !!env.HELP && !!env.HELP_ADMIN_KEY;
}

/** Put an article on the help center, or take it off (body undefined). */
export async function helpCall(env: Env, number: string, body?: unknown): Promise<void> {
  if (!env.HELP || !env.HELP_ADMIN_KEY) fail(503, "The customer help center isn't connected yet. See REBUILD.md, step \"Help center\".");
  // The host name is ignored by a service binding; it only has to be a valid URL.
  const res = await env.HELP.fetch(`https://ronchi-help.internal/admin/articles/${encodeURIComponent(number)}`, {
    method: body === undefined ? "DELETE" : "PUT",
    headers: { authorization: `Bearer ${env.HELP_ADMIN_KEY}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 404) fail(502, "The customer help center refused the call. Check its publish key.");
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    fail(502, data.error ?? "The customer help center didn't answer. Try again.");
  }
}

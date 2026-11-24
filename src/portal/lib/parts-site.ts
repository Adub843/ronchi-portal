// The portal's one-way door into the customer parts site (Worker ronchi-parts).
// It goes through the PARTS service binding with the publish key; the parts site cannot call back.
import type { Env } from "../env";
import { fail } from "./http";

export function partsSiteReady(env: Env): boolean {
  return !!env.PARTS && !!env.PARTS_ADMIN_KEY;
}

/** Call the parts site's /admin API. Its errors come back as the same plain messages. */
export async function partsCall<T = any>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; raw?: BodyInit; type?: string } = {},
): Promise<T> {
  if (!env.PARTS || !env.PARTS_ADMIN_KEY) fail(503, "The customer parts site isn't connected yet. See REBUILD.md, step \"Parts site\".");
  const headers: Record<string, string> = { authorization: `Bearer ${env.PARTS_ADMIN_KEY}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.type) headers["content-type"] = init.type;
  const method = init.method ?? (init.body === undefined && init.raw === undefined ? "GET" : "POST");
  // The host name is ignored by a service binding; it only has to be a valid URL.
  const res = await env.PARTS.fetch(`https://ronchi-parts.internal/admin${path}`, {
    method,
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    if (res.status === 404 && !data?.error) fail(502, "The customer parts site refused the call. Check its publish key.");
    const status = [400, 404, 409, 410, 413].includes(res.status) ? (res.status as 400) : 502;
    fail(status, data?.error ?? "The customer parts site didn't answer. Try again.");
  }
  return data as T;
}

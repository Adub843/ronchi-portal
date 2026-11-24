// Every call to the portal's API goes through here.
// The X-Ronchi header (with the browser's Origin) is how the server knows a change
// came from these pages and not from another website.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // Only ever call this portal's own /api, never a path that could climb out of it.
  if (!path.startsWith("/") || path.startsWith("//") || /(^|\/)\.\.(\/|$)|[\\#\s]/.test(path)) throw new ApiError(400, "Bad request.");
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-Ronchi": "1" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "Something went wrong.");
  return data as T;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  canTypeAddress: boolean;
  permissions: string[];
}

export const can = (me: Me | null, perm: string) => !!me?.permissions.includes(perm);

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

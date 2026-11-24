import { loc } from "./i18n";

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

/** Send a message with files (photos, documents). Same protections as api(). */
export async function apiForm<T = any>(path: string, form: FormData): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || /(^|\/)\.\.(\/|$)|[\\#\s]/.test(path)) throw new ApiError(400, "Bad request.");
  const res = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", headers: { "X-Ronchi": "1" }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? (res.status === 413 ? "Those files are too big to send together." : "Something went wrong."));
  return data as T;
}

/** A file's address: shown inside the chat (photos) or downloaded. */
export function fileUrl(f: { id: string; url?: string }, download = false): string {
  if (f.url) return f.url; // the preview keeps files in this browser
  return `/api/files/${encodeURIComponent(f.id)}${download ? "?download=1" : ""}`;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

export const can = (me: Me | null, perm: string) => !!me?.permissions.includes(perm);

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(loc(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(loc(), { weekday: "short", month: "short", day: "numeric" });
}

/** Upload one file as the whole request body (catalog drawings and 3D models). Same protections as api(). */
export async function apiPut<T = any>(path: string, file: Blob, type: string): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || /(^|\/)\.\.(\/|$)|[\\#\s]/.test(path)) throw new ApiError(400, "Bad request.");
  const res = await fetch(`/api${path}`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": type, "X-Ronchi": "1" }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? "Something went wrong.");
  return data as T;
}

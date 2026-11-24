// Every call to the parts site's API goes through here. The X-Ronchi header (with the
// browser's Origin) is how the server knows a change came from these pages.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
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
  role: "standard" | "buyer";
  company: string;
}

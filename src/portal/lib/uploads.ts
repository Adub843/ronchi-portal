// Taking in files from a form (photos and paperwork on parts orders and shipments), the same safe way
// the chats and jobs do it: safe types only (src/shared/files.ts), 25 MB each, stored in R2 first and
// recorded only once every file is stored.
import type { Context } from "hono";
import { randomId } from "../../shared/crypto";
import { cleanName, fileInfo, fileProblem, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_BYTES } from "../../shared/files";
import type { AppEnv, SessionUser } from "../env";
import { fail, has } from "./http";

export interface Stored { id: string; name: string; ext: string; size: number }

/** Read the form, check every file, and put them in R2 under `${prefix}/<id>`. Returns the stored files and the other form fields. */
export async function storeUploads(c: Context<AppEnv>, u: SessionUser, prefix: string, meta: Record<string, string>): Promise<{ stored: Stored[]; form: FormData }> {
  if (!has(u, "files.send")) fail(403, "You can't add photos or files. Ask an admin.");
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    fail(400, "The upload didn't come through. Try again.");
  }
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) fail(400, "Choose a file to add.");
  if (files.length > MAX_FILES_PER_MESSAGE) fail(400, `Add up to ${MAX_FILES_PER_MESSAGE} files at a time.`);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_MESSAGE_BYTES) fail(400, "Those files are too big to add together. Add them in two goes.");
  for (const f of files) {
    const problem = fileProblem(f.name, f.size);
    if (problem) fail(400, `${cleanName(f.name)}: ${problem}`);
  }
  const list = files.map((f) => ({ id: randomId(), file: f, name: cleanName(f.name), info: fileInfo(f.name)! }));
  try {
    for (const s of list) await c.env.FILES.put(`${prefix}/${s.id}`, s.file.stream(), { httpMetadata: { contentType: s.info.type }, customMetadata: { ...meta, by: u.id } });
  } catch (e) {
    await Promise.all(list.map((s) => c.env.FILES.delete(`${prefix}/${s.id}`).catch(() => undefined)));
    throw e;
  }
  return { stored: list.map((s) => ({ id: s.id, name: s.name, ext: s.info.ext, size: s.file.size })), form };
}

/** The next number for a kind of document this year: Q-2026-0007, SO-2026-0012, IN-..., OUT-... */
export async function nextNumber(db: D1Database, prefix: "Q" | "SO" | "IN" | "OUT", at = new Date()): Promise<string> {
  const kind = `${prefix}-${at.getUTCFullYear()}`;
  const row = await db.prepare("INSERT INTO doc_numbers (kind, n) VALUES (?, 1) ON CONFLICT (kind) DO UPDATE SET n = n + 1 RETURNING n").bind(kind).first<{ n: number }>();
  return `${kind}-${String(row!.n).padStart(4, "0")}`;
}

/** An item's history from the audit log, newest first. */
export async function historyOf(db: D1Database, type: string, id: string) {
  const { results } = await db.prepare(
    `SELECT a.at, a.action, a.detail, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.target_type = ? AND a.target_id = ? ORDER BY a.at DESC LIMIT 300`,
  ).bind(type, id).all<{ at: string; action: string; detail: string | null; who: string | null }>();
  return results.map((h) => {
    let detail: Record<string, unknown> | null = null;
    try { detail = h.detail ? JSON.parse(h.detail) : null; } catch { detail = null; }
    return { at: h.at, action: h.action, who: h.who, detail };
  });
}

export const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

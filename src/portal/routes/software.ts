// Software downloads (Aaron, 2026-11-25): "a pop-up ... contains all of the files and exe files ...
// you select which ones you want and you hit download, and then it downloads all of them onto your
// PC at one time instead of people having to go out and look for each piece of software at a website."
//
// A package (e.g. "New laptop setup", "Allen-Bradley (legacy)") holds files, each in a folder path
// inside the package. People with software.manage make packages and upload; everyone with
// software.view opens a package and downloads. Licensed vendor installers stay behind the staff
// sign-in: nothing here is ever published to the customer sites.
//
// Installers are big (often several GB), and Cloudflare takes at most 100 MB per request, so a file
// comes in as a multipart upload: start it, send it in PART_BYTES pieces, then finish it. Until it's
// finished the file isn't listed or downloadable. Files are kept in the FILES bucket at software/<id>.
// Downloads stream straight from the bucket (no copying through the Worker's memory) and honour
// Range requests, so a browser can resume a big download.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import { cleanFolder, MAX_SOFTWARE_BYTES, PART_BYTES, softwareFileName } from "../../shared/software";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, mustStr, requirePerm, str } from "../lib/http";

export const software = new Hono<AppEnv>();

interface PackageRow { id: string; name: string; description: string | null; legacy: number; position: number; updated_at: string; files?: number; size?: number }
interface FileRow { id: string; package_id: string; folder: string; name: string; size: number; upload_id: string | null; ready_at: string | null }

const key = (fileId: string) => `software/${fileId}`;

function shapePackage(p: PackageRow) {
  return { id: p.id, name: p.name, description: p.description ?? "", legacy: !!p.legacy, files: p.files ?? 0, size: p.size ?? 0, updated_at: p.updated_at };
}

async function loadPackage(db: D1Database, id: string): Promise<PackageRow> {
  const p = await db.prepare("SELECT * FROM software_packages WHERE id = ? AND archived_at IS NULL").bind(id).first<PackageRow>();
  if (!p) fail(404, "Not found.");
  return p;
}

async function loadFile(db: D1Database, id: string): Promise<FileRow> {
  const f = await db.prepare(
    "SELECT f.* FROM software_files f JOIN software_packages p ON p.id = f.package_id WHERE f.id = ? AND f.deleted_at IS NULL AND p.archived_at IS NULL",
  ).bind(id).first<FileRow>();
  if (!f) fail(404, "Not found.");
  return f;
}

// ---------- Reading and downloading (software.view) ----------

software.get("/", async (c) => {
  requirePerm(c, "software.view");
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, COUNT(f.id) AS files, COALESCE(SUM(f.size), 0) AS size
       FROM software_packages p
       LEFT JOIN software_files f ON f.package_id = p.id AND f.deleted_at IS NULL AND f.ready_at IS NOT NULL
      WHERE p.archived_at IS NULL
      GROUP BY p.id ORDER BY p.legacy, p.position, p.name`,
  ).all<PackageRow>();
  return c.json({ packages: results.map(shapePackage) });
});

software.get("/files/:id", async (c) => {
  requirePerm(c, "software.view");
  const f = await loadFile(c.env.DB, c.req.param("id"));
  if (!f.ready_at) fail(404, "Not found.");
  const range = parseRange(c.req.header("range"), f.size);
  const obj = await c.env.FILES.get(key(f.id), range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!obj) fail(404, "Not found.");
  const name = softwareFileName(f.name);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  const headers: Record<string, string> = {
    // Always a download, whatever the file is. Nothing here is ever shown or run inside the portal.
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Content-Length": String(range ? range.end - range.start + 1 : f.size),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${f.size}`;
  return new Response(obj.body, { status: range ? 206 : 200, headers });
});

/** "bytes=a-b", "bytes=a-" or "bytes=-n" for one range inside the file; anything else means the whole file. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (!m[1] && !m[2]) || size === 0) return null;
  let start: number, end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

software.get("/:id", async (c) => {
  requirePerm(c, "software.view");
  const p = await loadPackage(c.env.DB, c.req.param("id"));
  const { results } = await c.env.DB.prepare(
    "SELECT id, folder, name, size, ready_at FROM software_files WHERE package_id = ? AND deleted_at IS NULL AND ready_at IS NOT NULL ORDER BY folder, name",
  ).bind(p.id).all<FileRow>();
  const size = results.reduce((n, f) => n + f.size, 0);
  return c.json({ package: shapePackage({ ...p, files: results.length, size }), files: results.map((f) => ({ id: f.id, folder: f.folder, name: f.name, size: f.size })) });
});

// ---------- Packages (software.manage) ----------

software.post("/", async (c) => {
  const u = requirePerm(c, "software.manage");
  const b = await body(c);
  const id = randomId();
  const at = now();
  const pos = await c.env.DB.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM software_packages").first<{ n: number }>();
  await c.env.DB.prepare("INSERT INTO software_packages (id, name, description, legacy, position, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, mustStr(b.name, 120, "A name"), str(b.description, 500), b.legacy === true ? 1 : 0, pos?.n ?? 1, u.id, at, at).run();
  await audit(c.env.DB, { userId: u.id, action: "software.package.create", targetType: "software_package", targetId: id, ip: c.get("ip") });
  return c.json({ id });
});

software.patch("/:id", async (c) => {
  const u = requirePerm(c, "software.manage");
  const p = await loadPackage(c.env.DB, c.req.param("id"));
  const b = await body(c);
  const name = b.name === undefined ? p.name : mustStr(b.name, 120, "A name");
  const description = b.description === undefined ? p.description : str(b.description, 500);
  const legacy = b.legacy === undefined ? p.legacy : b.legacy === true ? 1 : 0;
  await c.env.DB.prepare("UPDATE software_packages SET name = ?, description = ?, legacy = ?, updated_at = ? WHERE id = ?")
    .bind(name, description, legacy, now(), p.id).run();
  await audit(c.env.DB, { userId: u.id, action: "software.package.update", targetType: "software_package", targetId: p.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

software.delete("/:id", async (c) => {
  const u = requirePerm(c, "software.manage");
  const p = await loadPackage(c.env.DB, c.req.param("id"));
  const { results } = await c.env.DB.prepare("SELECT id, upload_id FROM software_files WHERE package_id = ? AND deleted_at IS NULL").bind(p.id).all<FileRow>();
  for (const f of results) await removeStored(c.env.FILES, f);
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE software_files SET deleted_at = ? WHERE package_id = ? AND deleted_at IS NULL").bind(at, p.id),
    c.env.DB.prepare("UPDATE software_packages SET archived_at = ? WHERE id = ?").bind(at, p.id),
  ]);
  await audit(c.env.DB, { userId: u.id, action: "software.package.remove", targetType: "software_package", targetId: p.id, detail: { files: results.length }, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---------- Uploading (software.manage) ----------

/** Start a file: returns its id and the size each part must be. */
software.post("/:id/files", async (c) => {
  const u = requirePerm(c, "software.manage");
  const p = await loadPackage(c.env.DB, c.req.param("id"));
  const b = await body(c);
  const name = softwareFileName(mustStr(b.name, 255, "A file name"));
  const folder = cleanFolder(b.folder);
  if (folder === null) fail(400, "That folder name can't be used.");
  const size = Number(b.size);
  if (!Number.isSafeInteger(size) || size <= 0) fail(400, "That file is empty.");
  if (size > MAX_SOFTWARE_BYTES) fail(413, "Files can be up to 50 GB each.");
  const id = randomId();
  const upload = await c.env.FILES.createMultipartUpload(key(id), { httpMetadata: { contentType: "application/octet-stream" } });
  await c.env.DB.prepare("INSERT INTO software_files (id, package_id, folder, name, size, upload_id, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, p.id, folder, name, size, upload.uploadId, u.id, now()).run();
  return c.json({ id, partBytes: PART_BYTES, parts: Math.ceil(size / PART_BYTES) });
});

/** One piece of a file, as the raw request body. */
software.put("/files/:id/parts/:n", async (c) => {
  requirePerm(c, "software.manage");
  const f = await loadFile(c.env.DB, c.req.param("id"));
  if (!f.upload_id) fail(409, "That file is already finished.");
  const n = Number(c.req.param("n"));
  const parts = Math.ceil(f.size / PART_BYTES);
  if (!Number.isInteger(n) || n < 1 || n > parts) fail(400, "That part number is outside the file.");
  const expected = n < parts ? PART_BYTES : f.size - PART_BYTES * (parts - 1);
  const data = await c.req.arrayBuffer();
  if (data.byteLength !== expected) fail(400, `That part should be ${expected} bytes.`);
  const part = await c.env.FILES.resumeMultipartUpload(key(f.id), f.upload_id).uploadPart(n, data);
  return c.json({ n, etag: part.etag });
});

software.post("/files/:id/complete", async (c) => {
  const u = requirePerm(c, "software.manage");
  const f = await loadFile(c.env.DB, c.req.param("id"));
  if (!f.upload_id) fail(409, "That file is already finished.");
  const b = await body(c);
  const raw = Array.isArray(b.parts) ? (b.parts as { n?: unknown; etag?: unknown }[]) : [];
  const parts = raw.map((p) => ({ partNumber: Number(p.n), etag: String(p.etag ?? "") })).sort((a, b2) => a.partNumber - b2.partNumber);
  if (parts.length !== Math.ceil(f.size / PART_BYTES) || parts.some((p, i) => p.partNumber !== i + 1 || !p.etag)) fail(400, "Some parts of the file are missing. Upload it again.");
  const obj = await c.env.FILES.resumeMultipartUpload(key(f.id), f.upload_id).complete(parts);
  if (obj.size !== f.size) {
    await c.env.FILES.delete(key(f.id));
    await c.env.DB.prepare("UPDATE software_files SET deleted_at = ? WHERE id = ?").bind(now(), f.id).run();
    fail(400, "The uploaded file isn't the size it should be. Upload it again.");
  }
  await c.env.DB.prepare("UPDATE software_files SET upload_id = NULL, ready_at = ? WHERE id = ?").bind(now(), f.id).run();
  await c.env.DB.prepare("UPDATE software_packages SET updated_at = ? WHERE id = ?").bind(now(), f.package_id).run();
  await audit(c.env.DB, { userId: u.id, action: "software.file.upload", targetType: "software_file", targetId: f.id, detail: { name: f.name, folder: f.folder, size: f.size }, ip: c.get("ip") });
  return c.json({ ok: true });
});

software.delete("/files/:id", async (c) => {
  const u = requirePerm(c, "software.manage");
  const f = await loadFile(c.env.DB, c.req.param("id"));
  await removeStored(c.env.FILES, f);
  await c.env.DB.prepare("UPDATE software_files SET deleted_at = ? WHERE id = ?").bind(now(), f.id).run();
  await audit(c.env.DB, { userId: u.id, action: "software.file.remove", targetType: "software_file", targetId: f.id, detail: { name: f.name }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Take a file out of the bucket, or call off its upload if it never finished. */
async function removeStored(bucket: R2Bucket, f: Pick<FileRow, "id" | "upload_id">) {
  if (f.upload_id) {
    await bucket.resumeMultipartUpload(key(f.id), f.upload_id).abort().catch(() => undefined);
  } else {
    await bucket.delete(key(f.id));
  }
}

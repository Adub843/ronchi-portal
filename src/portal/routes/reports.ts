// The Ronchi workbook's job paperwork (Aaron, 2026-11-25): on each job's work order, every field service
// engineer keeps their own time sheet and service report, and the job has a chat for the people on it.
// Reviewers (reports.review: scheduling, service, managers, admins) see everyone's and approve them or
// send them back with a note. This replaces the old standalone "Ronchi Field Service Workbook" app.
//
// Rules, all checked here:
//  - The workbook switch (lib/switches.ts) off = everything here answers "Not found".
//  - Section "reports" off (Command center) = reports.write and reports.review are gone for non-admins.
//  - An engineer sees and changes only their own paperwork; reviewers see all of it but don't edit it.
//  - Only drafts and sheets sent back can change. Approved ones are locked until a reviewer sends them back.
//  - No money amounts (expenses have no amount) and no clock: times are typed paperwork.
//  - Text is stored as typed and always shown as text by the app, never as HTML.
//
// The app saves as people type (each field on its own), so the change routes take one field at a time.
// Every change bumps the "reports" live topic (index.ts), so other people's open pages reload in place.
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import { toCsv } from "../../shared/csv";
import { cleanName, fileInfo, fileProblem, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_BYTES } from "../../shared/files";
import { addDays, cleanReport, cleanRow, DOC_STATUSES, fmtHours, isChildKind, isRealDate, next, REPORT_MAX, sheetTotals, workMinutes, type ChildKind, type DocAction, type DocStatus } from "../../shared/reports";
import type { AppEnv, SessionUser } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requireUser } from "../lib/http";
import { openJobChat, jobChatId } from "../lib/job-chat";
import { serveFile } from "../lib/serve-file";
import { isOn } from "../lib/switches";

export const reports = new Hono<AppEnv>();

type Kind = "sheet" | "service";
const TABLE: Record<Kind, string> = { sheet: "time_sheets", service: "service_reports" };
const KIND_OF_PATH: Record<string, Kind> = { sheets: "sheet", service: "service" };
const CHILD: Record<ChildKind, { table: string; doc: Kind; fk: string; order: string; date: string | null }> = {
  days: { table: "time_days", doc: "sheet", fk: "sheet_id", order: "work_date, created_at", date: "work_date" },
  expenses: { table: "time_expenses", doc: "sheet", fk: "sheet_id", order: "exp_date, created_at", date: "exp_date" },
  log: { table: "report_log", doc: "service", fk: "report_id", order: "work_date, created_at", date: "work_date" },
  parts: { table: "report_parts", doc: "service", fk: "report_id", order: "kind DESC, created_at", date: null },
};
// Sanity caps on rows per paperwork (a job is at most 90 days).
const MAX_ROWS: Record<ChildKind, number> = { days: 120, expenses: 300, log: 120, parts: 300 };
const MAX_PHOTOS = 60;

interface Doc { id: string; job_id: string; user_id: string; status: DocStatus; review_note: string | null; sent_at: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string; updated_at: string; [k: string]: unknown }
interface JobRow { id: string; job_number: string; customer: string; machine: string | null; location: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null; work_days: string; first_day: string | null; last_day: string | null; status: string; created_by: string | null }

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
const user = (c: Context<AppEnv>) => c.get("user")!;
const reviewer = (u: SessionUser) => has(u, "reports.review");

// Every route: the workbook must be on, then the person needs one of the two workbook permissions.
reports.use("*", async (c, next) => {
  if (!(await isOn(c.env.DB, "workbook"))) fail(404, "Not found.");
  const u = requireUser(c);
  if (!has(u, "reports.write") && !has(u, "reports.review")) fail(403, "Your role doesn't allow this.");
  await next();
});

// ---- Loading, with the access rules ----

async function loadJob(db: D1Database, id: string): Promise<JobRow> {
  const job = await db.prepare("SELECT id, job_number, customer, machine, location, contact_name, contact_phone, contact_email, work_days, first_day, last_day, status, created_by FROM jobs WHERE id = ?").bind(id).first<JobRow>();
  if (!job) fail(404, "Not found.");
  return job;
}

async function jobFor(db: D1Database, id: string) {
  const job = await loadJob(db, id);
  const { results: techs } = await db.prepare("SELECT u.id, u.name FROM job_techs t JOIN users u ON u.id = t.user_id WHERE t.job_id = ? ORDER BY u.name").bind(id).all<{ id: string; name: string }>();
  const { created_by: _c, ...rest } = job;
  return { ...rest, work_days: JSON.parse(job.work_days || "[]") as string[], techs };
}

const onJob = async (db: D1Database, jobId: string, userId: string) => !!(await db.prepare("SELECT 1 FROM job_techs WHERE job_id = ? AND user_id = ?").bind(jobId, userId).first());

/** A time sheet or service report this person may see: their own, or anyone's for a reviewer. Otherwise "Not found". */
async function loadDoc(db: D1Database, kind: Kind, id: string, u: SessionUser): Promise<Doc> {
  const doc = await db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ?`).bind(id).first<Doc>();
  if (!doc || (doc.user_id !== u.id && !reviewer(u))) fail(404, "Not found.");
  return doc;
}

/** Only the engineer who owns it, and only while it is a draft or sent back. */
function mustEdit(doc: Doc, u: SessionUser) {
  if (doc.user_id !== u.id) fail(403, "Only the field service engineer who wrote this can change it.");
  if (!has(u, "reports.write")) fail(403, "Your role doesn't allow this.");
  if (doc.status === "sent") fail(409, "This was sent for review. Take it back to make changes.");
  if (doc.status === "approved") fail(409, "This is approved and locked. A reviewer can send it back if it needs a change.");
}

const touch = (db: D1Database, kind: Kind, id: string, at = now()) => db.prepare(`UPDATE ${TABLE[kind]} SET updated_at = ? WHERE id = ?`).bind(at, id);

function docKind(c: Context<AppEnv>): Kind {
  const k = KIND_OF_PATH[c.req.param("kind") ?? ""];
  if (!k) fail(404, "Not found.");
  return k;
}

// ---- Building the answers ----

interface FileRow { id: string; doc_kind: Kind; doc_id: string; purpose: string; row_id: string | null; name: string; ext: string; size: number; caption: string | null; created_at: string }

async function filesFor(db: D1Database, kind: Kind, docId: string): Promise<FileRow[]> {
  const { results } = await db.prepare("SELECT id, doc_kind, doc_id, purpose, row_id, name, ext, size, caption, created_at FROM report_files WHERE doc_kind = ? AND doc_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid").bind(kind, docId).all<FileRow>();
  return results;
}

async function rows(db: D1Database, child: ChildKind, docId: string) {
  const s = CHILD[child];
  return (await db.prepare(`SELECT * FROM ${s.table} WHERE ${s.fk} = ? ORDER BY ${s.order}`).bind(docId).all<Record<string, unknown>>()).results;
}

async function nameOf(db: D1Database, id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await db.prepare("SELECT name FROM users WHERE id = ?").bind(id).first<{ name: string }>())?.name ?? null;
}

async function fullSheet(db: D1Database, doc: Doc) {
  const [days, expenses, files, userName, reviewerName] = await Promise.all([rows(db, "days", doc.id), rows(db, "expenses", doc.id), filesFor(db, "sheet", doc.id), nameOf(db, doc.user_id), nameOf(db, doc.reviewed_by)]);
  const dayRows = days.map((d) => ({ ...d, work_min: workMinutes(d as never) }));
  return {
    ...doc, user_name: userName, reviewer_name: reviewerName,
    days: dayRows,
    expenses: expenses.map((e) => ({ ...e, receipt: files.find((f) => f.purpose === "receipt" && f.row_id === e.id) ?? null })),
    totals: sheetTotals(days as never),
  };
}

async function fullReport(db: D1Database, doc: Doc) {
  const [log, parts, files, userName, reviewerName] = await Promise.all([rows(db, "log", doc.id), rows(db, "parts", doc.id), filesFor(db, "service", doc.id), nameOf(db, doc.user_id), nameOf(db, doc.reviewed_by)]);
  return {
    report: { ...doc, user_name: userName, reviewer_name: reviewerName, signature: files.find((f) => f.purpose === "signature" && f.id === doc.signature_file_id) ?? null },
    log, parts,
    photos: files.filter((f) => f.purpose === "photo"),
  };
}

// ---- One job's paperwork (the work order's Time sheet, Service report and Job chat tabs) ----

reports.get("/jobs/:jobId", async (c) => {
  const u = user(c);
  const db = c.env.DB;
  const job = await jobFor(db, c.req.param("jobId"));
  const all = reviewer(u);
  const where = all ? "job_id = ?" : "job_id = ? AND user_id = ?";
  const args = all ? [job.id] : [job.id, u.id];
  const [{ results: sheets }, { results: reps }] = await Promise.all([
    db.prepare(`SELECT * FROM time_sheets WHERE ${where}`).bind(...args).all<Doc>(),
    db.prepare(`SELECT * FROM service_reports WHERE ${where}`).bind(...args).all<Doc>(),
  ]);
  const mine = job.techs.some((t) => t.id === u.id);
  const jobRow = await loadJob(db, job.id);
  return c.json({
    job,
    sheets: await Promise.all(sheets.map((s) => fullSheet(db, s))),
    reports: await Promise.all(reps.map((r) => fullReport(db, r))),
    canStart: mine && has(u, "reports.write"),
    canReview: all,
    chat: await (async () => {
      const id = await jobChatId(db, job.id);
      const member = !!id && !!(await db.prepare("SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?").bind(id, u.id).first());
      return { id: member ? id : null, member, canOpen: has(u, "boards.use") && (mine || jobRow.created_by === u.id || has(u, "jobs.schedule")) };
    })(),
  });
});

/** Start this engineer's time sheet and service report for the job (both, once; later calls return them). */
reports.post("/jobs/:jobId/start", async (c) => {
  const u = user(c);
  const db = c.env.DB;
  const job = await loadJob(db, c.req.param("jobId"));
  if (!has(u, "reports.write") || !(await onJob(db, job.id, u.id))) fail(403, "Only the field service engineers on this job can fill in its paperwork.");
  const at = now();
  const made = await db.batch([
    db.prepare("INSERT OR IGNORE INTO time_sheets (id, job_id, user_id, created_at, updated_at) VALUES (?,?,?,?,?)").bind(randomId(), job.id, u.id, at, at),
    db.prepare("INSERT OR IGNORE INTO service_reports (id, job_id, user_id, created_at, updated_at) VALUES (?,?,?,?,?)").bind(randomId(), job.id, u.id, at, at),
  ]);
  const sheet = await db.prepare("SELECT id FROM time_sheets WHERE job_id = ? AND user_id = ?").bind(job.id, u.id).first<{ id: string }>();
  const report = await db.prepare("SELECT id FROM service_reports WHERE job_id = ? AND user_id = ?").bind(job.id, u.id).first<{ id: string }>();
  if (made.some((r) => r.meta.changes)) await audit(db, { userId: u.id, action: "report.start", targetType: "job", targetId: job.id, ip: c.get("ip") });
  return c.json({ sheetId: sheet!.id, reportId: report!.id });
});

/** Open the job's chat (made on first open). The engineers on the job, its scheduler and anyone who schedules jobs. */
reports.post("/jobs/:jobId/chat", async (c) => {
  const u = user(c);
  const db = c.env.DB;
  const job = await loadJob(db, c.req.param("jobId"));
  const allowed = has(u, "boards.use") && (job.created_by === u.id || has(u, "jobs.schedule") || (await onJob(db, job.id, u.id)));
  if (!allowed) fail(403, "Only the people on this job can open its chat.");
  const r = await openJobChat(db, job, u);
  await audit(db, { userId: u.id, action: r.created ? "job.chat.create" : "job.chat.open", targetType: "chat", targetId: r.id, detail: { job: job.id }, ip: c.get("ip") });
  return c.json({ id: r.id });
});

// ---- Reviewers: the queue and the hours export ----

interface Filters { status: DocStatus | "all"; userId: string | null; q: string; week: string | null }
function filters(c: Context<AppEnv>, fallback: DocStatus | "all"): Filters {
  const s = c.req.query("status") ?? fallback;
  const status = s === "all" || (DOC_STATUSES as readonly string[]).includes(s) ? (s as Filters["status"]) : fallback;
  const week = c.req.query("week");
  return { status, userId: c.req.query("user") || null, q: (c.req.query("q") ?? "").trim().slice(0, 100), week: isRealDate(week) ? week : null };
}

/** WHERE parts for the queue and export. `alias` is the paperwork table; sheets match a week by their days, reports by the job's days. */
function where(f: Filters, alias: string, kind: Kind) {
  const w: string[] = [];
  const a: unknown[] = [];
  if (f.status !== "all") { w.push(`${alias}.status = ?`); a.push(f.status); }
  if (f.userId) { w.push(`${alias}.user_id = ?`); a.push(f.userId); }
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    w.push("(j.job_number LIKE ? ESCAPE '\\' OR j.customer LIKE ? ESCAPE '\\' OR j.machine LIKE ? ESCAPE '\\')");
    a.push(like, like, like);
  }
  if (f.week) {
    const end = addDays(f.week, 6);
    if (kind === "sheet") w.push(`EXISTS (SELECT 1 FROM time_days d WHERE d.sheet_id = ${alias}.id AND d.work_date BETWEEN ? AND ?)`);
    else w.push("(j.first_day <= ? AND j.last_day >= ?)");
    a.push(...(kind === "sheet" ? [f.week, end] : [end, f.week]));
  }
  return { sql: w.length ? `WHERE ${w.join(" AND ")}` : "", args: a };
}

async function daysOf(db: D1Database, sheetIds: string[]) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < sheetIds.length; i += 90) {
    const ids = sheetIds.slice(i, i + 90);
    out.push(...(await db.prepare(`SELECT * FROM time_days WHERE sheet_id IN (${marks(ids.length)}) ORDER BY work_date, created_at`).bind(...ids).all<Record<string, unknown>>()).results);
  }
  return out;
}

const QUEUE_COLS = (a: string) => `${a}.id, ${a}.job_id, ${a}.user_id, ${a}.status, ${a}.review_note, ${a}.sent_at, ${a}.reviewed_at, ${a}.updated_at,
  u.name AS user_name, r.name AS reviewer_name, j.job_number, j.customer, j.machine, j.first_day, j.last_day`;

function requireReview(c: Context<AppEnv>): SessionUser {
  const u = user(c);
  if (!reviewer(u)) fail(403, "Your role doesn't allow this.");
  return u;
}

reports.get("/queue", async (c) => {
  requireReview(c);
  const db = c.env.DB;
  const f = filters(c, "sent");
  const kindQ = c.req.query("kind");
  const out: Record<string, unknown>[] = [];
  for (const kind of ["sheet", "service"] as Kind[]) {
    if (kindQ && kindQ !== kind) continue;
    const w = where(f, "s", kind);
    const { results } = await db.prepare(
      `SELECT ${QUEUE_COLS("s")} FROM ${TABLE[kind]} s JOIN users u ON u.id = s.user_id JOIN jobs j ON j.id = s.job_id LEFT JOIN users r ON r.id = s.reviewed_by
        ${w.sql} ORDER BY COALESCE(s.sent_at, s.updated_at) DESC LIMIT 500`,
    ).bind(...w.args).all<Record<string, unknown> & { id: string }>();
    if (kind === "sheet") {
      const days = await daysOf(db, results.map((r) => r.id));
      for (const r of results) {
        const mine = days.filter((d) => d.sheet_id === r.id);
        out.push({ ...r, kind, hours: sheetTotals(mine as never), dates: [mine[0]?.work_date ?? null, mine.at(-1)?.work_date ?? null] });
      }
    } else {
      for (const r of results) out.push({ ...r, kind, hours: null, dates: [r.first_day ?? null, r.last_day ?? null] });
    }
  }
  out.sort((a, b) => String(b.sent_at ?? b.updated_at).localeCompare(String(a.sent_at ?? a.updated_at)));
  // The people with any paperwork, for the engineer filter.
  const { results: people } = await db.prepare(
    "SELECT DISTINCT u.id, u.name FROM users u WHERE u.id IN (SELECT user_id FROM time_sheets UNION SELECT user_id FROM service_reports) ORDER BY u.name",
  ).all<{ id: string; name: string }>();
  const counts = Object.fromEntries(await Promise.all(DOC_STATUSES.map(async (s) => {
    const n = await db.prepare("SELECT (SELECT COUNT(*) FROM time_sheets WHERE status = ?1) + (SELECT COUNT(*) FROM service_reports WHERE status = ?1) AS n").bind(s).first<{ n: number }>();
    return [s, n?.n ?? 0];
  })));
  return c.json({ items: out, people, counts });
});

/** Hours as a spreadsheet, one line per day worked. No money columns. */
reports.get("/export", async (c) => {
  const u = requireReview(c);
  const db = c.env.DB;
  const f = filters(c, "all");
  const w = where(f, "s", "sheet");
  const { results: sheets } = await db.prepare(
    `SELECT ${QUEUE_COLS("s")} FROM time_sheets s JOIN users u ON u.id = s.user_id JOIN jobs j ON j.id = s.job_id LEFT JOIN users r ON r.id = s.reviewed_by
      ${w.sql} ORDER BY u.name, j.first_day LIMIT 2000`,
  ).bind(...w.args).all<Record<string, string | null> & { id: string }>();
  const days = await daysOf(db, sheets.map((s) => s.id));
  const end = f.week ? addDays(f.week, 6) : null;
  const STATUS: Record<string, string> = { draft: "Draft", sent: "Waiting for review", approved: "Approved", returned: "Sent back" };
  const lines: unknown[][] = [];
  for (const s of sheets) {
    for (const d of days.filter((x) => x.sheet_id === s.id)) {
      const date = String(d.work_date);
      if (f.week && (date < f.week || date > end!)) continue;
      const work = workMinutes(d as never);
      lines.push([s.user_name, s.job_number, s.customer, s.machine ?? "", date, d.start_time ?? "", d.end_time ?? "", d.break_min, fmtHours(work), d.billable ? fmtHours(work) : "0.00", d.billable ? "0.00" : fmtHours(work), fmtHours(Number(d.travel_min)), fmtHours(Number(d.production_min)), d.notes ?? "", STATUS[String(s.status)] ?? s.status, s.reviewer_name ?? ""]);
    }
  }
  await audit(db, { userId: u.id, action: "reports.export", detail: { ...f, lines: lines.length }, ip: c.get("ip") });
  const csv = toCsv(["Field service engineer", "Job number", "Customer", "Machine", "Date", "Start", "End", "Break (min)", "Work hours", "Billable hours", "Non-billable hours", "Travel hours", "Production hours", "Notes", "Status", "Reviewed by"], lines);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Ronchi hours${f.week ? ` week of ${f.week}` : ""}.csv"` } });
});

// ---- Files (receipts, photos, signatures) ----

reports.get("/files/:fileId", async (c) => {
  const u = user(c);
  const db = c.env.DB;
  const f = await db.prepare("SELECT id, doc_kind, doc_id, name FROM report_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; doc_kind: Kind; doc_id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  await loadDoc(db, f.doc_kind, f.doc_id, u); // same rule as the paperwork it belongs to
  return serveFile(c.env.FILES, `reports/${f.id}`, f.name, { download: c.req.query("download") !== undefined });
});

async function readFiles(c: Context<AppEnv>, field: string): Promise<File[]> {
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    fail(400, "The upload didn't come through. Try again.");
  }
  return form.getAll(field).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
}

/** Check, store in R2 and record files for a time sheet or report. All go in, or none do. */
async function storeFiles(c: Context<AppEnv>, doc: Doc, kind: Kind, files: File[], purpose: "receipt" | "photo" | "signature", opts: { rowId?: string; images?: boolean } = {}) {
  const u = user(c);
  if (!has(u, "files.send")) fail(403, "You can't add photos or files. Ask an admin.");
  if (!files.length) fail(400, "Choose a file to add.");
  if (files.length > MAX_FILES_PER_MESSAGE) fail(400, `Add up to ${MAX_FILES_PER_MESSAGE} files at a time.`);
  if (files.reduce((n, f) => n + f.size, 0) > MAX_MESSAGE_BYTES) fail(400, "Those files are too big to add together. Add them in two goes.");
  for (const f of files) {
    const problem = fileProblem(f.name, f.size);
    if (problem) fail(400, `${cleanName(f.name)}: ${problem}`);
    const info = fileInfo(f.name)!;
    if (opts.images && info.kind !== "image" && info.ext !== "heic" && info.ext !== "heif" && !(purpose === "receipt" && info.kind === "pdf")) fail(400, `${cleanName(f.name)}: Add a photo (JPG, PNG, HEIC) or a PDF.`);
  }
  const at = now();
  const stored = files.map((f) => ({ id: randomId(), file: f, name: cleanName(f.name), info: fileInfo(f.name)! }));
  try {
    for (const s of stored) await c.env.FILES.put(`reports/${s.id}`, s.file.stream(), { httpMetadata: { contentType: s.info.type }, customMetadata: { doc: doc.id, by: u.id } });
  } catch (e) {
    await Promise.all(stored.map((s) => c.env.FILES.delete(`reports/${s.id}`).catch(() => undefined)));
    throw e;
  }
  const add = c.env.DB.prepare("INSERT INTO report_files (id, doc_kind, doc_id, purpose, row_id, user_id, name, ext, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  await c.env.DB.batch([...stored.map((s) => add.bind(s.id, kind, doc.id, purpose, opts.rowId ?? null, u.id, s.name, s.info.ext, s.file.size, at)), touch(c.env.DB, kind, doc.id, at)]);
  await audit(c.env.DB, { userId: u.id, action: `report.${purpose}.add`, targetType: kind, targetId: doc.id, detail: { names: stored.map((s) => s.name) }, ip: c.get("ip") });
  return stored.map((s) => s.id);
}

async function removeFiles(c: Context<AppEnv>, kind: Kind, doc: Doc, where: string, ...args: unknown[]) {
  const db = c.env.DB;
  const { results } = await db.prepare(`SELECT id, name FROM report_files WHERE doc_kind = ? AND doc_id = ? AND deleted_at IS NULL AND ${where}`).bind(kind, doc.id, ...args).all<{ id: string; name: string }>();
  if (!results.length) return 0;
  const at = now();
  await db.batch([...results.map((f) => db.prepare("UPDATE report_files SET deleted_at = ? WHERE id = ?").bind(at, f.id)), touch(db, kind, doc.id, at)]);
  await Promise.all(results.map((f) => c.env.FILES.delete(`reports/${f.id}`).catch(() => undefined)));
  await audit(db, { userId: user(c).id, action: "report.file.remove", targetType: kind, targetId: doc.id, detail: { names: results.map((f) => f.name) }, ip: c.get("ip") });
  return results.length;
}

reports.post("/sheets/:id/expenses/:rowId/receipt", async (c) => {
  const u = user(c);
  const doc = await loadDoc(c.env.DB, "sheet", c.req.param("id"), u);
  mustEdit(doc, u);
  const row = await c.env.DB.prepare("SELECT id FROM time_expenses WHERE id = ? AND sheet_id = ?").bind(c.req.param("rowId"), doc.id).first<{ id: string }>();
  if (!row) fail(404, "Not found.");
  const files = (await readFiles(c, "files")).slice(0, 1);
  // One receipt per expense: a new photo replaces the old one.
  const ids = await storeFiles(c, doc, "sheet", files, "receipt", { rowId: row.id, images: true });
  await removeFiles(c, "sheet", doc, "purpose = 'receipt' AND row_id = ? AND id != ?", row.id, ids[0]);
  return c.json({ id: ids[0] });
});

reports.delete("/sheets/:id/expenses/:rowId/receipt", async (c) => {
  const u = user(c);
  const doc = await loadDoc(c.env.DB, "sheet", c.req.param("id"), u);
  mustEdit(doc, u);
  await removeFiles(c, "sheet", doc, "purpose = 'receipt' AND row_id = ?", c.req.param("rowId"));
  return c.json({ ok: true });
});

reports.post("/service/:id/photos", async (c) => {
  const u = user(c);
  const doc = await loadDoc(c.env.DB, "service", c.req.param("id"), u);
  mustEdit(doc, u);
  const files = await readFiles(c, "files");
  const have = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM report_files WHERE doc_kind = 'service' AND doc_id = ? AND purpose = 'photo' AND deleted_at IS NULL").bind(doc.id).first<{ n: number }>())!.n;
  if (have + files.length > MAX_PHOTOS) fail(400, `A report can have up to ${MAX_PHOTOS} photos.`);
  return c.json({ ids: await storeFiles(c, doc, "service", files, "photo", { images: true }) });
});

reports.patch("/service/:id/photos/:fileId", async (c) => {
  const u = user(c);
  const db = c.env.DB;
  const doc = await loadDoc(db, "service", c.req.param("id"), u);
  mustEdit(doc, u);
  const b = await body(c);
  if (b.caption !== null && typeof b.caption !== "string") fail(400, "Caption must be text.");
  const caption = ((b.caption as string | null) ?? "").replace(/\s+/g, " ").trim();
  if (caption.length > REPORT_MAX.caption) fail(400, `Caption is too long (limit ${REPORT_MAX.caption} characters).`);
  const r = await db.prepare("UPDATE report_files SET caption = ? WHERE id = ? AND doc_kind = 'service' AND doc_id = ? AND purpose = 'photo' AND deleted_at IS NULL").bind(caption || null, c.req.param("fileId"), doc.id).run();
  if (!r.meta.changes) fail(404, "Not found.");
  await touch(db, "service", doc.id).run();
  await audit(db, { userId: u.id, action: "report.photo.caption", targetType: "service", targetId: doc.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

reports.delete("/service/:id/photos/:fileId", async (c) => {
  const u = user(c);
  const doc = await loadDoc(c.env.DB, "service", c.req.param("id"), u);
  mustEdit(doc, u);
  if (!(await removeFiles(c, "service", doc, "purpose = 'photo' AND id = ?", c.req.param("fileId")))) fail(404, "Not found.");
  return c.json({ ok: true });
});

/** The customer's signature, drawn on the screen and sent as a PNG. A new one replaces the old one. */
reports.post("/service/:id/signature", async (c) => {
  const u = user(c);
  const db = c.env.DB;
  const doc = await loadDoc(db, "service", c.req.param("id"), u);
  mustEdit(doc, u);
  const [file] = await readFiles(c, "file");
  if (!file) fail(400, "Draw the signature first.");
  if (fileInfo(file.name)?.ext !== "png" || file.size > 2 * 1024 * 1024) fail(400, "The signature must be a PNG picture under 2 MB.");
  const [id] = await storeFiles(c, doc, "service", [new File([file], "signature.png", { type: "image/png" })], "signature");
  await db.prepare("UPDATE service_reports SET signature_file_id = ?, signed_on = COALESCE(signed_on, ?) WHERE id = ?").bind(id, now().slice(0, 10), doc.id).run();
  await removeFiles(c, "service", doc, "purpose = 'signature' AND id != ?", id);
  return c.json({ id });
});

reports.delete("/service/:id/signature", async (c) => {
  const u = user(c);
  const db = c.env.DB;
  const doc = await loadDoc(db, "service", c.req.param("id"), u);
  mustEdit(doc, u);
  await db.prepare("UPDATE service_reports SET signature_file_id = NULL WHERE id = ?").bind(doc.id).run();
  await removeFiles(c, "service", doc, "purpose = 'signature'");
  return c.json({ ok: true });
});

// ---- Review steps ----

const NEEDS_REVIEW: Record<DocAction, boolean> = { send: false, recall: false, approve: true, return: true };
const ACTIONS = new Set<string>(["send", "recall", "approve", "return"]);

reports.post("/:kind/:id/:action{send|recall|approve|return}", async (c) => {
  const kind = docKind(c);
  const action = c.req.param("action") as DocAction;
  if (!ACTIONS.has(action)) fail(404, "Not found.");
  const u = user(c);
  const db = c.env.DB;
  const doc = await loadDoc(db, kind, c.req.param("id"), u);
  const b = await body(c);
  if (NEEDS_REVIEW[action]) {
    if (!reviewer(u)) fail(403, "Your role doesn't allow this.");
  } else if (doc.user_id !== u.id || !has(u, "reports.write")) {
    fail(403, "Only the field service engineer who wrote this can send it.");
  }
  const to = next(doc.status, action);
  if (!to) fail(409, doc.status === "approved" ? "This is approved and locked. A reviewer can send it back if it needs a change." : "That step isn't possible from here. Reload to see the latest.");
  if (action === "approve" && doc.user_id === u.id && u.role !== "admin") fail(403, "Someone else has to approve your own paperwork.");
  let note: string | null = doc.review_note;
  if (action === "return") {
    note = typeof b.note === "string" ? b.note.trim() : "";
    if (!note) fail(400, "Write a note saying what needs to change.");
    if (note.length > REPORT_MAX.note) fail(400, `The note is too long (limit ${REPORT_MAX.note} characters).`);
  }
  if (action === "send") {
    const child: ChildKind = kind === "sheet" ? "days" : "log";
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM ${CHILD[child].table} WHERE ${CHILD[child].fk} = ?`).bind(doc.id).first<{ n: number }>())!.n;
    if (kind === "sheet" && !n) fail(400, "Add at least one day before sending the time sheet.");
    if (kind === "service" && !n && !doc.summary) fail(400, "Write the summary or the work log before sending the report.");
  }
  const at = now();
  const reviewCols = NEEDS_REVIEW[action] ? ", reviewed_by = ?, reviewed_at = ?" : "";
  const r = await db.prepare(`UPDATE ${TABLE[kind]} SET status = ?, review_note = ?, sent_at = ${action === "send" ? "?" : "sent_at"}${reviewCols}, updated_at = ? WHERE id = ? AND status = ?`)
    .bind(...[to, action === "approve" ? null : note, ...(action === "send" ? [at] : []), ...(NEEDS_REVIEW[action] ? [u.id, at] : []), at, doc.id, doc.status]).run();
  if (!r.meta.changes) fail(409, "Someone else changed this at the same time. Reload to see the latest.");
  await audit(db, { userId: u.id, action: `report.${action}`, targetType: kind, targetId: doc.id, detail: { from: doc.status, to, note: action === "return" ? note : undefined }, ip: c.get("ip") });
  return c.json({ status: to });
});

// ---- One time sheet or report ----

reports.get("/sheets/:id", async (c) => {
  const u = user(c);
  const doc = await loadDoc(c.env.DB, "sheet", c.req.param("id"), u);
  return c.json({ sheet: await fullSheet(c.env.DB, doc), job: await jobFor(c.env.DB, doc.job_id) });
});

reports.get("/service/:id", async (c) => {
  const u = user(c);
  const doc = await loadDoc(c.env.DB, "service", c.req.param("id"), u);
  return c.json({ ...(await fullReport(c.env.DB, doc)), job: await jobFor(c.env.DB, doc.job_id) });
});

/** The report's own fields (summary, recipe, follow-up, sign-off name, title and date), one or more at a time. */
reports.patch("/service/:id", async (c) => {
  const u = user(c);
  const db = c.env.DB;
  const doc = await loadDoc(db, "service", c.req.param("id"), u);
  mustEdit(doc, u);
  const r = cleanReport(await body(c));
  if (r.error) fail(400, r.error);
  const keys = Object.keys(r.fields!);
  if (!keys.length) return c.json({ ok: true });
  const at = now();
  await db.prepare(`UPDATE service_reports SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...keys.map((k) => r.fields![k]), at, doc.id).run();
  await audit(db, { userId: u.id, action: "report.update", targetType: "service", targetId: doc.id, detail: { fields: keys }, ip: c.get("ip") });
  return c.json({ ok: true, updated_at: at });
});

// ---- Rows: time sheet days and expenses, work log days and parts ----

function childOf(c: Context<AppEnv>, kind: Kind): ChildKind {
  const child = c.req.param("child");
  if (!isChildKind(child) || CHILD[child].doc !== kind) fail(404, "Not found.");
  return child;
}

reports.post("/:kind/:id/:child", async (c) => {
  const kind = docKind(c);
  const child = childOf(c, kind);
  const u = user(c);
  const db = c.env.DB;
  const doc = await loadDoc(db, kind, c.req.param("id"), u);
  mustEdit(doc, u);
  const s = CHILD[child];
  const count = (await db.prepare(`SELECT COUNT(*) AS n FROM ${s.table} WHERE ${s.fk} = ?`).bind(doc.id).first<{ n: number }>())!.n;
  if (count >= MAX_ROWS[child]) fail(400, `Up to ${MAX_ROWS[child]} lines here.`);
  const b = await body(c);
  // A new line starts on the next day after the last one (or the job's first day), unless a day was given.
  if (s.date && b[s.date] === undefined) {
    const last = await db.prepare(`SELECT MAX(${s.date}) AS d FROM ${s.table} WHERE ${s.fk} = ?`).bind(doc.id).first<{ d: string | null }>();
    const job = await db.prepare("SELECT first_day FROM jobs WHERE id = ?").bind(doc.job_id).first<{ first_day: string | null }>();
    b[s.date] = last?.d ? (child === "expenses" ? last.d : addDays(last.d, 1)) : job?.first_day ?? now().slice(0, 10);
  }
  if (child === "expenses" && b.type === undefined) b.type = "mileage";
  if (child === "parts" && b.kind === undefined) b.kind = "used";
  const r = cleanRow(child, b, false);
  if (r.error) fail(400, r.error);
  const id = randomId();
  const at = now();
  const cols = Object.keys(r.fields!);
  await db.batch([
    db.prepare(`INSERT INTO ${s.table} (id, ${s.fk}, ${cols.join(", ")}, created_at, updated_at) VALUES (?, ?, ${marks(cols.length)}, ?, ?)`).bind(id, doc.id, ...cols.map((k) => r.fields![k]), at, at),
    touch(db, kind, doc.id, at),
  ]);
  await audit(db, { userId: u.id, action: `report.${child}.add`, targetType: kind, targetId: doc.id, detail: { row: id }, ip: c.get("ip") });
  const row = await db.prepare(`SELECT * FROM ${s.table} WHERE id = ?`).bind(id).first();
  return c.json({ id, row });
});

reports.patch("/:kind/:id/:child/:rowId", async (c) => {
  const kind = docKind(c);
  const child = childOf(c, kind);
  const u = user(c);
  const db = c.env.DB;
  const doc = await loadDoc(db, kind, c.req.param("id"), u);
  mustEdit(doc, u);
  const r = cleanRow(child, await body(c), true);
  if (r.error) fail(400, r.error);
  const keys = Object.keys(r.fields!);
  if (!keys.length) return c.json({ ok: true });
  const s = CHILD[child];
  const at = now();
  const [res] = await db.batch([
    db.prepare(`UPDATE ${s.table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND ${s.fk} = ?`).bind(...keys.map((k) => r.fields![k]), at, c.req.param("rowId"), doc.id),
    touch(db, kind, doc.id, at),
  ]);
  if (!res?.meta.changes) fail(404, "Not found.");
  await audit(db, { userId: u.id, action: `report.${child}.update`, targetType: kind, targetId: doc.id, detail: { row: c.req.param("rowId"), fields: keys }, ip: c.get("ip") });
  return c.json({ ok: true, updated_at: at });
});

reports.delete("/:kind/:id/:child/:rowId", async (c) => {
  const kind = docKind(c);
  const child = childOf(c, kind);
  const u = user(c);
  const db = c.env.DB;
  const doc = await loadDoc(db, kind, c.req.param("id"), u);
  mustEdit(doc, u);
  const s = CHILD[child];
  const rowId = c.req.param("rowId");
  const res = await db.prepare(`DELETE FROM ${s.table} WHERE id = ? AND ${s.fk} = ?`).bind(rowId, doc.id).run();
  if (!res.meta.changes) fail(404, "Not found.");
  if (child === "expenses") await removeFiles(c, kind, doc, "purpose = 'receipt' AND row_id = ?", rowId);
  await touch(db, kind, doc.id).run();
  await audit(db, { userId: u.id, action: `report.${child}.remove`, targetType: kind, targetId: doc.id, detail: { row: rowId }, ip: c.get("ip") });
  return c.json({ ok: true });
});

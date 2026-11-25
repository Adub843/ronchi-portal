// Field service jobs: a scheduled visit to a customer (Aaron, 2026-11-25).
// Schedulers (jobs.schedule: scheduling, service, managers, admins) make a job with the customer's
// location, point of contact, days of work, job number and a free text box, and pick the field service
// engineers. Each engineer gets an email with a link to the job. Anyone who can see jobs can add files.
//
// The Ronchi workbook's Work orders page (GET /:id/workbook) adds the log of past work orders for the
// same machine. It has an on/off switch (lib/switches.ts): off, that page answers "Not found" and the
// email links to the plain job page instead. Everything else here works either way.
//
// Who sees jobs: only people with jobs.view (deny by default, like every other page).
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import { cleanName, fileInfo, fileProblem, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_BYTES } from "../../shared/files";
import { isJobStatus, JOB_MAX, JOB_TEXT_FIELDS, jobEmail, jobLink, mapLinks, normalizeDays, type JobForEmail, type JobStatus, type JobTextField } from "../../shared/jobs";
import type { AppEnv, SessionUser } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm } from "../lib/http";
import { isEmail, mailTo, sendMail } from "../lib/mail";
import { serveFile } from "../lib/serve-file";
import { isOn } from "../lib/switches";

export const jobs = new Hono<AppEnv>();

/** One row of the jobs table, as stored (work_days is JSON text). */
interface JobRow {
  id: string;
  job_number: string;
  customer: string;
  machine: string | null;
  location: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  work_days: string;
  first_day: string | null;
  last_day: string | null;
  notes: string | null;
  status: JobStatus;
  revision: number;
  updated_at: string;
}
type Job = Omit<JobRow, "work_days"> & JobForEmail;

/** A field service engineer on a job, and whether their email went out. */
interface Engineer { id: string; name: string; email_status: string | null; emailed_at: string | null }

const LABELS: Record<JobTextField, string> = {
  job_number: "Job number", customer: "Customer", machine: "Machine", location: "Location",
  contact_name: "Contact name", contact_phone: "Contact phone", contact_email: "Contact email", notes: "Other information",
};
// These are one line each (they go into email subjects); location and notes may have line breaks.
const ONE_LINE = new Set<JobTextField>(["job_number", "customer", "machine", "contact_name", "contact_phone", "contact_email"]);
// A change to any of these sends the job email again to the engineers already on the job.
const WORTH_TELLING = ["work_days", "location", "contact_name", "contact_phone", "contact_email"];

const toJob = (r: JobRow): Job => ({ ...r, work_days: JSON.parse(r.work_days || "[]") as string[] });
const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
function groupBy<T extends { job_id: string }>(rows: T[]): Map<string, Omit<T, "job_id">[]> {
  const m = new Map<string, Omit<T, "job_id">[]>();
  for (const { job_id, ...rest } of rows) m.set(job_id, [...(m.get(job_id) ?? []), rest]);
  return m;
}
const isDuplicate = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message ?? e));

/** Check and tidy what was typed. Only fields present in `b` come back. */
function clean(b: Record<string, unknown>) {
  const fields: Record<string, string | null> = {};
  for (const f of JOB_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
    const raw = b[f];
    if (raw !== null && raw !== undefined && typeof raw !== "string") fail(400, `${LABELS[f]} must be text.`);
    let v = (raw ?? "").trim();
    if (ONE_LINE.has(f)) v = v.replace(/\s+/g, " ");
    if (v.length > JOB_MAX[f]) fail(400, `${LABELS[f]} is too long (limit ${JOB_MAX[f]} characters).`);
    if (f === "machine") v = v.toUpperCase();
    if (f === "contact_email" && v && !isEmail(v)) fail(400, "The contact email doesn't look right.");
    fields[f] = v || null;
  }
  if ("job_number" in fields && !fields.job_number) fail(400, "Job number is required.");
  if ("customer" in fields && !fields.customer) fail(400, "Customer is required.");
  if (Object.prototype.hasOwnProperty.call(b, "work_days")) {
    let days: string[];
    try {
      days = normalizeDays(b.work_days);
    } catch (e) {
      fail(400, (e as Error).message);
    }
    fields.work_days = JSON.stringify(days);
    fields.first_day = days[0] ?? null;
    fields.last_day = days[days.length - 1] ?? null;
  }
  if (b.status !== undefined) {
    if (!isJobStatus(b.status)) fail(400, "Unknown status.");
    fields.status = b.status;
  }
  return fields;
}

async function cleanEngineers(db: D1Database, value: unknown): Promise<string[] | null> {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string") || value.length > 30) fail(400, "Pick the field service engineers from the list.");
  const ids = [...new Set(value as string[])];
  if (!ids.length) return [];
  const { results } = await db.prepare(`SELECT id FROM users WHERE status = 'active' AND id IN (${marks(ids.length)})`).bind(...ids).all<{ id: string }>();
  if (results.length !== ids.length) fail(400, "One of the field service engineers isn't an active person in the portal.");
  return ids;
}

async function loadJob(db: D1Database, id: string): Promise<JobRow> {
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>();
  if (!job) fail(404, "Not found.");
  return job;
}

async function engineersOf(db: D1Database, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, Engineer[]>();
  const { results } = await db.prepare(
    `SELECT t.job_id, u.id, u.name, t.email_status, t.emailed_at FROM job_techs t JOIN users u ON u.id = t.user_id
      WHERE t.job_id IN (${marks(jobIds.length)}) ORDER BY u.name`,
  ).bind(...jobIds).all<Engineer & { job_id: string }>();
  return groupBy(results);
}

async function filesOf(db: D1Database, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, Record<string, unknown>[]>();
  const { results } = await db.prepare(
    `SELECT f.id, f.job_id, f.name, f.ext, f.size, f.created_at, f.user_id, u.name AS by_name FROM job_files f LEFT JOIN users u ON u.id = f.user_id
      WHERE f.deleted_at IS NULL AND f.job_id IN (${marks(jobIds.length)}) ORDER BY f.created_at DESC`,
  ).bind(...jobIds).all<Record<string, unknown> & { job_id: string }>();
  return groupBy(results);
}

/** Email these engineers about the job, and note on the job whether each one went out. */
async function emailEngineers(c: Context<AppEnv>, row: JobRow, userIds: string[], by: SessionUser, updated = false) {
  if (!userIds.length) return [];
  const db = c.env.DB;
  const job = toJob(row);
  const link = jobLink(c.env.ORIGIN, job.id, await isOn(db, "workbook"));
  const { results } = await db.prepare(`SELECT u.id, u.name, u.email, n.email AS notify_email FROM users u LEFT JOIN notice_emails n ON n.user_id = u.id WHERE u.id IN (${marks(userIds.length)})`)
    .bind(...userIds).all<{ id: string; name: string; email: string; notify_email: string | null }>();
  const at = now();
  const replyTo = mailTo({ email: by.email, notify_email: null }) ?? undefined;
  const report = [];
  for (const u of results) {
    const to = mailTo(u);
    const mail = jobEmail(job, { link, name: u.name.split(" ")[0] || u.name, by: by.name, updated });
    const status = to ? await sendMail(c.env, { to, ...mail, replyTo }) : "no_address";
    await db.prepare("UPDATE job_techs SET email_status = ?, emailed_at = ? WHERE job_id = ? AND user_id = ?").bind(status, status === "sent" ? at : null, job.id, u.id).run();
    // When it didn't go out, the app offers the same email to send from the scheduler's own email app.
    report.push({ userId: u.id, name: u.name, status, to, ...(status === "sent" ? {} : { subject: mail.subject, text: mail.text }) });
  }
  await audit(db, { userId: by.id, action: "job.email", targetType: "job", targetId: job.id, detail: { sent: report.map((r) => ({ to: r.userId, status: r.status })) }, ip: c.get("ip") });
  return report;
}

// ---- Lists ----

jobs.get("/", async (c) => {
  const u = requirePerm(c, "jobs.view");
  const view = c.req.query("view") ?? "upcoming";
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const today = new Date().toISOString().slice(0, 10);
  const where: string[] = [];
  const args: unknown[] = [];
  if (view === "mine") {
    where.push("j.id IN (SELECT job_id FROM job_techs WHERE user_id = ?)");
    args.push(u.id);
  }
  if (view === "upcoming" || view === "mine") {
    where.push("(j.last_day IS NULL OR j.last_day >= ?) AND j.status NOT IN ('done','cancelled')");
    args.push(today);
  }
  if (view === "past") {
    where.push("((j.last_day IS NOT NULL AND j.last_day < ?) OR j.status IN ('done','cancelled'))");
    args.push(today);
  }
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    where.push("(j.job_number LIKE ? ESCAPE '\\' OR j.customer LIKE ? ESCAPE '\\' OR j.machine LIKE ? ESCAPE '\\' OR j.location LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  const order = view === "upcoming" || view === "mine" ? "j.first_day IS NULL, j.first_day ASC" : "j.first_day IS NULL, j.first_day DESC";
  const { results } = await c.env.DB.prepare(
    `SELECT j.*, (SELECT COUNT(*) FROM job_files f WHERE f.job_id = j.id AND f.deleted_at IS NULL) AS files
       FROM jobs j ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT 1000`,
  ).bind(...args).all<JobRow & { files: number }>();
  const engineers = await engineersOf(c.env.DB, results.map((j) => j.id));
  return c.json({ jobs: results.map((j) => ({ ...toJob(j), files: j.files, techs: engineers.get(j.id) ?? [] })) });
});

/** The people a scheduler can put on a job: active staff, field service engineers first. */
jobs.get("/staff", async (c) => {
  requirePerm(c, "jobs.schedule");
  const { results } = await c.env.DB.prepare(
    "SELECT u.id, u.name, u.role, u.email, n.email AS notify_email FROM users u LEFT JOIN notice_emails n ON n.user_id = u.id WHERE u.status = 'active' ORDER BY CASE u.role WHEN 'tech' THEN 0 ELSE 1 END, u.name",
  ).all<{ id: string; name: string; role: string; email: string; notify_email: string | null }>();
  return c.json({ people: results.map((p) => ({ id: p.id, name: p.name, role: p.role, emailTo: mailTo(p) })) });
});

// ---- Files ----

jobs.get("/files/:fileId", async (c) => {
  requirePerm(c, "jobs.view");
  const f = await c.env.DB.prepare("SELECT id, name FROM job_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  return serveFile(c.env.FILES, `jobs/${f.id}`, f.name, { download: c.req.query("download") !== undefined });
});

jobs.delete("/files/:fileId", async (c) => {
  const u = requirePerm(c, "jobs.view");
  const f = await c.env.DB.prepare("SELECT id, job_id, user_id, name FROM job_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; job_id: string; user_id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  if (f.user_id !== u.id && !has(u, "jobs.schedule")) fail(403, "Only the person who added a file, or a scheduler, can remove it.");
  await c.env.DB.prepare("UPDATE job_files SET deleted_at = ? WHERE id = ?").bind(now(), f.id).run();
  await c.env.FILES.delete(`jobs/${f.id}`).catch(() => undefined);
  await audit(c.env.DB, { userId: u.id, action: "job.file.remove", targetType: "job", targetId: f.job_id, detail: { name: f.name }, ip: c.get("ip") });
  return c.json({ ok: true });
});

jobs.post("/:id/files", async (c) => {
  const u = requirePerm(c, "jobs.view");
  const job = await loadJob(c.env.DB, c.req.param("id"));
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
  const at = now();
  const stored = files.map((f) => ({ id: randomId(), file: f, name: cleanName(f.name), info: fileInfo(f.name)! }));
  // Files go into R2 first; if any upload fails, the ones already stored are removed and nothing is added.
  try {
    for (const s of stored) {
      await c.env.FILES.put(`jobs/${s.id}`, s.file.stream(), { httpMetadata: { contentType: s.info.type }, customMetadata: { job: job.id, by: u.id } });
    }
  } catch (e) {
    await Promise.all(stored.map((s) => c.env.FILES.delete(`jobs/${s.id}`).catch(() => undefined)));
    throw e;
  }
  const add = c.env.DB.prepare("INSERT INTO job_files (id, job_id, user_id, name, ext, size, created_at) VALUES (?,?,?,?,?,?,?)");
  await c.env.DB.batch(stored.map((s) => add.bind(s.id, job.id, u.id, s.name, s.info.ext, s.file.size, at)));
  await audit(c.env.DB, { userId: u.id, action: "job.file.add", targetType: "job", targetId: job.id, detail: { names: stored.map((s) => s.name) }, ip: c.get("ip") });
  return c.json({ ids: stored.map((s) => s.id) });
});

// ---- One job ----

jobs.get("/:id", async (c) => {
  requirePerm(c, "jobs.view");
  const db = c.env.DB;
  const job = await loadJob(db, c.req.param("id"));
  const [engineers, files, workbook] = await Promise.all([engineersOf(db, [job.id]), filesOf(db, [job.id]), isOn(db, "workbook")]);
  const machine = job.machine ? await db.prepare("SELECT id, serial FROM machines WHERE serial = ?").bind(job.machine).first() : null;
  return c.json({
    job: toJob(job),
    techs: engineers.get(job.id) ?? [],
    files: files.get(job.id) ?? [],
    machine,
    maps: job.location ? mapLinks(job.location) : null,
    workbook,
  });
});

/**
 * The Ronchi workbook's Work orders page for a job: this work order, plus the log of past work orders
 * for the same machine (or the same customer when no machine is set), each with its notes, engineers and
 * files, and what else the portal knows about the machine. Gone when the workbook is switched off.
 */
jobs.get("/:id/workbook", async (c) => {
  const u = requirePerm(c, "jobs.view");
  const db = c.env.DB;
  if (!(await isOn(db, "workbook"))) fail(404, "Not found.");
  const job = await loadJob(db, c.req.param("id"));
  const key = job.machine ? { col: "machine", val: job.machine } : { col: "customer", val: job.customer };
  const { results: past } = await db.prepare(
    `SELECT * FROM jobs WHERE ${key.col} = ? COLLATE NOCASE AND id != ? AND status != 'cancelled'
      ORDER BY first_day IS NULL, first_day DESC LIMIT 200`,
  ).bind(key.val, job.id).all<JobRow>();
  const ids = [job.id, ...past.map((j) => j.id)];
  const [engineers, files] = await Promise.all([engineersOf(db, ids), filesOf(db, ids)]);
  // What else the portal knows about the machine, each only for people allowed to see it.
  const serial = job.machine;
  const machine = serial && has(u, "machines.view") ? await db.prepare("SELECT id, serial, model, customer, site, notes, sharepoint_url FROM machines WHERE serial = ?").bind(serial).first() : null;
  const notes = serial && has(u, "kb.view")
    ? (await db.prepare("SELECT id, code, title, kind, updated_at FROM kb_articles WHERE serial = ? COLLATE NOCASE AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 50").bind(serial).all()).results
    : [];
  const orders = serial && has(u, "orders.view")
    ? (await db.prepare("SELECT id, part, status, ship_date FROM cp_orders WHERE instr(upper(machine), ?) > 0 AND phase = 'order' AND removed_at IS NULL ORDER BY updated_at DESC LIMIT 50").bind(serial).all()).results
    : [];
  const full = (j: JobRow) => ({ ...toJob(j), techs: engineers.get(j.id) ?? [], files: files.get(j.id) ?? [] });
  return c.json({ job: full(job), log: past.map(full), logBy: key.col, machine, notes, orders, maps: job.location ? mapLinks(job.location) : null });
});

jobs.post("/", async (c) => {
  const u = requirePerm(c, "jobs.schedule");
  const b = await body(c);
  const f = clean({ work_days: [], ...b });
  if (!f.job_number) fail(400, "Job number is required.");
  if (!f.customer) fail(400, "Customer is required.");
  const engineers = (await cleanEngineers(c.env.DB, b.techIds)) ?? [];
  const id = randomId();
  const t = now();
  const cols = Object.keys(f);
  const addEngineer = c.env.DB.prepare("INSERT INTO job_techs (job_id, user_id, added_by, added_at) VALUES (?,?,?,?)");
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO jobs (id, ${cols.join(", ")}, created_by, updated_by, created_at, updated_at) VALUES (?, ${marks(cols.length)}, ?, ?, ?, ?)`)
        .bind(id, ...cols.map((k) => f[k]), u.id, u.id, t, t),
      ...engineers.map((x) => addEngineer.bind(id, x, u.id, t)),
    ]);
  } catch (e) {
    if (isDuplicate(e)) fail(409, `Job number ${f.job_number} is already used.`);
    throw e;
  }
  await audit(c.env.DB, { userId: u.id, action: "job.create", targetType: "job", targetId: id, detail: { ...f, engineers }, ip: c.get("ip") });
  const job = await loadJob(c.env.DB, id);
  const emails = b.notify === false ? [] : await emailEngineers(c, job, engineers, u);
  return c.json({ id, emails });
});

jobs.patch("/:id", async (c) => {
  const u = requirePerm(c, "jobs.schedule");
  const db = c.env.DB;
  const id = c.req.param("id");
  const b = await body(c);
  const before = await loadJob(db, id);
  const stale = "Someone else changed this job while you were editing. Reload to see their changes.";
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, stale);
  const f = clean(b);
  const wanted = await cleanEngineers(db, b.techIds);
  const diff: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(f)) {
    const was = (before as unknown as Record<string, unknown>)[k] ?? null;
    if (was !== f[k]) diff[k] = [was, f[k]];
  }
  const { results } = await db.prepare("SELECT user_id FROM job_techs WHERE job_id = ?").bind(id).all<{ user_id: string }>();
  const had = results.map((x) => x.user_id);
  const added = wanted ? wanted.filter((x) => !had.includes(x)) : [];
  const removed = wanted ? had.filter((x) => !wanted.includes(x)) : [];
  if (added.length || removed.length) diff.engineers = [had, wanted];
  const t = now();
  const keys = Object.keys(diff).filter((k) => k !== "engineers");
  // The job and its engineers change together, or not at all.
  try {
    const [r] = await db.batch([
      db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
        .bind(...keys.map((k) => f[k]), u.id, t, id, before.revision),
      // Only applied if the update above went through (the revision is now one higher).
      ...added.map((x) => db.prepare("INSERT INTO job_techs (job_id, user_id, added_by, added_at) SELECT ?, ?, ?, ? WHERE (SELECT revision FROM jobs WHERE id = ?) = ?").bind(id, x, u.id, t, id, before.revision + 1)),
      ...removed.map((x) => db.prepare("DELETE FROM job_techs WHERE job_id = ? AND user_id = ? AND (SELECT revision FROM jobs WHERE id = ?) = ?").bind(id, x, id, before.revision + 1)),
    ]);
    if (!r?.meta.changes) fail(409, stale);
  } catch (e) {
    if (isDuplicate(e)) fail(409, `Job number ${f.job_number} is already used.`);
    throw e;
  }
  if (Object.keys(diff).length) await audit(db, { userId: u.id, action: "job.update", targetType: "job", targetId: id, detail: { changes: diff }, ip: c.get("ip") });
  const job = await loadJob(db, id);
  let emails: Awaited<ReturnType<typeof emailEngineers>> = [];
  if (b.notify !== false) {
    // New engineers get the "scheduled" email; the ones already on it hear about changes to days, place or contact.
    const told = WORTH_TELLING.some((k) => k in diff) ? had.filter((x) => !removed.includes(x)) : [];
    emails = [...(await emailEngineers(c, job, added, u)), ...(await emailEngineers(c, job, told, u, true))];
  }
  return c.json({ ok: true, revision: job.revision, emails });
});

/** Send the job email again: to the listed engineers, or everyone on the job. */
jobs.post("/:id/email", async (c) => {
  const u = requirePerm(c, "jobs.schedule");
  const job = await loadJob(c.env.DB, c.req.param("id"));
  const b = await body(c);
  const { results } = await c.env.DB.prepare("SELECT user_id FROM job_techs WHERE job_id = ?").bind(job.id).all<{ user_id: string }>();
  const on = results.map((r) => r.user_id);
  const want = Array.isArray(b.userIds) ? on.filter((x) => (b.userIds as unknown[]).includes(x)) : on;
  if (!want.length) fail(400, "Put a field service engineer on the job first.");
  return c.json({ emails: await emailEngineers(c, job, want, u) });
});

// Tech jobs: a scheduled visit to a customer (Aaron, 2026-11-25).
// Schedulers (jobs.schedule: Meagan, Steve, admins) make a job with the customer's location, point of
// contact, days of work, job number and a free text box, and pick the techs. Each tech gets an email
// with a link to the job. Anyone who can see the job can add files to it (reports, photos).
//
// The Ronchi workbook's Work orders page (GET /:id/workbook) adds the log of past work orders for the
// same machine. It has an on/off switch (lib/switches.ts): off, that page answers "Not found" and the
// email links to the plain job page instead. Everything else here works either way.
//
// Who sees a job: anyone with jobs.view, and always the techs on it (even with jobs.view switched off).
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import { cleanName, fileInfo, fileProblem, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_BYTES } from "../../shared/files";
import { isJobStatus, JOB_MAX, JOB_TEXT_FIELDS, jobEmail, jobLink, mapLinks, normalizeDays, type JobTextField } from "../../shared/jobs";
import type { AppEnv, SessionUser } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm, requireUser } from "../lib/http";
import { isEmail, mailTo, sendMail } from "../lib/mail";
import { isOn, isSwitch, readSwitches, SWITCHES } from "../lib/switches";

export const jobs = new Hono<AppEnv>();
export const switches = new Hono<AppEnv>();

type Db = D1Database;
type JobRow = Record<string, unknown> & { id: string; job_number: string; customer: string; machine: string | null; work_days: string; revision: number };

const LABELS: Record<JobTextField, string> = {
  job_number: "Job number", customer: "Customer", machine: "Machine", location: "Location",
  contact_name: "Contact name", contact_phone: "Contact phone", contact_email: "Contact email", notes: "Other information",
};

/** Check and tidy what was typed. Only fields present in `b` come back. */
function clean(b: Record<string, unknown>) {
  const out: Record<string, string | number | null> = {};
  for (const f of JOB_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
    const raw = b[f];
    if (raw !== null && raw !== undefined && typeof raw !== "string") fail(400, `${LABELS[f]} must be text.`);
    let v = (raw ?? "").trim();
    if (v.length > JOB_MAX[f]) fail(400, `${LABELS[f]} is too long (limit ${JOB_MAX[f]} characters).`);
    if (f === "machine") v = v.toUpperCase();
    if (f === "contact_email" && v && !isEmail(v)) fail(400, "The contact email doesn't look right.");
    out[f] = v || null;
  }
  if ("job_number" in out && !out.job_number) fail(400, "Job number is required.");
  if ("customer" in out && !out.customer) fail(400, "Customer is required.");
  if (Object.prototype.hasOwnProperty.call(b, "work_days")) {
    let days: string[];
    try {
      days = normalizeDays(b.work_days);
    } catch (e) {
      fail(400, (e as Error).message);
    }
    out.work_days = JSON.stringify(days);
    out.first_day = days[0] ?? null;
    out.last_day = days[days.length - 1] ?? null;
  }
  if (b.status !== undefined) {
    if (!isJobStatus(b.status)) fail(400, "Unknown status.");
    out.status = b.status;
  }
  return out;
}

async function cleanTechs(db: Db, value: unknown): Promise<string[] | null> {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string") || value.length > 30) fail(400, "Pick the field service engineers from the list.");
  const ids = [...new Set(value as string[])];
  if (!ids.length) return [];
  const { results } = await db.prepare(`SELECT id FROM users WHERE status = 'active' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string }>();
  if (results.length !== ids.length) fail(400, "One of the field service engineers isn't an active person in the portal.");
  return ids;
}

async function isOnJob(db: Db, jobId: string, userId: string) {
  return !!(await db.prepare("SELECT 1 FROM job_techs WHERE job_id = ? AND user_id = ?").bind(jobId, userId).first());
}

/** The job, if this person may see it. Everyone else gets the same "Not found" as a job that doesn't exist. */
async function loadJob(c: Context<AppEnv>, u: SessionUser, id: string): Promise<JobRow> {
  const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>();
  if (!job) fail(404, "Not found.");
  if (!has(u, "jobs.view") && !(await isOnJob(c.env.DB, id, u.id))) fail(404, "Not found.");
  return job;
}

const out = (j: JobRow) => ({ ...j, work_days: JSON.parse(j.work_days || "[]") as string[] });

async function techsOf(db: Db, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, { id: string; name: string; email_status: string | null; emailed_at: string | null }[]>();
  const { results } = await db.prepare(
    `SELECT t.job_id, u.id, u.name, t.email_status, t.emailed_at FROM job_techs t JOIN users u ON u.id = t.user_id
      WHERE t.job_id IN (${jobIds.map(() => "?").join(",")}) ORDER BY u.name`,
  ).bind(...jobIds).all<{ job_id: string; id: string; name: string; email_status: string | null; emailed_at: string | null }>();
  const m = new Map<string, { id: string; name: string; email_status: string | null; emailed_at: string | null }[]>();
  for (const { job_id, ...t } of results) m.set(job_id, [...(m.get(job_id) ?? []), t]);
  return m;
}

async function filesOf(db: Db, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, Record<string, unknown>[]>();
  const { results } = await db.prepare(
    `SELECT f.id, f.job_id, f.name, f.ext, f.size, f.created_at, f.user_id, u.name AS by_name FROM job_files f LEFT JOIN users u ON u.id = f.user_id
      WHERE f.deleted_at IS NULL AND f.job_id IN (${jobIds.map(() => "?").join(",")}) ORDER BY f.created_at DESC`,
  ).bind(...jobIds).all<Record<string, unknown> & { job_id: string }>();
  const m = new Map<string, Record<string, unknown>[]>();
  for (const { job_id, ...f } of results) m.set(job_id, [...(m.get(job_id) ?? []), f]);
  return m;
}

/** Email these techs about the job, and note on the job whether each one went out. */
async function emailTechs(c: Context<AppEnv>, job: JobRow, userIds: string[], by: SessionUser) {
  if (!userIds.length) return [];
  const db = c.env.DB;
  const link = jobLink(c.env.ORIGIN, job.id, await isOn(db, "workbook"));
  const { results } = await db.prepare(`SELECT id, name, email, notify_email FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`)
    .bind(...userIds).all<{ id: string; name: string; email: string; notify_email: string | null }>();
  const at = now();
  const report = [];
  for (const u of results) {
    const to = mailTo(u);
    const mail = jobEmail({ ...out(job), machine: job.machine, location: job.location as string | null, contact_name: job.contact_name as string | null, contact_phone: job.contact_phone as string | null, contact_email: job.contact_email as string | null, notes: job.notes as string | null }, { link, techName: u.name.split(" ")[0] ?? u.name, by: by.name });
    const status = to ? await sendMail(c.env, { to, ...mail, replyTo: mailTo({ email: by.email, notify_email: null }) ?? undefined }) : "no_address";
    await db.prepare("UPDATE job_techs SET email_status = ?, emailed_at = ? WHERE job_id = ? AND user_id = ?").bind(status, status === "sent" ? at : null, job.id, u.id).run();
    // When it didn't go out, the app offers the same email to send from the scheduler's own email app.
    report.push({ userId: u.id, name: u.name, status, to, ...(status === "sent" ? {} : { subject: mail.subject, text: mail.text }) });
  }
  await audit(db, { userId: by.id, action: "job.email", targetType: "job", targetId: job.id, detail: { sent: report.map((r) => ({ to: r.userId, status: r.status })) }, ip: c.get("ip") });
  return report;
}

// ---- Lists ----

jobs.get("/", async (c) => {
  const u = requireUser(c);
  const view = c.req.query("view") ?? "upcoming";
  const q = (c.req.query("q") ?? "").trim().slice(0, 100);
  const today = new Date().toISOString().slice(0, 10);
  const where: string[] = [];
  const args: unknown[] = [];
  // Without jobs.view, only the jobs you're on.
  if (view === "mine" || !has(u, "jobs.view")) {
    where.push("j.id IN (SELECT job_id FROM job_techs WHERE user_id = ?)");
    args.push(u.id);
  }
  if (view === "upcoming" || view === "mine") where.push("(j.last_day IS NULL OR j.last_day >= ?) AND j.status NOT IN ('done','cancelled')"), args.push(today);
  if (view === "past") where.push("((j.last_day IS NOT NULL AND j.last_day < ?) OR j.status IN ('done','cancelled'))"), args.push(today);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    where.push("(j.job_number LIKE ? ESCAPE '\\' OR j.customer LIKE ? ESCAPE '\\' OR j.machine LIKE ? ESCAPE '\\' OR j.location LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  const order = view === "past" ? "j.first_day DESC" : "j.first_day IS NULL, j.first_day ASC";
  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.job_number, j.customer, j.machine, j.location, j.work_days, j.first_day, j.last_day, j.status, j.updated_at,
            (SELECT COUNT(*) FROM job_files f WHERE f.job_id = j.id AND f.deleted_at IS NULL) AS files
       FROM jobs j ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT 1000`,
  ).bind(...args).all<JobRow>();
  const techs = await techsOf(c.env.DB, results.map((j) => j.id));
  return c.json({ jobs: results.map((j) => ({ ...out(j), techs: techs.get(j.id) ?? [] })) });
});

/** The people a scheduler can put on a job: active staff, techs first. */
jobs.get("/staff", async (c) => {
  requirePerm(c, "jobs.schedule");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, role, email, notify_email FROM users WHERE status = 'active' ORDER BY CASE role WHEN 'tech' THEN 0 ELSE 1 END, name",
  ).all<{ id: string; name: string; role: string; email: string; notify_email: string | null }>();
  return c.json({ people: results.map((p) => ({ id: p.id, name: p.name, role: p.role, emailTo: mailTo(p) })) });
});

// ---- Files ----

jobs.get("/files/:fileId", async (c) => {
  const u = requireUser(c);
  const f = await c.env.DB.prepare("SELECT id, job_id, name FROM job_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; job_id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  await loadJob(c, u, f.job_id);
  const info = fileInfo(f.name);
  const obj = await c.env.FILES.get(`jobs/${f.id}`);
  if (!obj || !info) fail(404, "Not found.");
  const inline = info.kind === "image" && c.req.query("download") === undefined;
  const ascii = f.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return new Response(obj.body, {
    headers: {
      "Content-Type": info.type,
      "Content-Length": String(obj.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

jobs.delete("/files/:fileId", async (c) => {
  const u = requireUser(c);
  const f = await c.env.DB.prepare("SELECT id, job_id, user_id, name FROM job_files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("fileId")).first<{ id: string; job_id: string; user_id: string; name: string }>();
  if (!f) fail(404, "Not found.");
  await loadJob(c, u, f.job_id);
  if (f.user_id !== u.id && !has(u, "jobs.schedule")) fail(403, "Only the person who added a file, or a scheduler, can remove it.");
  await c.env.DB.prepare("UPDATE job_files SET deleted_at = ? WHERE id = ?").bind(now(), f.id).run();
  await c.env.FILES.delete(`jobs/${f.id}`).catch(() => undefined);
  await audit(c.env.DB, { userId: u.id, action: "job.file.remove", targetType: "job", targetId: f.job_id, detail: { name: f.name }, ip: c.get("ip") });
  return c.json({ ok: true });
});

jobs.post("/:id/files", async (c) => {
  const u = requireUser(c);
  const job = await loadJob(c, u, c.req.param("id"));
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
  const u = requireUser(c);
  const job = await loadJob(c, u, c.req.param("id"));
  const [techs, files, sw] = await Promise.all([techsOf(c.env.DB, [job.id]), filesOf(c.env.DB, [job.id]), readSwitches(c.env.DB)]);
  const machine = job.machine ? await c.env.DB.prepare("SELECT id, serial FROM machines WHERE serial = ?").bind(job.machine).first() : null;
  const { results: history } = await c.env.DB.prepare(
    `SELECT a.at, a.action, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.target_type = 'job' AND a.target_id = ? ORDER BY a.at DESC LIMIT 100`,
  ).bind(job.id).all();
  return c.json({
    job: out(job),
    techs: techs.get(job.id) ?? [],
    files: files.get(job.id) ?? [],
    machine,
    maps: job.location ? mapLinks(job.location as string) : null,
    history,
    workbook: sw.workbook,
  });
});

/**
 * The Ronchi workbook's Work orders page for a job: this work order, plus the log of past work orders
 * for the same machine (or the same customer when no machine is set), each with its notes, techs and
 * files, and what else the portal knows about the machine. Gone when the workbook is switched off.
 */
jobs.get("/:id/workbook", async (c) => {
  const u = requireUser(c);
  if (!(await isOn(c.env.DB, "workbook"))) fail(404, "Not found.");
  const job = await loadJob(c, u, c.req.param("id"));
  const db = c.env.DB;
  const key = job.machine ? { col: "machine", val: job.machine } : { col: "customer", val: job.customer };
  const { results: past } = await db.prepare(
    `SELECT * FROM jobs WHERE ${key.col} = ? COLLATE NOCASE AND id != ? AND status != 'cancelled'
      ORDER BY first_day IS NULL, first_day DESC LIMIT 200`,
  ).bind(key.val, job.id).all<JobRow>();
  const ids = [job.id, ...past.map((j) => j.id)];
  const [techs, files] = await Promise.all([techsOf(db, ids), filesOf(db, ids)]);
  const machine = job.machine ? await db.prepare("SELECT id, serial, model, customer, site, notes, sharepoint_url FROM machines WHERE serial = ?").bind(job.machine).first() : null;
  const notes = job.machine && has(u, "kb.view")
    ? (await db.prepare("SELECT id, code, title, kind, updated_at FROM kb_articles WHERE serial = ? COLLATE NOCASE AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 50").bind(job.machine).all()).results
    : [];
  const orders = job.machine && has(u, "orders.view")
    ? (await db.prepare("SELECT id, part, status, ship_date FROM cp_orders WHERE instr(upper(machine), ?) > 0 AND removed_at IS NULL ORDER BY updated_at DESC LIMIT 50").bind(job.machine).all()).results
    : [];
  const full = (j: JobRow) => ({ ...out(j), techs: techs.get(j.id) ?? [], files: files.get(j.id) ?? [] });
  return c.json({ job: full(job), log: past.map(full), logBy: key.col, machine, notes, orders, maps: job.location ? mapLinks(job.location as string) : null });
});

jobs.post("/", async (c) => {
  const u = requirePerm(c, "jobs.schedule");
  const b = await body(c);
  const f = clean({ work_days: [], ...b });
  if (!f.job_number) fail(400, "Job number is required.");
  if (!f.customer) fail(400, "Customer is required.");
  const techIds = (await cleanTechs(c.env.DB, b.techIds)) ?? [];
  const id = randomId();
  const t = now();
  const cols = Object.keys(f);
  try {
    await c.env.DB.prepare(`INSERT INTO jobs (id, ${cols.join(", ")}, created_by, updated_by, created_at, updated_at) VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?, ?, ?)`)
      .bind(id, ...cols.map((k) => f[k]), u.id, u.id, t, t).run();
  } catch {
    fail(409, `Job number ${f.job_number} is already used.`);
  }
  if (techIds.length) {
    const add = c.env.DB.prepare("INSERT INTO job_techs (job_id, user_id, added_by, added_at) VALUES (?,?,?,?)");
    await c.env.DB.batch(techIds.map((tid) => add.bind(id, tid, u.id, t)));
  }
  await audit(c.env.DB, { userId: u.id, action: "job.create", targetType: "job", targetId: id, detail: { ...f, techs: techIds }, ip: c.get("ip") });
  const job = (await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>())!;
  const emails = b.notify === false ? [] : await emailTechs(c, job, techIds, u);
  return c.json({ id, emails });
});

jobs.patch("/:id", async (c) => {
  const u = requirePerm(c, "jobs.schedule");
  const id = c.req.param("id");
  const b = await body(c);
  const before = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>();
  if (!before) fail(404, "Not found.");
  const stale = "Someone else changed this job while you were editing. Reload to see their changes.";
  if (typeof b.revision !== "number" || b.revision !== before.revision) fail(409, stale);
  const f = clean(b);
  const techIds = await cleanTechs(c.env.DB, b.techIds);
  const diff: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(f)) if ((before[k] ?? null) !== (f[k] ?? null)) diff[k] = [before[k] ?? null, f[k] ?? null];
  const t = now();
  const keys = Object.keys(diff);
  const r = await c.env.DB.prepare(
    `UPDATE jobs SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`,
  ).bind(...keys.map((k) => f[k]), u.id, t, id, before.revision).run();
  if (!r.meta.changes) fail(409, stale);
  let added: string[] = [];
  if (techIds) {
    const { results } = await c.env.DB.prepare("SELECT user_id FROM job_techs WHERE job_id = ?").bind(id).all<{ user_id: string }>();
    const had = new Set(results.map((x) => x.user_id));
    added = techIds.filter((x) => !had.has(x));
    const removed = [...had].filter((x) => !techIds.includes(x));
    const stmts = [
      ...added.map((x) => c.env.DB.prepare("INSERT INTO job_techs (job_id, user_id, added_by, added_at) VALUES (?,?,?,?)").bind(id, x, u.id, t)),
      ...removed.map((x) => c.env.DB.prepare("DELETE FROM job_techs WHERE job_id = ? AND user_id = ?").bind(id, x)),
    ];
    if (stmts.length) await c.env.DB.batch(stmts);
    if (added.length || removed.length) diff.techs = [[...had], techIds];
  }
  if (Object.keys(diff).length) await audit(c.env.DB, { userId: u.id, action: "job.update", targetType: "job", targetId: id, detail: { changes: diff }, ip: c.get("ip") });
  const job = (await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobRow>())!;
  const emails = b.notify === false ? [] : await emailTechs(c, job, added, u);
  return c.json({ ok: true, revision: job.revision, emails });
});

/** Send the job email again: to the listed techs, or everyone on the job. */
jobs.post("/:id/email", async (c) => {
  const u = requirePerm(c, "jobs.schedule");
  const job = await loadJob(c, u, c.req.param("id"));
  const b = await body(c);
  const { results } = await c.env.DB.prepare("SELECT user_id FROM job_techs WHERE job_id = ?").bind(job.id).all<{ user_id: string }>();
  const on = results.map((r) => r.user_id);
  const want = Array.isArray(b.userIds) ? on.filter((x) => (b.userIds as unknown[]).includes(x)) : on;
  if (!want.length) fail(400, "Put a field service engineer on the job first.");
  return c.json({ emails: await emailTechs(c, job, want, u) });
});

// ---- Switches (admins turn whole parts of the portal on or off) ----

switches.get("/", async (c) => {
  requireUser(c);
  const sw = await readSwitches(c.env.DB);
  return c.json({ switches: sw, labels: Object.fromEntries(Object.entries(SWITCHES).map(([k, v]) => [k, v.label])) });
});

switches.put("/:name", async (c) => {
  const admin = requirePerm(c, "users.manage");
  const name = c.req.param("name");
  if (!isSwitch(name)) fail(404, "Not found.");
  const b = await body(c);
  if (typeof b.on !== "boolean") fail(400, "Say on or off.");
  await c.env.DB.prepare(
    "INSERT INTO feature_switches (name, is_on, set_by, set_at) VALUES (?,?,?,?) ON CONFLICT (name) DO UPDATE SET is_on = excluded.is_on, set_by = excluded.set_by, set_at = excluded.set_at",
  ).bind(name, b.on ? 1 : 0, admin.id, now()).run();
  await audit(c.env.DB, { userId: admin.id, action: "switch.set", targetType: "switch", targetId: name, detail: { on: b.on }, ip: c.get("ip") });
  return c.json({ switches: await readSwitches(c.env.DB) });
});

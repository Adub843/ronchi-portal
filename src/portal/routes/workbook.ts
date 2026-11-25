// The Ronchi workbook inside Work orders (Aaron, 2026-11-25): each job's service report (daily work
// log, photos with captions and recipe screens, customer sign-off), billable hours, expenses, the
// job's own chat, and Submit, which sends the report to the office and turns problems found into
// quick notes in the knowledge base.
//
// Billable hours are what the customer is billed for, NOT a time clock (Aaron, 2026-11-25). Typed in
// per day by type of hour. Hours worked for pay stay in busybusy.
//
// Who can do what (deny by default):
//  - read a work order: jobs.view
//  - fill it in: the field service engineers on the job, and schedulers (jobs.schedule)
//  - hours and expenses: each engineer their own; schedulers anyone's on the job
//  - see hours and expenses: the people who can fill it in, and billing (workbook.billing),
//    who also get the weekly list across all jobs
//  - who gets submitted reports: admins (settings.manage)
// The whole workbook has an on/off switch (lib/switches.ts). Off, every route here answers "Not found".
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import { jobLink } from "../../shared/jobs";
import {
  addDays, billableFor, cleanHours, EXPENSE_TYPES, HOUR_KEYS, isDay, issueLines, mondayOf, PAY, PCT, reportText, SCOPES, toCents, type HourType,
} from "../../shared/workbook";
import type { AppEnv, SessionUser } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm, str } from "../lib/http";
import { mailTo, sendMail } from "../lib/mail";
import { isOn } from "../lib/switches";
import { addQuickNote } from "./kb";

export const workbook = new Hono<AppEnv>();

interface JobLite { id: string; job_number: string; customer: string; machine: string | null; location: string | null; created_by: string | null; chat_id: string | null }
interface Report {
  job_id: string; scope: string | null; summary: string | null; open_issues: string | null; sign_name: string | null; sign_title: string | null;
  sign_date: string | null; signature: string | null; status: "draft" | "submitted"; submitted_by: string | null; submitted_at: string | null; revision: number;
  updated_by: string | null; updated_at: string;
}

const MAX_SIGNATURE = 200_000; // a drawn signature as PNG is far smaller than this

// Every route: the workbook must be on, and the person must see jobs.
workbook.use("*", async (c, next) => {
  requirePerm(c, "jobs.view");
  if (!(await isOn(c.env.DB, "workbook"))) fail(404, "Not found.");
  await next();
});

async function loadJob(db: D1Database, id: string): Promise<JobLite> {
  const job = await db.prepare("SELECT id, job_number, customer, machine, location, created_by, chat_id FROM jobs WHERE id = ?").bind(id).first<JobLite>();
  if (!job) fail(404, "Not found.");
  return job;
}

async function onJob(db: D1Database, jobId: string, userId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 FROM job_techs WHERE job_id = ? AND user_id = ?").bind(jobId, userId).first());
}

/** May this person fill in this job's work order? */
async function canFill(db: D1Database, u: SessionUser, jobId: string): Promise<boolean> {
  return has(u, "jobs.schedule") || (await onJob(db, jobId, u.id));
}

async function mustFill(c: Context<AppEnv>, jobId: string): Promise<SessionUser> {
  const u = c.get("user")!;
  if (!(await canFill(c.env.DB, u, jobId))) fail(403, "Only the field service engineers on this job and schedulers can fill in its work order.");
  return u;
}

async function loadReport(db: D1Database, jobId: string): Promise<(Report & { submitted_by_name: string | null }) | null> {
  return db.prepare("SELECT r.*, u.name AS submitted_by_name FROM wb_reports r LEFT JOIN users u ON u.id = r.submitted_by WHERE r.job_id = ?").bind(jobId).first();
}

/** Changes to the report and its log are refused once it has been submitted, until a scheduler reopens it. */
async function mustBeOpen(db: D1Database, jobId: string) {
  const r = await loadReport(db, jobId);
  if (r?.status === "submitted") fail(409, "This report was submitted. A scheduler can reopen it if something needs changing.");
}

/** Whose row an engineer may write: their own; a scheduler may write for any engineer on the job. */
async function rowOwner(c: Context<AppEnv>, jobId: string, wanted: unknown): Promise<string> {
  const u = c.get("user")!;
  if (wanted === undefined || wanted === null || wanted === "" || wanted === u.id) return u.id;
  if (typeof wanted !== "string" || !has(u, "jobs.schedule")) fail(403, "You can only fill in your own hours and expenses.");
  if (!(await onJob(c.env.DB, jobId, wanted))) fail(400, "That person isn't a field service engineer on this job.");
  return wanted;
}

function pick<T extends string>(v: unknown, list: readonly T[], what: string): T | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) fail(400, `Choose the ${what} from the list.`);
  return v as T;
}

function day(v: unknown): string {
  if (!isDay(v)) fail(400, "Pick a date.");
  return v;
}

function plain<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    fail(400, (e as Error).message);
  }
}

// ---- One work order ----

workbook.get("/:jobId", async (c) => {
  const u = c.get("user")!;
  const db = c.env.DB;
  const job = await loadJob(db, c.req.param("jobId"));
  const fill = await canFill(db, u, job.id);
  const money = fill || has(u, "workbook.billing");
  const [report, entries, photos, hours, expenses, recipients, member] = await Promise.all([
    loadReport(db, job.id),
    db.prepare(`SELECT e.id, e.user_id, u.name AS who, e.day, e.work, e.description, e.done, e.pct, e.issues, e.updated_at FROM wb_entries e JOIN users u ON u.id = e.user_id
                 WHERE e.job_id = ? AND e.removed_at IS NULL ORDER BY e.day, e.created_at`).bind(job.id).all().then((r) => r.results),
    db.prepare(`SELECT f.id, f.name, f.ext, f.created_at, p.caption, p.recipe_screen FROM job_files f LEFT JOIN wb_photos p ON p.file_id = f.id
                 WHERE f.job_id = ? AND f.deleted_at IS NULL AND lower(f.ext) IN ('jpg','jpeg','png','webp','heic','gif') ORDER BY f.created_at`).bind(job.id).all().then((r) => r.results),
    money
      ? db.prepare(`SELECT h.*, u.name AS who FROM wb_hours h JOIN users u ON u.id = h.user_id WHERE h.job_id = ? ORDER BY h.day, u.name`).bind(job.id).all().then((r) => r.results)
      : null,
    money
      ? db.prepare(`SELECT x.*, u.name AS who FROM wb_expenses x JOIN users u ON u.id = x.user_id WHERE x.job_id = ? AND x.removed_at IS NULL ORDER BY x.day, x.created_at`).bind(job.id).all().then((r) => r.results)
      : null,
    db.prepare("SELECT u.id, u.name FROM wb_recipients r JOIN users u ON u.id = r.user_id AND u.status = 'active' ORDER BY u.name").all().then((r) => r.results),
    job.chat_id ? db.prepare("SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?").bind(job.chat_id, u.id).first() : null,
  ]);
  return c.json({
    report: report ?? { job_id: job.id, status: "draft", revision: 0 },
    entries, photos, hours, expenses, recipients,
    chat: job.chat_id ? { id: job.chat_id, member: !!member } : null,
    canFill: fill, canSchedule: has(u, "jobs.schedule"), billable: billableFor(job.job_number),
    lists: { scopes: SCOPES, pct: PCT, expenseTypes: EXPENSE_TYPES, pay: PAY },
  });
});

/** Save the report's top and sign-off. `revision` stops two people overwriting each other. */
workbook.put("/:jobId/report", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  const u = await mustFill(c, job.id);
  const b = await body(c);
  const db = c.env.DB;
  const old = await loadReport(db, job.id);
  if (old?.status === "submitted") fail(409, "This report was submitted. A scheduler can reopen it if something needs changing.");
  if ((old?.revision ?? 0) !== Number(b.revision ?? 0)) fail(409, "Someone else changed this report. Reload to see their changes, then save yours again.");
  const signature = b.signature === undefined ? old?.signature ?? null : b.signature === null || b.signature === "" ? null : String(b.signature);
  if (signature && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > MAX_SIGNATURE)) fail(400, "The signature didn't come through. Clear it and sign again.");
  const keep = (k: keyof Report, max: number) => (b[k] === undefined ? (old?.[k] as string | null) ?? null : str(b[k], max));
  const f = {
    scope: b.scope === undefined ? old?.scope ?? null : pick(b.scope, SCOPES, "type of work"),
    summary: keep("summary", 8000), open_issues: keep("open_issues", 4000),
    sign_name: keep("sign_name", 120), sign_title: keep("sign_title", 120),
    sign_date: b.sign_date === undefined ? old?.sign_date ?? null : b.sign_date ? day(b.sign_date) : null,
  };
  const at = now();
  const revision = (old?.revision ?? 0) + 1;
  await db.prepare(
    `INSERT INTO wb_reports (job_id, scope, summary, open_issues, sign_name, sign_title, sign_date, signature, status, revision, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'draft', ?,?,?)
     ON CONFLICT(job_id) DO UPDATE SET scope = excluded.scope, summary = excluded.summary, open_issues = excluded.open_issues, sign_name = excluded.sign_name,
       sign_title = excluded.sign_title, sign_date = excluded.sign_date, signature = excluded.signature, revision = excluded.revision,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(job.id, f.scope, f.summary, f.open_issues, f.sign_name, f.sign_title, f.sign_date, signature, revision, u.id, at).run();
  return c.json({ ok: true, revision });
});

// ---- Daily work log ----

function entryFields(b: Record<string, unknown>) {
  const description = str(b.description, 4000);
  if (!description) fail(400, "Write what was done that day.");
  return {
    day: day(b.day), description,
    work: pick(b.work, SCOPES, "type of work"),
    done: pick(b.done, ["Y", "N"] as const, "done answer"),
    pct: pick(b.pct, PCT, "how far along"),
    issues: str(b.issues, 4000),
  };
}

workbook.post("/:jobId/entries", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  const u = await mustFill(c, job.id);
  await mustBeOpen(c.env.DB, job.id);
  const b = await body(c);
  const f = entryFields(b);
  const who = await rowOwner(c, job.id, b.user_id);
  const id = randomId();
  const at = now();
  await c.env.DB.prepare(
    "INSERT INTO wb_entries (id, job_id, user_id, day, work, description, done, pct, issues, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(id, job.id, who, f.day, f.work, f.description, f.done, f.pct, f.issues, u.id, at, at).run();
  return c.json({ id });
});

workbook.patch("/:jobId/entries/:id", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  const u = await mustFill(c, job.id);
  await mustBeOpen(c.env.DB, job.id);
  const row = await c.env.DB.prepare("SELECT user_id FROM wb_entries WHERE id = ? AND job_id = ? AND removed_at IS NULL").bind(c.req.param("id"), job.id).first<{ user_id: string }>();
  if (!row) fail(404, "Not found.");
  if (row.user_id !== u.id && !has(u, "jobs.schedule")) fail(403, "You can only change your own lines in the log.");
  const f = entryFields(await body(c));
  await c.env.DB.prepare("UPDATE wb_entries SET day = ?, work = ?, description = ?, done = ?, pct = ?, issues = ?, updated_at = ? WHERE id = ?")
    .bind(f.day, f.work, f.description, f.done, f.pct, f.issues, now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

workbook.delete("/:jobId/entries/:id", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  const u = await mustFill(c, job.id);
  await mustBeOpen(c.env.DB, job.id);
  const row = await c.env.DB.prepare("SELECT user_id FROM wb_entries WHERE id = ? AND job_id = ? AND removed_at IS NULL").bind(c.req.param("id"), job.id).first<{ user_id: string }>();
  if (!row) fail(404, "Not found.");
  if (row.user_id !== u.id && !has(u, "jobs.schedule")) fail(403, "You can only remove your own lines in the log.");
  await c.env.DB.prepare("UPDATE wb_entries SET removed_at = ? WHERE id = ?").bind(now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---- Photo captions (the photos are the job's files) ----

workbook.put("/:jobId/photos/:fileId", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  await mustFill(c, job.id);
  const f = await c.env.DB.prepare("SELECT id FROM job_files WHERE id = ? AND job_id = ? AND deleted_at IS NULL").bind(c.req.param("fileId"), job.id).first();
  if (!f) fail(404, "Not found.");
  const b = await body(c);
  await c.env.DB.prepare(
    `INSERT INTO wb_photos (file_id, job_id, caption, recipe_screen, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(file_id) DO UPDATE SET caption = excluded.caption, recipe_screen = excluded.recipe_screen, updated_at = excluded.updated_at`,
  ).bind(c.req.param("fileId"), job.id, str(b.caption, 300), str(b.recipe_screen, 80), now()).run();
  return c.json({ ok: true });
});

// ---- Billable hours (customer billing, not a time clock) ----

/** Set one engineer's billable hours for one day on this job (all zero removes the day). */
workbook.put("/:jobId/hours", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  await mustFill(c, job.id);
  await mustBeOpen(c.env.DB, job.id);
  const b = await body(c);
  const who = await rowOwner(c, job.id, b.user_id);
  const d = day(b.day);
  const h = plain(() => cleanHours(b));
  const note = str(b.note, 300);
  const db = c.env.DB;
  if (HOUR_KEYS.every((k) => !h[k]) && !h.miles) {
    await db.prepare("DELETE FROM wb_hours WHERE job_id = ? AND user_id = ? AND day = ?").bind(job.id, who, d).run();
    return c.json({ ok: true, removed: true });
  }
  const at = now();
  await db.prepare(
    `INSERT INTO wb_hours (id, job_id, user_id, day, travel_wd, travel_we, regular, training, overtime, warranty, miles, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(job_id, user_id, day) DO UPDATE SET travel_wd = excluded.travel_wd, travel_we = excluded.travel_we, regular = excluded.regular,
       training = excluded.training, overtime = excluded.overtime, warranty = excluded.warranty, miles = excluded.miles, note = excluded.note, updated_at = excluded.updated_at`,
  ).bind(randomId(), job.id, who, d, h.travel_wd, h.travel_we, h.regular, h.training, h.overtime, h.warranty, h.miles, note, at, at).run();
  return c.json({ ok: true });
});

// ---- Expenses ----

async function expenseFields(c: Context<AppEnv>, jobId: string, b: Record<string, unknown>) {
  let receipt: string | null = null;
  if (b.receipt_file) {
    if (typeof b.receipt_file !== "string") fail(400, "The receipt didn't come through.");
    const f = await c.env.DB.prepare("SELECT id FROM job_files WHERE id = ? AND job_id = ? AND deleted_at IS NULL").bind(b.receipt_file, jobId).first();
    if (!f) fail(400, "The receipt didn't come through. Add the photo again.");
    receipt = b.receipt_file;
  }
  return {
    day: day(b.day),
    type: pick(b.type, EXPENSE_TYPES, "kind of expense") ?? fail(400, "Choose the kind of expense."),
    amount: plain(() => toCents(b.amount)),
    pay: pick(b.pay, PAY, "way it was paid") ?? "Credit",
    description: str(b.description, 300),
    billable: pick(b.billable, ["Y", "N"] as const, "billable answer"),
    receipt,
  };
}

workbook.post("/:jobId/expenses", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  await mustFill(c, job.id);
  await mustBeOpen(c.env.DB, job.id);
  const b = await body(c);
  const who = await rowOwner(c, job.id, b.user_id);
  const f = await expenseFields(c, job.id, b);
  const id = randomId();
  const at = now();
  await c.env.DB.prepare(
    "INSERT INTO wb_expenses (id, job_id, user_id, day, type, amount_cents, pay, description, billable, receipt_file, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(id, job.id, who, f.day, f.type, f.amount, f.pay, f.description, f.billable ?? billableFor(job.job_number), f.receipt, at, at).run();
  return c.json({ id });
});

async function ownExpense(c: Context<AppEnv>, jobId: string) {
  const u = await mustFill(c, jobId);
  await mustBeOpen(c.env.DB, jobId);
  const row = await c.env.DB.prepare("SELECT user_id FROM wb_expenses WHERE id = ? AND job_id = ? AND removed_at IS NULL").bind(c.req.param("id"), jobId).first<{ user_id: string }>();
  if (!row) fail(404, "Not found.");
  if (row.user_id !== u.id && !has(u, "jobs.schedule")) fail(403, "You can only change your own expenses.");
}

workbook.patch("/:jobId/expenses/:id", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  await ownExpense(c, job.id);
  const f = await expenseFields(c, job.id, await body(c));
  await c.env.DB.prepare("UPDATE wb_expenses SET day = ?, type = ?, amount_cents = ?, pay = ?, description = ?, billable = ?, receipt_file = ?, updated_at = ? WHERE id = ?")
    .bind(f.day, f.type, f.amount, f.pay, f.description, f.billable ?? billableFor(job.job_number), f.receipt, now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

workbook.delete("/:jobId/expenses/:id", async (c) => {
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  await ownExpense(c, job.id);
  await c.env.DB.prepare("UPDATE wb_expenses SET removed_at = ? WHERE id = ?").bind(now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---- The job's chat ----

/** Open the job's chat, making it the first time: the engineers on the job, whoever scheduled it, and
 *  the person opening it. Someone who can fill in the work order but isn't in the chat yet is added. */
workbook.post("/:jobId/chat", async (c) => {
  const u = requirePerm(c, "boards.use");
  const db = c.env.DB;
  const job = await loadJob(db, c.req.param("jobId"));
  if (!(await canFill(db, u, job.id))) fail(403, "Only the field service engineers on this job and schedulers can open its chat.");
  const at = now();
  const add = db.prepare("INSERT OR IGNORE INTO board_members (board_id, user_id, added_at) VALUES (?,?,?)");
  if (job.chat_id) {
    const live = await db.prepare("SELECT id FROM boards WHERE id = ? AND archived_at IS NULL").bind(job.chat_id).first();
    if (live) {
      await add.bind(job.chat_id, u.id, at).run();
      return c.json({ id: job.chat_id });
    }
  }
  const { results: techs } = await db.prepare("SELECT t.user_id FROM job_techs t JOIN users u ON u.id = t.user_id AND u.status = 'active' WHERE t.job_id = ?").bind(job.id).all<{ user_id: string }>();
  const members = [...new Set([u.id, ...techs.map((t) => t.user_id), ...(job.created_by ? [job.created_by] : [])])];
  const id = randomId();
  await db.batch([
    db.prepare("INSERT INTO boards (id, kind, name, created_by, created_at) VALUES (?,'chat',?,?,?)").bind(id, `Job ${job.job_number}: ${job.customer}`.slice(0, 80), u.id, at),
    ...members.map((m) => add.bind(id, m, at)),
    db.prepare("UPDATE jobs SET chat_id = ? WHERE id = ?").bind(id, job.id),
  ]);
  await audit(db, { userId: u.id, action: "job.chat", targetType: "job", targetId: job.id, detail: { members: members.length }, ip: c.get("ip") });
  return c.json({ id });
});

// ---- Submit and reopen ----

workbook.post("/:jobId/submit", async (c) => {
  const db = c.env.DB;
  const job = await loadJob(db, c.req.param("jobId"));
  const u = await mustFill(c, job.id);
  const report = await loadReport(db, job.id);
  if (report?.status === "submitted") fail(409, "This report was already submitted.");
  const { results: entries } = await db.prepare(
    `SELECT e.day, u.name AS who, e.work, e.description, e.done, e.pct, e.issues FROM wb_entries e JOIN users u ON u.id = e.user_id
      WHERE e.job_id = ? AND e.removed_at IS NULL ORDER BY e.day, e.created_at`,
  ).bind(job.id).all<{ day: string; who: string; work: string | null; description: string; done: string | null; pct: string | null; issues: string | null }>();
  if (!entries.length) fail(400, "Add at least one day to the work log before submitting.");
  const [{ results: hours }, { results: expenses }, photos, { results: recipients }] = await Promise.all([
    db.prepare("SELECT h.*, u.name AS who FROM wb_hours h JOIN users u ON u.id = h.user_id WHERE h.job_id = ? ORDER BY h.day, u.name").bind(job.id).all<{ day: string; who: string; miles: number } & Record<HourType, number>>(),
    db.prepare("SELECT x.day, u.name AS who, x.type, x.amount_cents, x.billable, x.description FROM wb_expenses x JOIN users u ON u.id = x.user_id WHERE x.job_id = ? AND x.removed_at IS NULL ORDER BY x.day").bind(job.id).all<{ day: string; who: string; type: string; amount_cents: number; billable: string; description: string | null }>(),
    db.prepare("SELECT COUNT(*) AS n FROM job_files WHERE job_id = ? AND deleted_at IS NULL AND lower(ext) IN ('jpg','jpeg','png','webp','heic','gif')").bind(job.id).first<{ n: number }>(),
    db.prepare("SELECT u.id, u.name, u.email, n.email AS notify_email FROM wb_recipients r JOIN users u ON u.id = r.user_id AND u.status = 'active' LEFT JOIN notice_emails n ON n.user_id = u.id ORDER BY u.name").all<{ id: string; name: string; email: string; notify_email: string | null }>(),
  ]);
  const at = now();
  const blank = { scope: null, summary: null, open_issues: null, sign_name: null, sign_title: null, sign_date: null, signature: null };
  const mail = reportText({
    job, report: report ?? blank, entries, hours, expenses, photos: photos?.n ?? 0, by: u.name,
    link: jobLink(c.env.ORIGIN, job.id, true),
  });
  // Problems found become quick notes in the knowledge base, on the machine, for the next engineer.
  const notes: string[] = [];
  for (const e of entries) {
    for (const issue of issueLines(e.issues)) {
      notes.push(await addQuickNote(db, u.id, { title: issue, serial: job.machine, issue: `${issue}\n\nFound on job ${job.job_number} (${job.customer}) on ${e.day} by ${e.who}.`, fix: e.description }));
    }
  }
  await db.prepare(
    `INSERT INTO wb_reports (job_id, status, submitted_by, submitted_at, revision, updated_by, updated_at) VALUES (?, 'submitted', ?, ?, 1, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET status = 'submitted', submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at,
       revision = wb_reports.revision + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(job.id, u.id, at, u.id, at).run();
  const replyTo = mailTo({ email: u.email, notify_email: null }) ?? undefined;
  const sent = [];
  for (const r of recipients) {
    const to = mailTo(r);
    const status = to ? await sendMail(c.env, { to, subject: mail.subject, text: mail.text, html: htmlOf(mail.text), replyTo }) : "no_address";
    sent.push({ name: r.name, to, status });
  }
  await audit(db, { userId: u.id, action: "workbook.submit", targetType: "job", targetId: job.id, detail: { notes, sent: sent.map((s) => ({ to: s.name, status: s.status })) }, ip: c.get("ip") });
  // When email isn't set up, the app offers the same email to send from the engineer's own email app.
  return c.json({ ok: true, notes, sent, subject: mail.subject, text: mail.text });
});

workbook.post("/:jobId/reopen", async (c) => {
  const u = requirePerm(c, "jobs.schedule");
  const job = await loadJob(c.env.DB, c.req.param("jobId"));
  const r = await loadReport(c.env.DB, job.id);
  if (r?.status !== "submitted") fail(409, "This report isn't submitted.");
  await c.env.DB.prepare("UPDATE wb_reports SET status = 'draft', revision = revision + 1, updated_by = ?, updated_at = ? WHERE job_id = ?").bind(u.id, now(), job.id).run();
  await audit(c.env.DB, { userId: u.id, action: "workbook.reopen", targetType: "job", targetId: job.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

function htmlOf(text: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(text)}</div>`;
}

// ---- Billing: every engineer's billable hours and expenses for one week ----

workbook.get("/billing/week", async (c) => {
  requirePerm(c, "workbook.billing");
  const start = mondayOf(isDay(c.req.query("start")) ? c.req.query("start")! : now().slice(0, 10));
  const end = addDays(start, 6);
  const db = c.env.DB;
  const [{ results: hours }, { results: expenses }] = await Promise.all([
    db.prepare(`SELECT h.*, u.name AS who, j.job_number, j.customer, j.machine FROM wb_hours h JOIN users u ON u.id = h.user_id JOIN jobs j ON j.id = h.job_id
                 WHERE h.day BETWEEN ? AND ? ORDER BY u.name, h.day`).bind(start, end).all(),
    db.prepare(`SELECT x.*, u.name AS who, j.job_number, j.customer FROM wb_expenses x JOIN users u ON u.id = x.user_id JOIN jobs j ON j.id = x.job_id
                 WHERE x.removed_at IS NULL AND x.day BETWEEN ? AND ? ORDER BY u.name, x.day`).bind(start, end).all(),
  ]);
  return c.json({ start, end, hours, expenses });
});

// ---- Who gets submitted reports ----

workbook.get("/settings/recipients", async (c) => {
  requirePerm(c, "settings.manage");
  const { results } = await c.env.DB.prepare("SELECT u.id, u.name FROM wb_recipients r JOIN users u ON u.id = r.user_id AND u.status = 'active' ORDER BY u.name").all();
  return c.json({ recipients: results });
});

workbook.put("/settings/recipients", async (c) => {
  const u = requirePerm(c, "settings.manage");
  const b = await body(c);
  if (!Array.isArray(b.userIds) || b.userIds.some((x) => typeof x !== "string") || b.userIds.length > 30) fail(400, "Pick people from the list.");
  const ids = [...new Set(b.userIds as string[])];
  const db = c.env.DB;
  if (ids.length) {
    const { results } = await db.prepare(`SELECT id FROM users WHERE status = 'active' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    if (results.length !== ids.length) fail(400, "Someone you picked can't be found.");
  }
  const at = now();
  await db.batch([
    db.prepare("DELETE FROM wb_recipients"),
    ...ids.map((id) => db.prepare("INSERT INTO wb_recipients (user_id, added_by, added_at) VALUES (?,?,?)").bind(id, u.id, at)),
  ]);
  await audit(db, { userId: u.id, action: "workbook.recipients", targetType: "settings", targetId: "workbook", detail: { userIds: ids }, ip: c.get("ip") });
  return c.json({ ok: true });
});

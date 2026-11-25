// DEMO ONLY. Tech jobs and the Ronchi workbook's Work orders in the preview, with example jobs.
// Customers, contacts and addresses are made up. Email isn't set up in the preview, so every job
// email comes back "not sent" with the button to send it from your own email.
import { fileInfo, fileProblem, cleanName } from "../../../src/shared/files";
import { isJobStatus, jobEmail, jobLink, mapLinks, normalizeDays } from "../../../src/shared/jobs";
import { addDays, billableFor, cleanHours, EXPENSE_TYPES, HOUR_KEYS, isDay, mondayOf, PAY, PCT, reportText, SCOPES, toCents, type Hours } from "../../../src/shared/workbook";

export class JobsFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface U { id: string; name: string; email: string; role: string; status: string; notify_email?: string | null }
interface Ctx { me: U; perms: Set<string>; users: U[]; machines: { id: string; serial: string; model: string | null; customer: string | null; site: string | null; notes: string | null; sharepoint_url: string | null }[]; newId: () => string; pdf: (title: string) => Blob }

let jobs: any[] | null = null;
let techs: { job_id: string; user_id: string; email_status: string | null; emailed_at: string | null }[] = [];
let files: any[] = [];
let workbook = true;

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const days = (from: number, count: number) => Array.from({ length: count }, (_, i) => day(from + i));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mailTo = (u: U) => (u.notify_email && EMAIL.test(u.notify_email) ? u.notify_email : EMAIL.test(u.email) ? u.email : null);

function seed(c: Ctx) {
  const by = (n: string) => c.users.find((u) => u.name === n)!;
  const meagan = by("Meagan Hooper");
  const at = new Date(Date.now() - 3 * 86400000).toISOString();
  const j = (job_number: string, customer: string, machine: string, location: string, contact: [string, string, string], d: string[], notes: string, status: string, people: string[]) => {
    const id = c.newId();
    const row = { id, job_number, customer, machine, location, contact_name: contact[0], contact_phone: contact[1], contact_email: contact[2], work_days: d, first_day: d[0] ?? null, last_day: d[d.length - 1] ?? null, notes, status, revision: 1, created_by: meagan.id, updated_by: meagan.id, created_at: at, updated_at: at };
    for (const p of people) techs.push({ job_id: id, user_id: by(p).id, email_status: status === "scheduled" ? "sent" : null, emailed_at: status === "scheduled" ? at : null });
    return row;
  };
  jobs = [
    j("J-1042", "Example Foods Inc.", "4222TP", "1200 Example Pkwy\nAtlanta, GA 30336", ["Dana Smith", "(404) 555-0142", "dana.smith@example.com"], days(2, 3),
      "Line 2 changeover to 1 L. Bring the piston resize kit and the O-ring kit.\nPlant wants us on site by 8 AM. Safety glasses and steel toes.", "scheduled", ["Patrick Morgan", "Elim Ramirez"]),
    j("J-1043", "Example Pharma Co.", "3069MB", "4500 Example Rd\nColumbus, OH 43219", ["Lee Park", "(614) 555-0199", "lpark@example.com"], days(9, 2),
      "Preventive maintenance on the capper. Check clutch torque across a full shift.", "scheduled", ["Andrew Jackson"]),
    j("J-1017", "Example Foods Inc.", "4222TP", "1200 Example Pkwy\nAtlanta, GA 30336", ["Dana Smith", "(404) 555-0142", "dana.smith@example.com"], days(-62, 4),
      "Installation and start-up. Trained two operators on changeover and cleaning.", "done", ["Patrick Morgan"]),
    j("J-0988", "Example Foods Inc.", "4222TP", "1200 Example Pkwy\nAtlanta, GA 30336", ["Dana Smith", "(404) 555-0142", "dana.smith@example.com"], days(-21, 1),
      "Short fills on heads 7 and 8. O-rings were flat; replaced both. Fill weights back in spec.", "done", ["Steve Williams"]),
    j("J-1031", "Example Home Care", "4212MB", "88 Example Ave\nChicago, IL 60609", ["Sam Ortiz", "(312) 555-0110", "sam.ortiz@example.com"], days(-7, 2),
      "Trigger sprayer cap chuck set fitted and tested.", "done", ["Elim Ramirez", "Carlos"]),
  ];
  const [, , install, shortfill] = jobs;
  files.push(
    { id: c.newId(), job_id: install.id, user_id: by("Patrick Morgan").id, name: "Service report J-1017 installation.pdf", ext: "pdf", size: 0, created_at: at, blob: c.pdf("Service report J-1017 installation (example)") },
    { id: c.newId(), job_id: shortfill.id, user_id: by("Steve Williams").id, name: "Service report J-0988.pdf", ext: "pdf", size: 0, created_at: at, blob: c.pdf("Service report J-0988 (example)") },
    { id: c.newId(), job_id: shortfill.id, user_id: by("Steve Williams").id, name: "Fill weights heads 1-12.csv", ext: "csv", size: 0, created_at: at, blob: new Blob(["Head,Target g,Actual g\n7,500.0,499.8\n8,500.0,500.1\n"], { type: "text/csv" }) },
  );
  for (const f of files) { f.size = f.blob.size; f.url = URL.createObjectURL(f.blob); }
}

/** The example jobs, for the shipping preview (Ship parts for this job). */
export const demoJobs = () => jobs ?? [];

export function resetJobs() {
  jobs = null;
  techs = [];
  files = [];
  workbook = true;
}

const can = (c: Ctx, p: string) => c.perms.has(p);

export function jobsRoute(method: string, seg: string[], q: URLSearchParams, body: any, c: Ctx): unknown {
  if (!jobs) seed(c);
  const list = jobs!;
  const name = (id: string) => c.users.find((u) => u.id === id)?.name ?? "";
  const techsOf = (jid: string) => techs.filter((t) => t.job_id === jid).map((t) => ({ id: t.user_id, name: name(t.user_id), email_status: t.email_status, emailed_at: t.emailed_at })).sort((a, b) => a.name.localeCompare(b.name));
  // Expense receipts show money, so they stay out of the job's file list (as on the server).
  const filesOf = (jid: string) => files.filter((f) => f.job_id === jid && !f.deleted && !isReceipt(f.id)).map(({ blob: _b, ...f }) => ({ ...f, by_name: name(f.user_id) }));
  const find = (id: string) => {
    const j = list.find((x) => x.id === id);
    if (!j) throw new JobsFail(404, "Not found.");
    return j;
  };
  const email = (j: any, ids: string[]) => ids.map((uid) => {
    const u = c.users.find((x) => x.id === uid)!;
    const to = mailTo(u);
    const status = to ? "not_set_up" : "no_address";
    const t = techs.find((x) => x.job_id === j.id && x.user_id === uid);
    if (t) { t.email_status = status; t.emailed_at = null; }
    const m = jobEmail(j, { link: jobLink(location.origin, j.id, workbook), name: u.name.split(" ")[0]!, by: c.me.name });
    return { userId: uid, name: u.name, status, to, subject: m.subject, text: m.text };
  });
  const clean = (b: any, j: any) => {
    for (const k of ["job_number", "customer", "machine", "location", "contact_name", "contact_phone", "contact_email", "notes"]) if (k in b) j[k] = (typeof b[k] === "string" ? b[k].trim() : "") || null;
    if (j.machine) j.machine = j.machine.toUpperCase();
    if (!j.job_number) throw new JobsFail(400, "Job number is required.");
    if (!j.customer) throw new JobsFail(400, "Customer is required.");
    if (list.some((x) => x !== j && x.job_number.toLowerCase() === j.job_number.toLowerCase())) throw new JobsFail(409, `Job number ${j.job_number} is already used.`);
    if ("work_days" in b) {
      try { j.work_days = normalizeDays(b.work_days); } catch (e) { throw new JobsFail(400, (e as Error).message); }
      j.first_day = j.work_days[0] ?? null;
      j.last_day = j.work_days[j.work_days.length - 1] ?? null;
    }
    if (b.status !== undefined && isJobStatus(b.status)) j.status = b.status;
  };

  if (seg[0] === "switches") {
    if (method === "PUT") {
      if (!can(c, "users.manage")) throw new JobsFail(403, "Your role doesn't allow this.");
      workbook = body.on === true;
    }
    return { switches: { workbook } };
  }

  // seg[0] === "jobs"
  if (seg[1] === "staff") return { people: c.users.filter((u) => u.status === "active").sort((a, b) => Number(b.role === "tech") - Number(a.role === "tech") || a.name.localeCompare(b.name)).map((u) => ({ id: u.id, name: u.name, role: u.role, emailTo: mailTo(u) })) };
  if (seg[1] === "files" && method === "DELETE") {
    const f = files.find((x) => x.id === seg[2]);
    if (!f) throw new JobsFail(404, "Not found.");
    f.deleted = true;
    return { ok: true };
  }
  if (!seg[1] && method === "GET") {
    const view = q.get("view") ?? "upcoming";
    const s = (q.get("q") ?? "").toLowerCase();
    const today = day(0);
    let out = list.filter((j) => {
      if (view === "mine" && !techs.some((t) => t.job_id === j.id && t.user_id === c.me.id)) return false;
      const past = (j.last_day && j.last_day < today) || j.status === "done" || j.status === "cancelled";
      if ((view === "upcoming" || view === "mine") && past) return false;
      if (view === "past" && !past) return false;
      return !s || [j.job_number, j.customer, j.machine, j.location].some((v) => (v ?? "").toLowerCase().includes(s));
    });
    out = out.sort((a, b) => (view === "past" ? (b.first_day ?? "").localeCompare(a.first_day ?? "") : (a.first_day ?? "9").localeCompare(b.first_day ?? "9")));
    return { jobs: out.map((j) => ({ ...j, techs: techsOf(j.id), files: filesOf(j.id).length })) };
  }
  if (!seg[1] && method === "POST") {
    if (!can(c, "jobs.schedule")) throw new JobsFail(403, "Your role doesn't allow this.");
    const now = new Date().toISOString();
    const j: any = { id: c.newId(), work_days: [], first_day: null, last_day: null, status: "scheduled", revision: 1, created_at: now, updated_at: now };
    clean(body, j);
    list.push(j);
    const ids: string[] = body.techIds ?? [];
    for (const uid of ids) techs.push({ job_id: j.id, user_id: uid, email_status: null, emailed_at: null });
    return { id: j.id, emails: email(j, ids) };
  }
  const j = find(seg[1]!);
  if (seg[2] === "workbook") {
    if (!workbook) throw new JobsFail(404, "Not found.");
    const key = j.machine ? "machine" : "customer";
    const log = list.filter((x) => x.id !== j.id && x.status !== "cancelled" && (x[key] ?? "").toLowerCase() === (j[key] ?? "").toLowerCase()).sort((a, b) => (b.first_day ?? "").localeCompare(a.first_day ?? ""));
    const full = (x: any) => ({ ...x, techs: techsOf(x.id), files: filesOf(x.id) });
    const machine = c.machines.find((m) => m.serial === j.machine) ?? null;
    return { job: full(j), log: log.map(full), logBy: key, machine, notes: [], orders: [], maps: j.location ? mapLinks(j.location) : null };
  }
  if (seg[2] === "files") {
    const fl: File[] = body.files ?? [];
    for (const f of fl) {
      const p = fileProblem(f.name, f.size);
      if (p) throw new JobsFail(400, `${cleanName(f.name)}: ${p}`);
    }
    const ids: string[] = [];
    for (const f of fl) {
      const id = c.newId();
      ids.push(id);
      files.unshift({ id, job_id: j.id, user_id: c.me.id, name: cleanName(f.name), ext: fileInfo(f.name)!.ext, size: f.size, created_at: new Date().toISOString(), blob: f, url: URL.createObjectURL(f) });
    }
    return { ids };
  }
  if (seg[2] === "email") return { emails: email(j, techs.filter((t) => t.job_id === j.id).map((t) => t.user_id)) };
  if (method === "PATCH") {
    if (body.revision !== j.revision) throw new JobsFail(409, "Someone else changed this job while you were editing. Reload to see their changes.");
    clean(body, j);
    j.revision++;
    let added: string[] = [];
    if (Array.isArray(body.techIds)) {
      const had = techs.filter((t) => t.job_id === j.id).map((t) => t.user_id);
      added = body.techIds.filter((x: string) => !had.includes(x));
      techs = techs.filter((t) => t.job_id !== j.id || body.techIds.includes(t.user_id));
      for (const uid of added) techs.push({ job_id: j.id, user_id: uid, email_status: null, emailed_at: null });
    }
    return { ok: true, revision: j.revision, emails: email(j, added) };
  }
  const machine = c.machines.find((m) => m.serial === j.machine);
  return { job: j, techs: techsOf(j.id), files: filesOf(j.id), machine: machine ? { id: machine.id, serial: machine.serial } : null, maps: j.location ? mapLinks(j.location) : null, workbook };
}

// ---- The Ronchi workbook (a job's Work order tab) in the preview. Kept in memory, like the jobs. ----
// Email isn't set up in the preview, so Submit hands back the email to send from your own email app.

interface Wb { report: any; entries: any[]; hours: any[]; expenses: any[]; photos: Record<string, { caption: string | null; recipe_screen: string | null }> }
const books = new Map<string, Wb>();
let recipients: string[] = [];
const book = (id: string): Wb => {
  let b = books.get(id);
  if (!b) books.set(id, (b = { report: { job_id: id, status: "draft", revision: 0 }, entries: [], hours: [], expenses: [], photos: {} }));
  return b;
};
const nameOf = (c: Ctx, id: string) => c.users.find((u) => u.id === id)?.name ?? "";
function isReceipt(fileId: string) {
  for (const b of books.values()) if (b.expenses.some((e) => e.receipt_file === fileId)) return true;
  return false;
}
const isPhoto = (ext: string) => ["jpg", "jpeg", "png", "webp", "heic", "gif"].includes(ext.toLowerCase());

export function resetWorkbook() {
  books.clear();
  recipients = [];
}

// Same rule as the server: only schedulers and billing see dollar amounts.
const seesMoney = (c: Ctx) => can(c, "jobs.schedule") || can(c, "workbook.billing");

export function workbookRoute(method: string, seg: string[], q: URLSearchParams, body: any, c: Ctx): unknown {
  if (!jobs) seed(c);
  if (!workbook) throw new JobsFail(404, "Not found.");
  const list = jobs!;
  if (seg[1] === "settings" && seg[2] === "recipients") {
    if (!can(c, "settings.manage")) throw new JobsFail(403, "Your role doesn't allow this.");
    if (method === "PUT") recipients = [...new Set<string>(body.userIds ?? [])];
    return method === "PUT" ? { ok: true } : { recipients: recipients.map((id) => ({ id, name: nameOf(c, id) })) };
  }
  if (seg[1] === "billing") {
    if (!can(c, "workbook.billing")) throw new JobsFail(403, "Your role doesn't allow this.");
    const start = mondayOf(isDay(q.get("start")) ? q.get("start")! : day(0));
    const end = addDays(start, 6);
    const hours: any[] = [];
    const expenses: any[] = [];
    for (const [jobId, b] of books) {
      const j = list.find((x) => x.id === jobId);
      for (const h of b.hours) if (h.day >= start && h.day <= end) hours.push({ ...h, job_number: j?.job_number, customer: j?.customer, machine: j?.machine });
      for (const x of b.expenses) if (x.day >= start && x.day <= end) expenses.push({ ...x, job_number: j?.job_number, customer: j?.customer });
    }
    return { start, end, hours, expenses };
  }
  const j = list.find((x) => x.id === seg[1]);
  if (!j) throw new JobsFail(404, "Not found.");
  const b = book(j.id);
  const onJob = techs.some((t) => t.job_id === j.id && t.user_id === c.me.id);
  const fill = onJob || can(c, "jobs.schedule");
  const mustFill = () => { if (!fill) throw new JobsFail(403, "Only the field service engineers on this job and schedulers can fill in its work order."); };
  const mustBeOpen = () => { if (b.report.status === "submitted") throw new JobsFail(409, "This report was submitted. A scheduler can reopen it if something needs changing."); };
  const now = new Date().toISOString();
  const who = (wanted: unknown) => (typeof wanted === "string" && wanted && can(c, "jobs.schedule") ? wanted : c.me.id);

  if (!seg[2]) {
    const crew = fill || can(c, "workbook.billing");
    const money = seesMoney(c);
    const receipts = new Set([...books.values()].flatMap((x) => x.expenses.map((e) => e.receipt_file)).filter(Boolean));
    const photos = files.filter((f) => f.job_id === j.id && !f.deleted && isPhoto(f.ext) && !receipts.has(f.id)).map((f) => ({ id: f.id, name: f.name, ext: f.ext, created_at: f.created_at, url: f.url, ...(b.photos[f.id] ?? { caption: null, recipe_screen: null }) }));
    return {
      report: { ...b.report, submitted_by_name: b.report.submitted_by ? nameOf(c, b.report.submitted_by) : null },
      entries: b.entries.filter((e) => !e.removed).map((e) => ({ ...e, who: nameOf(c, e.user_id) })),
      photos,
      hours: crew ? b.hours.map((h) => ({ ...h, who: nameOf(c, h.user_id) })) : null,
      expenses: crew ? b.expenses.map(({ amount_cents, ...x }) => ({ ...x, ...(money ? { amount_cents } : {}), who: nameOf(c, x.user_id) })) : null,
      money,
      recipients: recipients.map((id) => ({ id, name: nameOf(c, id) })),
      chat: null, canFill: fill, canSchedule: can(c, "jobs.schedule"), billable: billableFor(j.job_number),
      lists: { scopes: SCOPES, pct: PCT, expenseTypes: EXPENSE_TYPES, pay: PAY },
    };
  }
  if (seg[2] === "chat") throw new JobsFail(400, "Job chats aren't part of the preview.");
  if (seg[2] === "reopen") {
    if (!can(c, "jobs.schedule")) throw new JobsFail(403, "Your role doesn't allow this.");
    if (b.report.status !== "submitted") throw new JobsFail(409, "This report isn't submitted.");
    b.report = { ...b.report, status: "draft", revision: b.report.revision + 1 };
    return { ok: true };
  }
  mustFill();
  if (seg[2] === "report") {
    mustBeOpen();
    if ((body.revision ?? 0) !== b.report.revision) throw new JobsFail(409, "Someone else changed this report. Reload to see their changes, then save yours again.");
    const keys = ["scope", "summary", "open_issues", "sign_name", "sign_title", "sign_date", "signature"];
    const next = { ...b.report };
    for (const k of keys) if (body[k] !== undefined) next[k] = body[k] === "" ? null : body[k];
    next.revision = b.report.revision + 1;
    b.report = next;
    return { ok: true, revision: next.revision };
  }
  if (seg[2] === "photos") {
    b.photos[seg[3]!] = { caption: body.caption || null, recipe_screen: body.recipe_screen || null };
    return { ok: true };
  }
  if (seg[2] === "submit") {
    mustBeOpen();
    const entries = b.entries.filter((e) => !e.removed).map((e) => ({ ...e, who: nameOf(c, e.user_id) }));
    if (!entries.length) throw new JobsFail(400, "Add at least one day to the work log before submitting.");
    b.report = { ...b.report, status: "submitted", submitted_by: c.me.id, submitted_at: now, revision: b.report.revision + 1 };
    const mail = reportText({
      job: j, report: b.report, entries, hours: b.hours.map((h) => ({ ...h, who: nameOf(c, h.user_id) })),
      expenses: b.expenses.map((x) => ({ ...x, who: nameOf(c, x.user_id) })), photos: files.filter((f) => f.job_id === j.id && !f.deleted && isPhoto(f.ext) && !isReceipt(f.id)).length,
      by: c.me.name, link: jobLink(location.origin, j.id, true), amounts: seesMoney(c),
    });
    return { ok: true, notes: [], sent: recipients.map((id) => ({ name: nameOf(c, id), to: null, status: "not_configured" })), subject: mail.subject, text: mail.text };
  }
  mustBeOpen();
  if (seg[2] === "entries") {
    if (method === "DELETE") {
      const e = b.entries.find((x) => x.id === seg[3]);
      if (e) e.removed = true;
      return { ok: true };
    }
    if (!String(body.description ?? "").trim()) throw new JobsFail(400, "Write what was done that day.");
    const e = { id: c.newId(), user_id: who(body.user_id), day: body.day, work: body.work || null, description: String(body.description).trim(), done: body.done || null, pct: body.pct || null, issues: body.issues || null, updated_at: now };
    if (method === "PATCH") Object.assign(b.entries.find((x) => x.id === seg[3]) ?? {}, { ...e, id: seg[3] });
    else b.entries.push(e);
    return method === "PATCH" ? { ok: true } : { id: e.id };
  }
  if (seg[2] === "hours") {
    let h: Hours;
    try { h = cleanHours(body); } catch (e) { throw new JobsFail(400, (e as Error).message); }
    const uid = who(body.user_id);
    b.hours = b.hours.filter((x) => !(x.user_id === uid && x.day === body.day));
    if (HOUR_KEYS.every((k) => !h[k]) && !h.miles) return { ok: true, removed: true };
    b.hours.push({ id: c.newId(), job_id: j.id, user_id: uid, day: body.day, ...h, note: body.note || null, updated_at: now });
    b.hours.sort((x, y) => x.day.localeCompare(y.day));
    return { ok: true };
  }
  if (seg[2] === "expenses") {
    if (method === "DELETE") {
      b.expenses = b.expenses.filter((x) => x.id !== seg[3]);
      return { ok: true };
    }
    let amount: number;
    try { amount = toCents(body.amount); } catch (e) { throw new JobsFail(400, (e as Error).message); }
    if (!body.type) throw new JobsFail(400, "Choose the kind of expense.");
    const x = { id: c.newId(), job_id: j.id, user_id: who(body.user_id), day: body.day, type: body.type, amount_cents: amount, pay: body.pay || "Credit", description: body.description || null, billable: body.billable || billableFor(j.job_number), receipt_file: body.receipt_file || null, created_at: now, updated_at: now };
    if (method === "PATCH") Object.assign(b.expenses.find((y) => y.id === seg[3]) ?? {}, { ...x, id: seg[3] });
    else b.expenses.push(x);
    return method === "PATCH" ? { ok: true } : { id: x.id };
  }
  throw new JobsFail(404, "Not found.");
}

// DEMO ONLY. The Ronchi workbook's job paperwork in the preview: time sheets, service reports and job chats,
// answered from example data with the same checks as the real server (src/shared/reports.ts).
// Everyone and everything here is made up. No money amounts, like the real portal.
import { cleanName, fileInfo, fileProblem } from "../../../src/shared/files";
import { addDays, cleanReport, cleanRow, next, sheetTotals, workMinutes, type ChildKind, type DocAction, type DocStatus } from "../../../src/shared/reports";
import { jobsState } from "./jobs-mock";

export class ReportsFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface U { id: string; name: string; email: string; role: string; status: string }
interface Ctx {
  me: U; perms: Set<string>; users: U[]; newId: () => string;
  machines: any[]; pdf: (title: string) => Blob;
  /** Make the job's chat in the preview's chats (mock.ts), with its people and a few example messages. */
  makeChat: (name: string, createdBy: string, members: string[], posts: { by: string; body: string; minutesAgo: number }[]) => string;
  joinChat: (boardId: string, userId: string) => void;
  isMember: (boardId: string, userId: string) => boolean;
}
type Kind = "sheet" | "service";
interface Doc { id: string; kind: Kind; job_id: string; user_id: string; status: DocStatus; review_note: string | null; sent_at: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string; updated_at: string; [k: string]: any }

let docs: Doc[] | null = null;
let rows: Record<ChildKind, any[]> = { days: [], expenses: [], log: [], parts: [] };
let files: any[] = [];
let chats: Record<string, string> = {};

const iso = (d = new Date()) => d.toISOString();
const dayIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const CHILD_DOC: Record<ChildKind, Kind> = { days: "sheet", expenses: "sheet", log: "service", parts: "service" };
const FK: Record<ChildKind, string> = { days: "sheet_id", expenses: "sheet_id", log: "report_id", parts: "report_id" };

function seed(c: Ctx) {
  docs = [];
  const { jobs } = jobsState(c as never);
  const user = (n: string) => c.users.find((u) => u.name === n)!;
  const job = (num: string) => jobs.find((j: any) => j.job_number === num)!;
  const meagan = user("Meagan Hooper");
  const doc = (kind: Kind, num: string, who: string, status: DocStatus, more: Partial<Doc> = {}): Doc => {
    const d: Doc = { id: c.newId(), kind, job_id: job(num).id, user_id: user(who).id, status, review_note: null, sent_at: status === "draft" ? null : ago(20), reviewed_by: status === "approved" || status === "returned" ? meagan.id : null, reviewed_at: status === "approved" || status === "returned" ? ago(6) : null, created_at: ago(60), updated_at: ago(20), summary: null, recipe: null, follow_up: null, signer_name: null, signer_title: null, signed_on: null, signature_file_id: null, ...more };
    docs!.push(d);
    return d;
  };
  const day = (s: Doc, date: string, start: string, end: string, brk: number, travel: number, prod: number, notes: string, billable = 1) =>
    rows.days.push({ id: c.newId(), sheet_id: s.id, work_date: date, start_time: start, end_time: end, break_min: brk, travel_min: travel, production_min: prod, billable, notes, created_at: s.created_at, updated_at: s.updated_at });
  const exp = (s: Doc, date: string, type: string, description: string, quantity: number | null) =>
    rows.expenses.push({ id: c.newId(), sheet_id: s.id, exp_date: date, type, description, quantity, created_at: s.created_at, updated_at: s.updated_at });
  const log = (r: Doc, date: string, text: string) => rows.log.push({ id: c.newId(), report_id: r.id, work_date: date, text, created_at: r.created_at, updated_at: r.updated_at });
  const part = (r: Doc, kind: string, code: string, description: string, qty: number) => rows.parts.push({ id: c.newId(), report_id: r.id, kind, part_code: code, description, qty, created_at: r.created_at, updated_at: r.updated_at });

  // J-1031, done last week: Elim's paperwork waits for review, Carlos's time sheet is approved.
  const j1031 = job("J-1031").work_days as string[];
  const elim = doc("sheet", "J-1031", "Elim Ramirez", "sent");
  day(elim, j1031[0]!, "07:00", "16:30", 30, 150, 300, "Fly in, fit the cap chuck set");
  day(elim, j1031[1]!, "07:00", "15:00", 30, 150, 360, "Trials on 3 formats, fly home");
  exp(elim, j1031[0]!, "airfare", "ATL to ORD and back", 2);
  exp(elim, j1031[0]!, "hotel", "Hotel by the plant", 1);
  exp(elim, j1031[0]!, "rental_car", "Airport pickup", 2);
  const carlos = doc("sheet", "J-1031", "Carlos", "approved");
  day(carlos, j1031[0]!, "07:30", "16:30", 30, 150, 300, "Cap chuck set");
  day(carlos, j1031[1]!, "07:00", "14:30", 30, 150, 300, "Trials, sign-off");
  exp(carlos, j1031[0]!, "mileage", "Home to airport and back", 46);
  const rep = doc("service", "J-1031", "Elim Ramirez", "sent", { summary: "Fitted the new trigger sprayer cap chuck set on the 4212MB and set torque for the three formats. All heads within spec after a two-hour run.", recipe: "Format 750 ml: cap torque 14 in-lb, speed 85 bpm\nFormat 500 ml: cap torque 12 in-lb, speed 95 bpm", follow_up: "Replace the worn star wheel guide at the next visit.", signer_name: "Sam Ortiz", signer_title: "Maintenance lead", signed_on: j1031[1]! });
  log(rep, j1031[0]!, "Removed the old chucks, fitted the new set, set heights on all heads.");
  log(rep, j1031[1]!, "Torque trials on three formats with the operators. Two-hour run, no rejects.");
  part(rep, "used", "21.448.017", "Cap chuck insert, trigger sprayer", 8);
  part(rep, "needed", "21.310.204", "Star wheel guide, outfeed", 1);

  // J-0988, done three weeks ago: approved.
  const j0988 = job("J-0988").work_days as string[];
  const steve = doc("sheet", "J-0988", "Steve Williams", "approved");
  day(steve, j0988[0]!, "08:00", "17:00", 45, 60, 420, "Short fills heads 7 and 8");

  // J-1045, on site now: the signed-in person and Patrick are filling theirs in.
  const j1045 = job("J-1045");
  const mine = doc("sheet", "J-1045", "Aaron Lewis", "draft");
  day(mine, j1045.work_days[0], "07:00", "16:00", 30, 120, 360, "Changeover to 500 ml");
  exp(mine, j1045.work_days[0], "mileage", "Airport to plant", 38);
  exp(mine, j1045.work_days[0], "hotel", "Hotel by the plant", 3);
  const myRep = doc("service", "J-1045", "Aaron Lewis", "draft", { summary: "Changeover of line 1 from 1 L to 500 ml. Piston resize kit fitted on all 12 heads." });
  log(myRep, j1045.work_days[0], "Fitted the piston resize kit, set nozzle heights. First fill weight check: heads 3 and 9 light.");
  part(myRep, "used", "12.345.678", "O-ring 38 mm, piston", 12);
  const patrick = doc("sheet", "J-1045", "Patrick Morgan", "draft");
  day(patrick, j1045.work_days[0], "07:00", "16:30", 30, 120, 360, "Changeover");

  const people = [user("Patrick Morgan").id, user("Aaron Lewis").id, meagan.id];
  chats[j1045.id] = c.makeChat(`Job ${j1045.job_number} · ${j1045.customer}`, meagan.id, people, [
    { by: "Meagan Hooper", body: "Plant contact is Dana Smith at the main gate. Badges are waiting at security.", minutesAgo: 26 * 60 },
    { by: "Patrick Morgan", body: "On site. Line 1 is stopped and locked out, starting the changeover.", minutesAgo: 25 * 60 },
    { by: "Patrick Morgan", body: "Heads 3 and 9 are light after the first check. Adjusting the offsets now.", minutesAgo: 90 },
  ]);
}

export function resetReports() {
  docs = null;
  rows = { days: [], expenses: [], log: [], parts: [] };
  files = [];
  chats = {};
}

export function reportsRoute(method: string, seg: string[], q: URLSearchParams, body: any, c: Ctx): unknown {
  if (!docs) seed(c);
  const { jobs, techs } = jobsState(c as never);
  const can = (p: string) => c.perms.has(p);
  const reviewer = can("reports.review");
  if (!can("reports.write") && !reviewer) throw new ReportsFail(403, "Your role doesn't allow this.");
  const name = (id: string | null) => c.users.find((u) => u.id === id)?.name ?? null;
  const jobOf = (id: string) => {
    const j = jobs.find((x: any) => x.id === id);
    if (!j) throw new ReportsFail(404, "Not found.");
    return j;
  };
  const techsOf = (jid: string) => techs.filter((t) => t.job_id === jid).map((t) => ({ id: t.user_id, name: name(t.user_id)! })).sort((a, b) => a.name.localeCompare(b.name));
  const jobFor = (id: string) => ({ ...jobOf(id), techs: techsOf(id) });
  const filesOf = (d: Doc) => files.filter((f) => f.doc_id === d.id && !f.deleted).map(({ blob: _b, ...f }) => f);
  const rowsOf = (child: ChildKind, d: Doc) => rows[child].filter((r) => r[FK[child]] === d.id).sort((a, b) => String(a.work_date ?? a.exp_date ?? a.kind).localeCompare(String(b.work_date ?? b.exp_date ?? b.kind)));
  const fullSheet = (d: Doc) => {
    const ds = rowsOf("days", d);
    const fs = filesOf(d);
    return { ...d, user_name: name(d.user_id), reviewer_name: name(d.reviewed_by), days: ds.map((x) => ({ ...x, work_min: workMinutes(x) })), expenses: rowsOf("expenses", d).map((e) => ({ ...e, receipt: fs.find((f) => f.purpose === "receipt" && f.row_id === e.id) ?? null })), totals: sheetTotals(ds) };
  };
  const fullReport = (d: Doc) => {
    const fs = filesOf(d);
    return { report: { ...d, user_name: name(d.user_id), reviewer_name: name(d.reviewed_by), signature: fs.find((f) => f.id === d.signature_file_id) ?? null }, log: rowsOf("log", d), parts: rowsOf("parts", d), photos: fs.filter((f) => f.purpose === "photo") };
  };
  const load = (kind: Kind, id: string) => {
    const d = docs!.find((x) => x.id === id && x.kind === kind);
    if (!d || (d.user_id !== c.me.id && !reviewer)) throw new ReportsFail(404, "Not found.");
    return d;
  };
  const mustEdit = (d: Doc) => {
    if (d.user_id !== c.me.id) throw new ReportsFail(403, "Only the field service engineer who wrote this can change it.");
    if (d.status === "sent") throw new ReportsFail(409, "This was sent for review. Take it back to make changes.");
    if (d.status === "approved") throw new ReportsFail(409, "This is approved and locked. A reviewer can send it back if it needs a change.");
  };
  const store = (d: Doc, list: File[], purpose: string, rowId: string | null = null) => {
    if (!list.length) throw new ReportsFail(400, "Choose a file to add.");
    for (const f of list) {
      const p = fileProblem(f.name, f.size);
      if (p) throw new ReportsFail(400, `${cleanName(f.name)}: ${p}`);
    }
    d.updated_at = iso();
    return list.map((f) => {
      const row = { id: c.newId(), doc_kind: d.kind, doc_id: d.id, purpose, row_id: rowId, name: cleanName(f.name), ext: fileInfo(f.name)!.ext, size: f.size, caption: null, created_at: iso(), url: URL.createObjectURL(f) };
      files.push(row);
      return row.id;
    });
  };

  if (seg[1] === "jobs") {
    const job = jobOf(seg[2]!);
    const onJob = techs.some((t) => t.job_id === job.id && t.user_id === c.me.id);
    if (seg[3] === "start") {
      if (!onJob) throw new ReportsFail(403, "Only the field service engineers on this job can fill in its paperwork.");
      for (const kind of ["sheet", "service"] as Kind[]) {
        if (!docs!.some((d) => d.kind === kind && d.job_id === job.id && d.user_id === c.me.id)) docs!.push({ id: c.newId(), kind, job_id: job.id, user_id: c.me.id, status: "draft", review_note: null, sent_at: null, reviewed_by: null, reviewed_at: null, created_at: iso(), updated_at: iso() });
      }
      const mine = (k: Kind) => docs!.find((d) => d.kind === k && d.job_id === job.id && d.user_id === c.me.id)!.id;
      return { sheetId: mine("sheet"), reportId: mine("service") };
    }
    if (seg[3] === "chat") {
      if (!chats[job.id]) chats[job.id] = c.makeChat(`Job ${job.job_number} · ${job.customer}`, job.created_by, [...new Set([...techsOf(job.id).map((t) => t.id), job.created_by, c.me.id])], []);
      c.joinChat(chats[job.id]!, c.me.id);
      return { id: chats[job.id] };
    }
    const mineOnly = (d: Doc) => d.job_id === job.id && (reviewer || d.user_id === c.me.id);
    const chatId = chats[job.id] ?? null;
    const member = !!chatId && c.isMember(chatId, c.me.id);
    return {
      job: jobFor(job.id),
      sheets: docs!.filter((d) => d.kind === "sheet" && mineOnly(d)).map(fullSheet),
      reports: docs!.filter((d) => d.kind === "service" && mineOnly(d)).map(fullReport),
      canStart: onJob && can("reports.write"),
      canReview: reviewer,
      chat: { id: member ? chatId : null, member, canOpen: true },
    };
  }

  if (seg[1] === "queue" || seg[1] === "export") {
    if (!reviewer) throw new ReportsFail(403, "Your role doesn't allow this.");
    const status = q.get("status") ?? (seg[1] === "queue" ? "sent" : "all");
    const user = q.get("user");
    const text = (q.get("q") ?? "").toLowerCase();
    const week = q.get("week");
    const kind = q.get("kind");
    const end = week ? addDays(week, 6) : "";
    const list = docs!.filter((d) => {
      const j = jobOf(d.job_id);
      if (status !== "all" && d.status !== status) return false;
      if (user && d.user_id !== user) return false;
      if (kind && d.kind !== kind) return false;
      if (text && ![j.job_number, j.customer, j.machine].some((v: string | null) => (v ?? "").toLowerCase().includes(text))) return false;
      if (week) {
        if (d.kind === "sheet") return rowsOf("days", d).some((x) => x.work_date >= week && x.work_date <= end);
        return (j.first_day ?? "") <= end && (j.last_day ?? "") >= week;
      }
      return true;
    });
    if (seg[1] === "export") {
      const lines = ["Field service engineer,Job number,Customer,Machine,Date,Start,End,Break (min),Work hours,Billable hours,Travel hours,Production hours,Notes"];
      for (const d of list.filter((x) => x.kind === "sheet")) {
        const j = jobOf(d.job_id);
        for (const x of rowsOf("days", d)) {
          const w = workMinutes(x);
          lines.push([name(d.user_id), j.job_number, j.customer, j.machine, x.work_date, x.start_time, x.end_time, x.break_min, (w / 60).toFixed(2), x.billable ? (w / 60).toFixed(2) : "0.00", (x.travel_min / 60).toFixed(2), (x.production_min / 60).toFixed(2), x.notes ?? ""].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
        }
      }
      return { __text: lines.join("\r\n") };
    }
    const items = list.map((d) => {
      const j = jobOf(d.job_id);
      const ds = d.kind === "sheet" ? rowsOf("days", d) : [];
      return { id: d.id, kind: d.kind, job_id: d.job_id, user_id: d.user_id, status: d.status, review_note: d.review_note, sent_at: d.sent_at, reviewed_at: d.reviewed_at, updated_at: d.updated_at, user_name: name(d.user_id), reviewer_name: name(d.reviewed_by), job_number: j.job_number, customer: j.customer, machine: j.machine, hours: d.kind === "sheet" ? sheetTotals(ds) : null, dates: d.kind === "sheet" ? [ds[0]?.work_date ?? null, ds.at(-1)?.work_date ?? null] : [j.first_day, j.last_day] };
    }).sort((a, b) => String(b.sent_at ?? b.updated_at).localeCompare(String(a.sent_at ?? a.updated_at)));
    const ids = [...new Set(docs!.map((d) => d.user_id))];
    const counts = Object.fromEntries((["draft", "sent", "approved", "returned"] as DocStatus[]).map((s) => [s, docs!.filter((d) => d.status === s).length]));
    return { items, people: ids.map((id) => ({ id, name: name(id) })).sort((a, b) => a.name!.localeCompare(b.name!)), counts };
  }

  const kind: Kind | null = seg[1] === "sheets" ? "sheet" : seg[1] === "service" ? "service" : null;
  if (!kind) throw new ReportsFail(404, "Not found.");
  const d = load(kind, seg[2]!);
  const action = seg[3];

  if (action && ["send", "recall", "approve", "return"].includes(action) && method === "POST") {
    const review = action === "approve" || action === "return";
    if (review && !reviewer) throw new ReportsFail(403, "Your role doesn't allow this.");
    if (!review && d.user_id !== c.me.id) throw new ReportsFail(403, "Only the field service engineer who wrote this can send it.");
    const to = next(d.status, action as DocAction);
    if (!to) throw new ReportsFail(409, "That step isn't possible from here. Reload to see the latest.");
    if (action === "return" && !String(body.note ?? "").trim()) throw new ReportsFail(400, "Write a note saying what needs to change.");
    if (action === "send" && kind === "sheet" && !rowsOf("days", d).length) throw new ReportsFail(400, "Add at least one day before sending the time sheet.");
    d.status = to;
    d.updated_at = iso();
    if (action === "send") d.sent_at = iso();
    if (review) { d.reviewed_by = c.me.id; d.reviewed_at = iso(); }
    d.review_note = action === "return" ? String(body.note).trim() : action === "approve" ? null : d.review_note;
    return { status: to };
  }
  if (!action) {
    if (method === "GET") return kind === "sheet" ? { sheet: fullSheet(d), job: jobFor(d.job_id) } : { ...fullReport(d), job: jobFor(d.job_id) };
    mustEdit(d);
    const r = cleanReport(body);
    if (r.error) throw new ReportsFail(400, r.error);
    Object.assign(d, r.fields, { updated_at: iso() });
    return { ok: true };
  }
  mustEdit(d);
  if (action === "signature") {
    if (method === "DELETE") { d.signature_file_id = null; return { ok: true }; }
    const f: File | null = body.file ?? body.files?.[0] ?? null;
    if (!f) throw new ReportsFail(400, "Draw the signature first.");
    const [id] = store(d, [new File([f], "signature.png", { type: "image/png" })], "signature");
    d.signature_file_id = id;
    d.signed_on ??= dayIso(0);
    return { id };
  }
  if (action === "photos") {
    const f = files.find((x) => x.id === seg[4] && x.doc_id === d.id);
    if (method === "POST") return { ids: store(d, body.files ?? [], "photo") };
    if (!f) throw new ReportsFail(404, "Not found.");
    if (method === "PATCH") f.caption = String(body.caption ?? "").trim() || null;
    if (method === "DELETE") f.deleted = true;
    return { ok: true };
  }
  const child = action as ChildKind;
  if (!(child in rows) || CHILD_DOC[child] !== kind) throw new ReportsFail(404, "Not found.");
  if (child === "expenses" && seg[5] === "receipt") {
    for (const old of files.filter((x) => x.row_id === seg[4] && x.purpose === "receipt")) old.deleted = true;
    if (method === "DELETE") return { ok: true };
    return { id: store(d, (body.files ?? []).slice(0, 1), "receipt", seg[4]!)[0] };
  }
  if (method === "POST") {
    const b = { ...body };
    const dateKey = child === "expenses" ? "exp_date" : child === "parts" ? null : "work_date";
    if (dateKey && b[dateKey] === undefined) {
      const last = rowsOf(child, d).map((x) => x[dateKey]).sort().at(-1);
      const j = jobOf(d.job_id);
      b[dateKey] = last ? (child === "expenses" ? last : addDays(last, 1)) : j.first_day ?? dayIso(0);
    }
    if (child === "expenses") b.type ??= "mileage";
    if (child === "parts") b.kind ??= "used";
    const r = cleanRow(child, b, false);
    if (r.error) throw new ReportsFail(400, r.error);
    const row = { id: c.newId(), [FK[child]]: d.id, ...r.fields, created_at: iso(), updated_at: iso() };
    rows[child].push(row);
    d.updated_at = iso();
    return { id: row.id, row };
  }
  const row = rows[child].find((x) => x.id === seg[4] && x[FK[child]] === d.id);
  if (!row) throw new ReportsFail(404, "Not found.");
  if (method === "DELETE") {
    rows[child] = rows[child].filter((x) => x !== row);
    return { ok: true };
  }
  const r = cleanRow(child, body, true);
  if (r.error) throw new ReportsFail(400, r.error);
  Object.assign(row, r.fields, { updated_at: iso() });
  d.updated_at = iso();
  return { ok: true };
}

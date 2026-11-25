// DEMO ONLY. Tech jobs and the Ronchi workbook's Work orders in the preview, with example jobs.
// Customers, contacts and addresses are made up. Email isn't set up in the preview, so every job
// email comes back "not sent" with the button to send it from your own email.
import { fileInfo, fileProblem, cleanName } from "../../../src/shared/files";
import { isJobStatus, jobEmail, jobLink, mapLinks, normalizeDays } from "../../../src/shared/jobs";

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
    // On site now: the preview's signed-in person is on this one, so the workbook's paperwork can be tried.
    j("J-1045", "Example Foods Inc.", "4222TP", "1200 Example Pkwy\nAtlanta, GA 30336", ["Dana Smith", "(404) 555-0142", "dana.smith@example.com"], days(-1, 3),
      "Line 1 changeover to 500 ml and a fill weight check on all 12 heads.", "in_progress", ["Patrick Morgan", "Aaron Lewis"]),
  ];
  const [, , install, shortfill] = jobs;
  files.push(
    { id: c.newId(), job_id: install.id, user_id: by("Patrick Morgan").id, name: "Service report J-1017 installation.pdf", ext: "pdf", size: 0, created_at: at, blob: c.pdf("Service report J-1017 installation (example)") },
    { id: c.newId(), job_id: shortfill.id, user_id: by("Steve Williams").id, name: "Service report J-0988.pdf", ext: "pdf", size: 0, created_at: at, blob: c.pdf("Service report J-0988 (example)") },
    { id: c.newId(), job_id: shortfill.id, user_id: by("Steve Williams").id, name: "Fill weights heads 1-12.csv", ext: "csv", size: 0, created_at: at, blob: new Blob(["Head,Target g,Actual g\n7,500.0,499.8\n8,500.0,500.1\n"], { type: "text/csv" }) },
  );
  for (const f of files) { f.size = f.blob.size; f.url = URL.createObjectURL(f.blob); }
}

/** The example jobs and who is on them, for the workbook's paperwork in the preview (reports-mock.ts). */
export function jobsState(c: Ctx) {
  if (!jobs) seed(c);
  return { jobs: jobs!, techs };
}

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
  const filesOf = (jid: string) => files.filter((f) => f.job_id === jid && !f.deleted).map(({ blob: _b, ...f }) => ({ ...f, by_name: name(f.user_id) }));
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
    const isPast = (x: any) => x.status === "done" || (x.last_day && x.last_day < day(0));
    const log = list.filter((x) => x.id !== j.id && x.status !== "cancelled" && isPast(x) && (x[key] ?? "").toLowerCase() === (j[key] ?? "").toLowerCase()).sort((a, b) => (b.first_day ?? "").localeCompare(a.first_day ?? ""));
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
    for (const f of fl) files.unshift({ id: c.newId(), job_id: j.id, user_id: c.me.id, name: cleanName(f.name), ext: fileInfo(f.name)!.ext, size: f.size, created_at: new Date().toISOString(), blob: f, url: URL.createObjectURL(f) });
    return { ids: [] };
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

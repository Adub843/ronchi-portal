// Tech jobs (service visits): the parts shared by the Worker and the app.
// A job is one visit to a customer: job number, customer, machine, location, point of contact,
// the days of work, the techs going, a free text box and files. Meagan (scheduling) makes them;
// each tech gets an email with a link to the job's page in the portal.

export const JOB_STATUSES = ["scheduled", "in_progress", "done", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const isJobStatus = (v: unknown): v is JobStatus => typeof v === "string" && (JOB_STATUSES as readonly string[]).includes(v);

export const MAX_WORK_DAYS = 90;

/** The fields typed on a job, with their length limits. */
export const JOB_MAX = {
  job_number: 40,
  customer: 200,
  machine: 100,
  location: 500,
  contact_name: 120,
  contact_phone: 60,
  contact_email: 200,
  notes: 10_000,
} as const;
export type JobTextField = keyof typeof JOB_MAX;
export const JOB_TEXT_FIELDS = Object.keys(JOB_MAX) as JobTextField[];

// ---- Map links ----

/** Links that open the job's address in Google Maps, Waze or Apple Maps (directions on phones). */
export function mapLinks(address: string): { google: string; waze: string; apple: string } {
  const q = encodeURIComponent(address.split(/\s*\n\s*/).filter(Boolean).join(", ").trim());
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    waze: `https://waze.com/ul?q=${q}&navigate=yes`,
    apple: `https://maps.apple.com/?daddr=${q}`,
  };
}

// ---- Work days ----

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Check a list of work days (YYYY-MM-DD): sorted, no repeats. Throws a plain message when it's wrong. */
export function normalizeDays(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Work days must be a list of dates.");
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string" || !isRealDay(v)) throw new Error(`"${String(v).slice(0, 20)}" isn't a date. Use the date picker.`);
    out.add(v);
  }
  if (out.size > MAX_WORK_DAYS) throw new Error(`A job can have up to ${MAX_WORK_DAYS} work days.`);
  return [...out].sort();
}

/** Every day from `from` to `to`, both included. With weekdays, Saturdays and Sundays are left out. */
export function dayRange(from: string, to: string, opts: { weekdays?: boolean } = {}): string[] {
  if (!isRealDay(from) || !isRealDay(to)) return [];
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (opts.weekdays && (wd === 0 || wd === 6)) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (s: string) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}`;

/** "Dec 1 – Dec 3, 2026 (3 days)". English, for emails; the app shows days in the reader's language. */
export function daysLabel(days: string[]): string {
  if (!days.length) return "No days set";
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (days.length === 1) return `${md(first)}, ${first.slice(0, 4)}`;
  const span = first.slice(0, 4) === last.slice(0, 4) ? `${md(first)} – ${md(last)}, ${last.slice(0, 4)}` : `${md(first)}, ${first.slice(0, 4)} – ${md(last)}, ${last.slice(0, 4)}`;
  return `${span} (${days.length} days)`;
}

// ---- The email to a tech ----

export interface JobForEmail {
  id: string;
  job_number: string;
  customer: string;
  machine: string | null;
  location: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  work_days: string[];
  notes: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The page a job's email links to: its work order in the Ronchi workbook, or the plain job page when the workbook is switched off. */
export function jobLink(origin: string, id: string, workbook: boolean): string {
  return `${origin}/jobs/${encodeURIComponent(id)}${workbook ? "/work-order" : ""}`;
}

/**
 * The email a field service engineer gets when they're put on a job (or when its days, place or
 * contact change, with `updated`): plain text and a simple HTML version.
 */
export function jobEmail(job: JobForEmail, opts: { link: string; name: string; by: string; updated?: boolean }): { subject: string; text: string; html: string } {
  const did = opts.updated ? "changed" : "scheduled you for";
  const link = opts.link;
  const days = daysLabel(job.work_days);
  const maps = job.location ? mapLinks(job.location) : null;
  const contact = [job.contact_name, job.contact_phone, job.contact_email].filter(Boolean).join(" · ");
  const rows: [string, string][] = [
    ["Job number", job.job_number],
    ["Customer", job.customer],
    ["Machine", job.machine ?? ""],
    ["Days of work", job.work_days.length ? `${days}: ${job.work_days.map(md).join(", ")}` : days],
    ["Location", job.location ?? ""],
    ["Point of contact", contact],
  ].filter((r): r is [string, string] => !!r[1]);

  const subject = `${opts.updated ? "Changed" : "Scheduled"}: job ${job.job_number}, ${job.customer}, ${days}`;
  const text = [
    `Hi ${opts.name},`,
    "",
    `${opts.by} ${did} job ${job.job_number}.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(maps ? ["", `Google Maps: ${maps.google}`, `Waze: ${maps.waze}`, `Apple Maps: ${maps.apple}`] : []),
    ...(job.notes ? ["", "Other information:", job.notes] : []),
    "",
    `Open the job in the Ronchi Portal: ${link}`,
    "",
    "Ronchi America",
  ].join("\n");

  const td = "padding:4px 12px 4px 0;vertical-align:top";
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1d1d1f;font-size:15px;line-height:1.45">
<p>Hi ${esc(opts.name)},</p>
<p>${esc(opts.by)} ${did} job <b>${esc(job.job_number)}</b>.</p>
<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="${td};color:#666">${esc(k)}</td><td style="${td};white-space:pre-wrap">${esc(v)}</td></tr>`).join("")}</table>
${maps ? `<p>Open the location in <a href="${esc(maps.google)}">Google Maps</a> · <a href="${esc(maps.waze)}">Waze</a> · <a href="${esc(maps.apple)}">Apple Maps</a></p>` : ""}
${job.notes ? `<p style="color:#666;margin-bottom:2px">Other information</p><p style="white-space:pre-wrap;margin-top:0">${esc(job.notes)}</p>` : ""}
<p><a href="${esc(link)}" style="display:inline-block;background:#e30613;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:bold">Open the job in the Ronchi Portal</a></p>
<p style="color:#666;font-size:13px">Ronchi America</p>
</body></html>`;
  return { subject, text, html };
}

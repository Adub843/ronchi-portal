// The Ronchi workbook inside Work orders: lists and rules carried over from the old Field Service
// Workbook app, used by the Worker (checks) and the app (pickers, totals, CSV).
//
// Billable hours are what the customer is billed for this job, NOT a time clock (Aaron, 2026-11-25).

/** Type of work, as in the old workbook. */
export const SCOPES = [
  "Change Parts", "Changeover", "Installation Support", "Line Down", "Machine Evaluation",
  "Production Support", "Site Acceptance Test", "Start up", "Training", "Upgrade",
] as const;

/** How far along a piece of work is, when it isn't finished. */
export const PCT = ["Under 25%", "26–50%", "51–75%", "76–99%", "100%"] as const;

export const EXPENSE_TYPES = [
  "Airfare", "Baggage", "Hotel", "Meals", "Rental car", "Fuel", "Personal mileage", "Parking", "Tolls",
  "Taxi / rideshare", "Tools / supplies", "Clothing / PPE", "Phone / internet", "Shipping", "Other",
] as const;

export const PAY = ["Credit", "Cash"] as const;

/** Recipe screens a field service engineer photographs (HMI screenshots), by machine. */
export const RECIPE_SCREENS: Record<string, string[]> = {
  "Filler / Capper": [
    "Camera Job", "Cams Page 1", "Cams Page 2", "Capper Controls", "Caps Feeder", "Compensation Parameters",
    "Conveyor Timing", "Flowmeter Calibration", "ECAM Parameters", "Screwing / Orientation Parameters", "P.I.D.",
    "Product Pressure", "Single Head Filling Corrections", "Machine Speed", "Timers",
    "Height Screen", "Recipe Screen", "Dynamic Washing", "Static Washing", "Tank Controls", "Cleaning Controls",
  ],
  Rotomatic: ["Control", "Speed", "Recipe", "Parameters"],
};

/** The billable hour types, in the order of the old time sheet's Billable Hours table. */
export const HOUR_TYPES = [
  { key: "travel_wd", label: "Weekday travel" },
  { key: "travel_we", label: "Weekend travel" },
  { key: "regular", label: "Regular" },
  { key: "training", label: "Training" },
  { key: "overtime", label: "Overtime" },
  { key: "warranty", label: "Warranty" },
] as const;
export type HourType = (typeof HOUR_TYPES)[number]["key"];
export const HOUR_KEYS = HOUR_TYPES.map((h) => h.key) as HourType[];

export type Hours = Record<HourType, number> & { miles: number };

/** Hours of every type for one day, checked: each 0 to 24 in quarter hours or finer, all together at most 24.
 *  Miles 0 to 5000. Throws a plain-English message when something is off. */
export function cleanHours(b: Record<string, unknown>): Hours {
  const out = {} as Hours;
  let total = 0;
  for (const { key, label } of HOUR_TYPES) {
    const v = num(b[key], `${label} hours`);
    if (v < 0 || v > 24) throw new Error(`${label} hours must be between 0 and 24.`);
    out[key] = Math.round(v * 100) / 100;
    total += out[key];
  }
  if (total > 24) throw new Error("A day can't have more than 24 billable hours.");
  const miles = num(b.miles, "Miles");
  if (miles < 0 || miles > 5000) throw new Error("Miles must be between 0 and 5000.");
  out.miles = Math.round(miles * 10) / 10;
  return out;
}

export const hoursTotal = (h: Partial<Record<HourType, number>>) => HOUR_KEYS.reduce((s, k) => s + (Number(h[k]) || 0), 0);

function num(v: unknown, what: string): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number.`);
  return n;
}

/** "12.50", "$1,234", 12.5 → cents. Throws on anything that isn't a money amount from 0 to 100,000. */
export function toCents(v: unknown): number {
  const s = typeof v === "number" ? String(v) : String(v ?? "").replace(/[$,\s]/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("The amount should look like 12.50.");
  const cents = Math.round(Number(s) * 100);
  if (cents > 10_000_000) throw new Error("That amount is too large.");
  return cents;
}

export const fromCents = (c: number) => (c / 100).toFixed(2);

/** The old workbook's rule: costs on a service job (number ending in S1, S2 ...) or a warranty job
 *  (W1, W2 ...) are billable; anything without such a job number isn't. */
export function billableFor(jobNumber: string | null | undefined): "Y" | "N" {
  return /-?[SW]\d+$/i.test((jobNumber ?? "").trim()) ? "Y" : "N";
}

/** Monday of the week a YYYY-MM-DD date falls in. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}

export const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().startsWith(v);

/** Problems found in the daily log become quick notes on Submit: one per line that isn't empty. */
export function issueLines(issues: string | null | undefined): string[] {
  return (issues ?? "").split(/\r?\n/).map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim()).filter((l) => l.length >= 4).slice(0, 20);
}

/** The service report as plain text, for the email that goes to the office on Submit. */
export interface ReportForText {
  job: { job_number: string; customer: string; machine: string | null; location: string | null };
  report: { scope: string | null; summary: string | null; open_issues: string | null; sign_name: string | null; sign_title: string | null; sign_date: string | null; signature: string | null };
  entries: { day: string; who: string; work: string | null; description: string; done: string | null; pct: string | null; issues: string | null }[];
  hours: ({ day: string; who: string; miles: number } & Record<HourType, number>)[];
  expenses: { day: string; who: string; type: string; amount_cents: number; billable: string; description: string | null }[];
  photos: number;
  by: string;
  link: string;
  /** false: list the expenses without any dollar amount (for field service engineers). */
  amounts?: boolean;
}

export function reportText(r: ReportForText): { subject: string; text: string } {
  const j = r.job;
  const L: string[] = [];
  L.push(`Service report for job ${j.job_number}: ${j.customer}${j.machine ? `, machine ${j.machine}` : ""}`);
  L.push(`Submitted by ${r.by}.`);
  if (j.location) L.push(`Location: ${j.location}`);
  if (r.report.scope) L.push(`Type of work: ${r.report.scope}`);
  if (r.report.summary) L.push("", "Summary", r.report.summary);
  if (r.entries.length) {
    L.push("", "Daily work log");
    for (const e of r.entries) {
      const state = e.done === "Y" ? "done" : e.pct ? e.pct : e.done === "N" ? "not finished" : "";
      L.push(`- ${e.day}, ${e.who}${e.work ? ` (${e.work})` : ""}: ${e.description}${state ? ` [${state}]` : ""}`);
      if (e.issues) L.push(`  Issues: ${e.issues.replace(/\s*\n\s*/g, "; ")}`);
    }
  }
  if (r.report.open_issues) L.push("", "Left open", r.report.open_issues);
  if (r.hours.length) {
    L.push("", "Billable hours");
    for (const h of r.hours) {
      const parts = HOUR_TYPES.filter((t) => h[t.key]).map((t) => `${t.label.toLowerCase()} ${h[t.key]}`);
      L.push(`- ${h.day}, ${h.who}: ${parts.join(", ") || "0"} (total ${hoursTotal(h)})${h.miles ? `, ${h.miles} miles` : ""}`);
    }
    L.push(`Total billable hours: ${r.hours.reduce((s, h) => s + hoursTotal(h), 0)}`);
  }
  if (r.expenses.length) {
    L.push("", "Expenses");
    const amounts = r.amounts !== false;
    for (const x of r.expenses) L.push(`- ${x.day}, ${x.who}: ${x.type}${amounts ? ` ${fromCents(x.amount_cents)}` : ""}${x.billable === "Y" ? " (billable)" : ""}${x.description ? `, ${x.description}` : ""}`);
    if (amounts) L.push(`Total expenses: ${fromCents(r.expenses.reduce((s, x) => s + x.amount_cents, 0))}`);
  }
  if (r.photos) L.push("", `${r.photos} photo${r.photos === 1 ? "" : "s"} on the work order.`);
  if (r.report.sign_name) L.push("", `Signed off by ${r.report.sign_name}${r.report.sign_title ? `, ${r.report.sign_title}` : ""}${r.report.sign_date ? ` on ${r.report.sign_date}` : ""}${r.report.signature ? " (signature on the work order)" : ""}.`);
  L.push("", `Open the full report, photos and signature: ${r.link}`);
  return { subject: `Service report ${j.job_number}: ${j.customer}${j.machine ? ` ${j.machine}` : ""}`, text: L.join("\n") };
}

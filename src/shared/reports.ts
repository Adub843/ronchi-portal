// The Ronchi workbook's job paperwork (Aaron, 2026-11-25): each field service engineer's time sheet and
// service report for a job. Shared by the Worker (the real checks) and the app (live totals while typing).
//
// Hard rules kept here:
//  - No money. Expenses record a type, a description, a receipt photo and a quantity (miles, nights),
//    never an amount ("No money amounts or sales totals are shown anywhere in the portal").
//  - No clock. Times are typed paperwork for a job; nothing here records when or where someone was.

export const DOC_STATUSES = ["draft", "sent", "approved", "returned"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export type DocAction = "send" | "approve" | "return" | "recall";

/** The next status after an action, or null when that step isn't allowed from here. */
export function next(status: DocStatus, action: DocAction): DocStatus | null {
  if (action === "send") return status === "draft" || status === "returned" ? "sent" : null;
  if (action === "approve") return status === "sent" ? "approved" : null;
  if (action === "return") return status === "sent" || status === "approved" ? "returned" : null;
  if (action === "recall") return status === "sent" ? "draft" : null; // take it back to fix before anyone reviews it
  return null;
}

/** Only drafts and sheets sent back can be changed. Sent ones wait for review; approved ones are locked. */
export const isEditable = (status: DocStatus) => status === "draft" || status === "returned";

// ---- Hours ----

const CLOCK = /^(\d{1,2}):(\d{2})$/;

/** "7:30" → 450 minutes after midnight, or null. */
export function clockMin(v: string | null | undefined): number | null {
  const m = CLOCK.exec((v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export interface DayHours { start_time: string | null; end_time: string | null; break_min: number }

/** Minutes worked in a day: end minus start minus the break. A shift past midnight runs into the next day. */
export function workMinutes(d: DayHours): number {
  const s = clockMin(d.start_time);
  const e = clockMin(d.end_time);
  if (s === null || e === null) return 0;
  const span = e >= s ? e - s : e + 1440 - s;
  return Math.max(0, span - (d.break_min || 0));
}

export interface DayRow extends DayHours { travel_min: number; production_min: number; billable: number | boolean }

export function sheetTotals(days: DayRow[]) {
  const out = { work: 0, billable: 0, nonBillable: 0, travel: 0, production: 0, days: days.length };
  for (const d of days) {
    const w = workMinutes(d);
    out.work += w;
    if (d.billable) out.billable += w;
    else out.nonBillable += w;
    out.travel += d.travel_min || 0;
    out.production += d.production_min || 0;
  }
  return out;
}

/** 450 → "7.50" (hours, the way time sheets show them). */
export const fmtHours = (min: number) => (min / 60).toFixed(2);

/** Typed hours ("1.5" or "1,5") → minutes, rounded to the minute. Empty = 0; not a number = null. */
export function hoursToMin(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 60);
}

/** The Monday of a date's week (YYYY-MM-DD). */
export function weekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ---- Expenses (no money) ----

export const EXPENSE_TYPES = [
  { id: "mileage", label: "Mileage", unit: "miles", one: "mile" },
  { id: "hotel", label: "Hotel", unit: "nights", one: "night" },
  { id: "airfare", label: "Airfare", unit: "flights", one: "flight" },
  { id: "rental_car", label: "Rental car", unit: "days", one: "day" },
  { id: "fuel", label: "Fuel", unit: "", one: "" },
  { id: "meals", label: "Meals", unit: "days", one: "day" },
  { id: "parking", label: "Parking and tolls", unit: "", one: "" },
  { id: "tools", label: "Tools and supplies", unit: "", one: "" },
  { id: "other", label: "Other", unit: "", one: "" },
] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number]["id"];
export const expenseType = (id: string) => EXPENSE_TYPES.find((e) => e.id === id) ?? EXPENSE_TYPES[EXPENSE_TYPES.length - 1]!;

export const PART_KINDS = ["used", "needed"] as const;

// ---- Checking typed rows ----

export const REPORT_MAX = { notes: 1000, description: 500, text: 5000, part_code: 40, part_description: 300, summary: 10_000, recipe: 10_000, follow_up: 5000, signer_name: 120, signer_title: 120, caption: 200, note: 1000 } as const;

export type ChildKind = "days" | "expenses" | "log" | "parts";
export const CHILD_KINDS: ChildKind[] = ["days", "expenses", "log", "parts"];
export const isChildKind = (v: unknown): v is ChildKind => typeof v === "string" && (CHILD_KINDS as string[]).includes(v);

type Fields = Record<string, string | number | null>;
type Result = { fields: Fields; error?: undefined } | { fields?: undefined; error: string };

class Bad extends Error {}
const bad = (msg: string): never => {
  throw new Bad(msg);
};

function text(v: unknown, max: number, what: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") bad(`${what} must be text.`);
  const t = (v as string).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (t.length > max) bad(`${what} is too long (limit ${max} characters).`);
  return t || null;
}
const line = (v: unknown, max: number, what: string) => text(v, max, what)?.replace(/\s+/g, " ") ?? null;

function date(v: unknown, what: string): string {
  if (!isRealDate(v)) bad(`${what} isn't a date. Use the date picker.`);
  return v as string;
}

function clock(v: unknown, what: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  const m = clockMin(String(v));
  if (m === null) bad(`${what} isn't a time. Use the time picker (for example 07:30).`);
  return `${String(Math.floor(m! / 60)).padStart(2, "0")}:${String(m! % 60).padStart(2, "0")}`;
}

function int(v: unknown, min: number, max: number, what: string): number {
  const n = v === "" || v === null || v === undefined ? 0 : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(`${what} must be a whole number from ${min} to ${max}.`);
  return n;
}

function hours(v: unknown, what: string): number {
  const m = hoursToMin(v);
  if (m === null || m < 0 || m > 24 * 60) bad(`${what} must be between 0 and 24 hours.`);
  return m!;
}

/**
 * Check what was typed for one row (a time sheet day, an expense, a work log day or a part).
 * `partial` = an autosave of some fields: only the fields present come back. Unknown fields are
 * dropped, so nothing outside the list (a money amount, for one) can ever be stored.
 */
export function cleanRow(kind: ChildKind, b: Record<string, unknown>, partial: boolean): Result {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k) || !partial;
  const f: Fields = {};
  try {
    if (kind === "days") {
      if (has("work_date")) f.work_date = date(b.work_date, "The day");
      if (has("start_time")) f.start_time = clock(b.start_time, "Start");
      if (has("end_time")) f.end_time = clock(b.end_time, "End");
      if (has("break_min")) f.break_min = int(b.break_min, 0, 720, "Break minutes");
      if (has("travel_hours")) f.travel_min = hours(b.travel_hours, "Travel hours");
      if (has("production_hours")) f.production_min = hours(b.production_hours, "Production hours");
      if (has("billable")) f.billable = b.billable === false || b.billable === 0 || b.billable === "0" ? 0 : 1;
      if (has("notes")) f.notes = text(b.notes, REPORT_MAX.notes, "Notes");
    } else if (kind === "expenses") {
      if (has("exp_date")) f.exp_date = date(b.exp_date, "The day");
      if (has("type")) {
        if (!EXPENSE_TYPES.some((e) => e.id === b.type)) bad("Pick the type of expense from the list.");
        f.type = b.type as string;
      }
      if (has("description")) f.description = line(b.description, REPORT_MAX.description, "Description");
      if (has("quantity")) {
        const q = b.quantity === "" || b.quantity === null || b.quantity === undefined ? null : Number(String(b.quantity).replace(",", "."));
        if (q !== null && (!Number.isFinite(q) || q < 0 || q > 100_000)) bad("Quantity must be a number from 0 to 100000.");
        f.quantity = q === null ? null : Math.round(q * 100) / 100;
      }
    } else if (kind === "log") {
      if (has("work_date")) f.work_date = date(b.work_date, "The day");
      if (has("text")) f.text = text(b.text, REPORT_MAX.text, "What was done");
    } else {
      if (has("kind")) {
        if (!(PART_KINDS as readonly unknown[]).includes(b.kind)) bad("Choose used or needed.");
        f.kind = b.kind as string;
      }
      if (has("part_code")) f.part_code = line(b.part_code, REPORT_MAX.part_code, "Part code");
      if (has("description")) f.description = line(b.description, REPORT_MAX.part_description, "Description");
      if (has("qty")) {
        const q = b.qty === "" || b.qty === undefined || b.qty === null ? 1 : Number(b.qty);
        if (!Number.isInteger(q) || q < 1 || q > 9999) bad("Quantity must be a whole number from 1 to 9999.");
        f.qty = q;
      }
    }
  } catch (e) {
    if (e instanceof Bad) return { error: e.message };
    throw e;
  }
  return { fields: f };
}

/** The report's own text fields (not its rows). Only fields present come back. */
export function cleanReport(b: Record<string, unknown>): Result {
  const f: Fields = {};
  try {
    for (const k of ["summary", "recipe", "follow_up"] as const) if (k in b) f[k] = text(b[k], REPORT_MAX[k], k === "summary" ? "Summary" : k === "recipe" ? "Recipe and settings" : "Follow-up");
    for (const k of ["signer_name", "signer_title"] as const) if (k in b) f[k] = line(b[k], REPORT_MAX[k], k === "signer_name" ? "Signed by" : "Title");
    if ("signed_on" in b) f.signed_on = b.signed_on === null || b.signed_on === "" ? null : date(b.signed_on, "The sign-off date");
  } catch (e) {
    if (e instanceof Bad) return { error: e.message };
    throw e;
  }
  return { fields: f };
}

/** Columns that may never appear on the workbook's tables (a test checks the database). */
export const MONEY_WORDS = /amount|cost|price|total|rate|usd|dollar|money|fee|charge|paid|pay/i;

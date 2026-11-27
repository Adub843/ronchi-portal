// Machine sales forecast, reports and import (routes/machine-sales.ts, pages/MachineForecast.tsx).
//
// The forecast is the grid the top sales tools use (Won, Commit, Best case, Pipeline for a period),
// with every deal listed by name, because a machine builder closes a handful of deals a year and each
// one is a large share of it. A deal lands in a period by the month its PO is expected.
import { parseCsv } from "./inventory";
import { SELLING, SOLD, STAGES, STAGE_LABELS, chanceOf, type Stage } from "./machine-sales";

export const BUCKETS = ["won", "commit", "best", "pipeline"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABELS: Record<Bucket, string> = { won: "Won", commit: "Commit", best: "Best case", pipeline: "Pipeline" };
export const BUCKET_HINTS: Record<Bucket, string> = {
  won: "The customer's PO is in.",
  commit: "75% or better: expected to close.",
  best: "40% to 74%: could close if things go well.",
  pipeline: "Under 40%: still early.",
};

/** The three months of a quarter, as YYYY-MM, for the quarter `offset` quarters from the one `today` is in. */
export function quarter(today: string, offset = 0): { label: string; months: string[] } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const q = Math.floor((m - 1) / 3) + offset;
  const year = y + Math.floor(q / 4), qi = ((q % 4) + 4) % 4;
  const months = [0, 1, 2].map((i) => `${year}-${String(qi * 3 + i + 1).padStart(2, "0")}`);
  return { label: `Q${qi + 1} ${year}`, months };
}

interface ForecastDeal { stage: string; chance?: number | null; value?: number | null; expected_po?: string | null; won_at?: string | null }

/** Which column a deal sits in for a set of months, or null when it isn't in that period. */
export function bucketOf(d: ForecastDeal, months: string[]): Bucket | null {
  const s = d.stage as Stage;
  if (SOLD.has(s)) return d.won_at && months.includes(d.won_at.slice(0, 7)) ? "won" : null;
  if (!SELLING.has(s) || !d.expected_po || !months.includes(d.expected_po)) return null;
  const c = chanceOf(d);
  return c >= 75 ? "commit" : c >= 40 ? "best" : "pipeline";
}

/** How the last 12 months went: deals won and lost, the win rate, and how long a win took. */
export function yearReport(deals: (ForecastDeal & { lost_at?: string | null; created_at?: string | null; lost_reason?: string | null })[], today: string) {
  const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const won = deals.filter((d) => SOLD.has(d.stage as Stage) && d.won_at && d.won_at.slice(0, 10) >= from);
  const lost = deals.filter((d) => d.stage === "lost" && d.lost_at && d.lost_at.slice(0, 10) >= from);
  const days = won.filter((d) => d.created_at).map((d) => Math.max(0, Math.round((Date.parse(d.won_at!) - Date.parse(d.created_at!)) / 86400000)));
  const reasons = new Map<string, number>();
  for (const d of lost) reasons.set(d.lost_reason?.trim() || "No reason given", (reasons.get(d.lost_reason?.trim() || "No reason given") ?? 0) + 1);
  return {
    won: won.length,
    wonValue: won.reduce((s, d) => s + (d.value ?? 0), 0),
    lost: lost.length,
    winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    daysToWin: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// ---------- Import ----------

export const MAX_DEAL_IMPORT = 500;
type ImportField = "customer" | "site" | "title" | "machine_type" | "value" | "stage" | "expected_po" | "owner" | "customer_po" | "machine" | "contact" | "contact_email" | "contact_phone" | "next_step" | "notes" | "lead_source";

/** Spreadsheet column names people use, mapped to the deal's fields. */
export const DEAL_IMPORT_COLUMNS: Record<string, ImportField> = {
  "customer": "customer", "company": "customer", "account": "customer",
  "site": "site", "location": "site", "city": "site",
  "deal": "title", "deal name": "title", "project": "title", "opportunity": "title", "description": "title",
  "machine type": "machine_type", "machine": "machine_type", "model": "machine_type",
  "value": "value", "amount": "value", "price": "value",
  "stage": "stage", "status": "stage",
  "expected po month": "expected_po", "expected po": "expected_po", "close date": "expected_po", "expected close": "expected_po",
  "salesperson": "owner", "owner": "owner", "sales rep": "owner", "rep": "owner",
  "customer po": "customer_po", "po": "customer_po", "po number": "customer_po",
  "machine number": "machine", "serial": "machine", "serial number": "machine",
  "contact": "contact", "contact name": "contact", "contact email": "contact_email", "email": "contact_email", "contact phone": "contact_phone", "phone": "contact_phone",
  "next step": "next_step", "notes": "notes", "lead source": "lead_source", "source": "lead_source",
};

const STAGE_WORDS = new Map<string, Stage>([
  ...STAGES.map((s) => [s as string, s] as [string, Stage]),
  ...STAGES.map((s) => [STAGE_LABELS[s].toLowerCase(), s] as [string, Stage]),
  ["quote", "firm_quote"], ["quoted", "firm_quote"], ["budgetary", "budget_quote"], ["po", "won"], ["po received", "won"], ["closed won", "won"], ["closed lost", "lost"],
  ["new", "lead"], ["open", "lead"], ["hold", "on_hold"], ["installed", "install"], ["paid", "paid"], ["closed", "paid"],
]);

/** A month typed almost any way (2027-03, 3/2027, 03/15/2027, March 2027) as YYYY-MM, or "" when it can't be read. */
export function readMonth(v: string): string {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}`;
  m = /^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1]!.padStart(2, "0")}`;
  const t = Date.parse(`1 ${s}`);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 7) : "";
}

/** Read a pasted or uploaded CSV of deals. Returns the rows and the lines that couldn't be read. */
export function readDealsCsv(csv: string): { rows: Record<string, string>[]; problems: string[] } {
  const lines = parseCsv(csv.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  if (lines.length < 2) return { rows: [], problems: ["The file needs a heading line and at least one deal."] };
  const head = lines[0]!.map((h) => DEAL_IMPORT_COLUMNS[h.trim().toLowerCase()] ?? null);
  if (!head.includes("customer")) return { rows: [], problems: ["No Customer column was found."] };
  const rows: Record<string, string>[] = [], problems: string[] = [];
  lines.slice(1).forEach((cells, i) => {
    const row: Record<string, string> = {};
    head.forEach((f, j) => { if (f && !(f in row)) row[f] = (cells[j] ?? "").trim(); });
    if (!row.customer) { problems.push(`Line ${i + 2} has no customer.`); return; }
    if (row.stage) {
      const s = STAGE_WORDS.get(row.stage.toLowerCase());
      if (!s) { problems.push(`Line ${i + 2}: the stage "${row.stage}" isn't one of the portal's stages.`); return; }
      row.stage = s;
    }
    if (row.expected_po) {
      const ym = readMonth(row.expected_po);
      if (!ym) { problems.push(`Line ${i + 2}: the expected PO month couldn't be read.`); return; }
      row.expected_po = ym;
    }
    if (row.value && !/^\$?[\d,]+(?:\.\d+)?$/.test(row.value.replace(/\s/g, ""))) { problems.push(`Line ${i + 2}: the value must be a number.`); return; }
    rows.push(row);
  });
  return { rows, problems };
}

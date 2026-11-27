// Machine sales: every new-machine deal, from the first call to a machine running on the customer's line.
// Used by the portal server (routes/machine-sales.ts) and the staff app (pages/MachineSales.tsx).
//
// One deal = one machine (or line) a customer may buy. It moves through STAGES in two halves: the sale
// (the board, Lead to Won) and the order (Deposit received to Final payment). On hold and Lost sit beside
// the line. Dollar values are only sent to people allowed to see them (permission machinesales.prices).
// Plan and research: project files, "Machine sales tracking software.md".

export const STAGES = [
  "lead",          // a name, a company and where the lead came from
  "qualified",     // an application, a budget, and we know who decides and when
  "specs",         // containers, caps, speeds collected; samples received and tested
  "budget_quote",  // a price range sent so the customer can get the project funded
  "firm_quote",    // the full quote
  "negotiation",   // last revision, terms and lead time
  "won",           // customer PO received
  "deposit",       // deposit received: the deal is booked
  "engineering",   // engineering and drawings approved
  "build",         // being built, in Italy or in the US
  "fat",           // factory acceptance test
  "shipped",
  "install",       // install and SAT on the customer's line
  "paid",          // final payment received: done
  "on_hold",
  "lost",
] as const;
export type Stage = (typeof STAGES)[number];
export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);

export const STAGE_LABELS: Record<Stage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  specs: "Specs and samples",
  budget_quote: "Budget quote",
  firm_quote: "Firm quote",
  negotiation: "Negotiation",
  won: "Won",
  deposit: "Deposit received",
  engineering: "Engineering approved",
  build: "Build",
  fat: "FAT",
  shipped: "Shipped",
  install: "Install and SAT",
  paid: "Final payment received",
  on_hold: "On hold",
  lost: "Lost",
};

/** The line a deal walks, in order (On hold and Lost are not on it). */
export const LINE: Stage[] = STAGES.filter((s) => s !== "on_hold" && s !== "lost");
/** The board's columns: the sale, up to the customer's PO. */
export const BOARD: Stage[] = ["lead", "qualified", "specs", "budget_quote", "firm_quote", "negotiation", "won"];
/** Still being sold: no PO yet. */
export const SELLING: ReadonlySet<Stage> = new Set(["lead", "qualified", "specs", "budget_quote", "firm_quote", "negotiation"]);
/** A quote is out with the customer. */
export const QUOTED: ReadonlySet<Stage> = new Set(["budget_quote", "firm_quote", "negotiation"]);
/** The customer said yes: from Won to Final payment. */
export const SOLD: ReadonlySet<Stage> = new Set(["won", "deposit", "engineering", "build", "fat", "shipped", "install", "paid"]);
/** Orders still being delivered. */
export const ORDERS: ReadonlySet<Stage> = new Set(["won", "deposit", "engineering", "build", "fat", "shipped", "install"]);
/** Finished deals: they leave the open lists. */
export const DONE: ReadonlySet<Stage> = new Set(["paid", "lost"]);
export const isOpen = (s: string | null | undefined) => !DONE.has(s as Stage);

/** How likely a deal at each stage is to close, in percent, unless someone types another number. */
export const STAGE_CHANCE: Record<Stage, number> = {
  lead: 10, qualified: 20, specs: 35, budget_quote: 50, firm_quote: 65, negotiation: 80,
  won: 100, deposit: 100, engineering: 100, build: 100, fat: 100, shipped: 100, install: 100, paid: 100, on_hold: 0, lost: 0,
};

/** Days a deal may sit in a stage before it turns red. On hold never turns red: it has a reconnect date. */
export const STAGE_DAYS: Partial<Record<Stage, number>> = {
  lead: 14, qualified: 30, specs: 45, budget_quote: 30, firm_quote: 14, negotiation: 14,
  won: 14, deposit: 30, engineering: 45, build: 180, fat: 21, shipped: 45, install: 45,
};

export const LEAD_SOURCES = ["PACK EXPO", "Website", "Ronchi Italy", "Existing customer", "Referral", "Other"] as const;
export const NOTE_KINDS = ["note", "call", "visit", "email", "meeting"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_LABELS: Record<NoteKind, string> = { note: "Note", call: "Call", visit: "Visit", email: "Email", meeting: "Meeting" };

/** Deal fields people type (not the stage). Text unless listed in one of the sets below. */
export const DEAL_FIELDS = [
  "customer", "site", "title", "machine_type", "speed_bpm", "formats", "value", "chance", "expected_po", "owner", "lead_source",
  "funded", "decision_date", "next_step", "next_step_date", "hold_until", "lost_reason", "competitor", "customer_po",
  "contact", "contact_email", "contact_phone", "target_ship", "machine", "notes",
] as const;
export type DealField = (typeof DEAL_FIELDS)[number];

export const DEAL_LABELS: Record<DealField, string> = {
  customer: "Customer",
  site: "Site",
  title: "Deal name",
  machine_type: "Machine type",
  speed_bpm: "Speed (bottles a minute)",
  formats: "Formats",
  value: "Value",
  chance: "Chance to close %",
  expected_po: "Expected PO month",
  owner: "Salesperson",
  lead_source: "Lead came from",
  funded: "Budget funded",
  decision_date: "Decision date",
  next_step: "Next step",
  next_step_date: "Next step date",
  hold_until: "Reconnect on",
  lost_reason: "Why it was lost",
  competitor: "Competitor",
  customer_po: "Customer PO",
  contact: "Contact",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  target_ship: "Target ship date",
  machine: "Machine number",
  notes: "Notes",
};

export const DEAL_MAX: Record<DealField, number> = {
  customer: 200, site: 200, title: 200, machine_type: 200, speed_bpm: 10, formats: 1000, value: 20, chance: 5, expected_po: 7, owner: 80, lead_source: 80,
  funded: 1, decision_date: 10, next_step: 300, next_step_date: 10, hold_until: 10, lost_reason: 300, competitor: 120, customer_po: 80,
  contact: 120, contact_email: 200, contact_phone: 60, target_ship: 10, machine: 60, notes: 5000,
};
export const DATE_FIELDS: ReadonlySet<DealField> = new Set(["decision_date", "next_step_date", "hold_until", "target_ship"]);
export const NUMBER_FIELDS: ReadonlySet<DealField> = new Set(["speed_bpm", "value", "chance"]);
/** Fields only people who may see deal values can read or change. */
export const MONEY_FIELDS: ReadonlySet<DealField> = new Set(["value"]);

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What a stage change needs before it is allowed, as the field to fill in. */
export function stageNeeds(to: Stage): DealField | null {
  if (SOLD.has(to)) return "customer_po"; // like the top sales tools: a deal is won only with the customer's PO
  if (to === "lost") return "lost_reason";
  if (to === "on_hold") return "hold_until";
  return null;
}

export interface DealFacts {
  stage: string;
  stage_at: string | null;
  next_step: string | null;
  next_step_date: string | null;
  hold_until: string | null;
  expected_po: string | null;
  chance?: number | null;
  value?: number | null;
}

/** Whole days since an ISO time, by the calendar. */
export function daysSince(iso: string | null | undefined, today: string): number {
  if (!iso) return 0;
  const d = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86400000);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export type FlagId = "stale" | "no_next" | "next_due" | "po_passed" | "reconnect";
export const FLAG_LABELS: Record<FlagId, string> = {
  stale: "Left too long",
  no_next: "No next step",
  next_due: "Next step overdue",
  po_passed: "Expected PO month has passed",
  reconnect: "Time to reconnect",
};

/**
 * What needs attention on a deal: plain rules shown on screen, not a score. A machine builder closes a
 * handful of deals a year, far too few for scoring to mean anything (see the research note).
 */
export function flags(d: DealFacts, today: string): FlagId[] {
  const s = d.stage as Stage;
  if (DONE.has(s)) return [];
  if (s === "on_hold") return d.hold_until && d.hold_until <= today ? ["reconnect"] : [];
  const out: FlagId[] = [];
  const allowed = STAGE_DAYS[s];
  if (allowed !== undefined && daysSince(d.stage_at, today) > allowed) out.push("stale");
  if (!d.next_step) out.push("no_next");
  else if (d.next_step_date && d.next_step_date < today) out.push("next_due");
  if (SELLING.has(s) && d.expected_po && d.expected_po < today.slice(0, 7)) out.push("po_passed");
  return out;
}

/** The chance used for the weighted value: what was typed, or the stage's usual chance. */
export const chanceOf = (d: { stage: string; chance?: number | null }) => d.chance ?? STAGE_CHANCE[d.stage as Stage] ?? 0;
export const weighted = (d: { stage: string; chance?: number | null; value?: number | null }) => Math.round((d.value ?? 0) * chanceOf(d)) / 100;

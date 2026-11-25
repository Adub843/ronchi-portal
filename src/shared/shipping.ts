// Shipping and receiving: shipments coming in (from Ronchi Italy and other suppliers) and going out
// (parts orders, change-part orders, anything else). Used by the portal server (routes/shipping.ts),
// the staff app and the demo preview. No paid carrier services: tracking is a link to the carrier's
// own page, built from a template staff can fix in the carriers list without a code change.

// ---------- carriers and tracking links ----------

export interface Carrier { id: string; name: string; mode: string; url_template: string | null; checked: number | boolean; active: number | boolean }

/** The carrier's tracking page for this number, or null when there's no template or no number. */
export function trackingUrl(template: string | null | undefined, number: string | null | undefined): string | null {
  const n = (number ?? "").replace(/\s+/g, "");
  if (!template || !n || templateProblem(template)) return null;
  return template.split("{n}").join(encodeURIComponent(n));
}

/** Why a tracking link template won't work, or null when it's fine. */
export function templateProblem(template: string): string | null {
  const t = template.trim();
  if (t.length > 500) return "The tracking link is too long (limit 500 characters).";
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|\?|#|$)/i.test(t)) return "The tracking link must start with https:// and the carrier's web address.";
  if (!t.includes("{n}")) return "Put {n} in the tracking link where the tracking number goes.";
  if (/[\s<>"'`]/.test(t)) return "The tracking link can't have spaces or quotes.";
  return null;
}

/**
 * A gentle check for typing mistakes in a tracking number. Never blocks a save: carriers change
 * formats, so this only says "check this". Formats: UPS 1Z + 16 letters/digits; USPS 20 to 22 digits
 * (or 2 letters, 9 digits, US); FedEx 12, 15, 20 or 22 digits; DHL Express 10 digits.
 */
export function trackingHint(carrierId: string | null | undefined, number: string | null | undefined): string | null {
  const n = (number ?? "").replace(/\s+/g, "").toUpperCase();
  if (!n || !carrierId) return null;
  const ok: Record<string, RegExp> = {
    ups: /^1Z[0-9A-Z]{16}$/,
    usps: /^(\d{20,22}|[A-Z]{2}\d{9}US)$/,
    fedex: /^(\d{12}|\d{15}|\d{20}|\d{22})$/,
    dhl: /^\d{10}$/,
  };
  const re = ok[carrierId];
  if (!re || re.test(n)) return null;
  return "That doesn't look like a usual tracking number for this carrier. Check it before saving.";
}

/** A tracking number or container/BOL number: letters, digits, dashes, at most 60 characters. */
export const TRACKING = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,59}$/;

// ---------- inbound ----------

export const IN_MODES = ["ocean", "air", "courier", "truck", "other"] as const;
export type InMode = (typeof IN_MODES)[number];
export const IN_MODE_LABELS: Record<InMode, string> = { ocean: "Ocean", air: "Air freight", courier: "Courier", truck: "Truck", other: "Other" };

/** Where an incoming shipment is on its way. Receiving progress comes from its lines, never typed. */
export const IN_STAGES = ["expected", "in_transit", "at_customs", "arrived", "cancelled"] as const;
export type InStage = (typeof IN_STAGES)[number];
export const IN_STAGE_LABELS: Record<InStage, string> = { expected: "Expected", in_transit: "In transit", at_customs: "At customs", arrived: "Arrived", cancelled: "Cancelled" };

export const CUSTOMS = ["none", "pending", "held", "released"] as const;
export type Customs = (typeof CUSTOMS)[number];
export const CUSTOMS_LABELS: Record<Customs, string> = { none: "No customs", pending: "Customs pending", held: "Held at customs", released: "Released" };

export const ISSUE_KINDS = ["short", "over", "wrong_part", "damaged", "missing_docs", "other"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const ISSUE_LABELS: Record<IssueKind, string> = { short: "Short", over: "Over", wrong_part: "Wrong part", damaged: "Damaged", missing_docs: "Missing paperwork", other: "Other" };

export interface InLineQty { qty_expected: number; qty_received: number }

export type InShown = "Expected" | "In transit" | "At customs" | "Arrived" | "Partly received" | "Received" | "Cancelled";

export function inShown(stage: InStage, lines: InLineQty[]): InShown {
  if (stage === "cancelled") return "Cancelled";
  const got = lines.reduce((n, l) => n + l.qty_received, 0);
  if (lines.length && lines.every((l) => l.qty_received >= l.qty_expected)) return "Received";
  if (got > 0) return "Partly received";
  return IN_STAGE_LABELS[stage] as InShown;
}
export const inOpen = (s: InShown) => s !== "Received" && s !== "Cancelled";

// ---------- outbound ----------

export const OUT_STATUSES = ["to_pick", "packed", "shipped", "delivered", "cancelled"] as const;
export type OutStatus = (typeof OUT_STATUSES)[number];
export const OUT_LABELS: Record<OutStatus, string> = { to_pick: "To pick", packed: "Packed", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
export const isOutStatus = (v: unknown): v is OutStatus => typeof v === "string" && (OUT_STATUSES as readonly string[]).includes(v);

/** Allowed moves. Going back a step is allowed to fix a mistake; every move is in the history. */
export const OUT_MOVES: Record<OutStatus, OutStatus[]> = {
  to_pick: ["packed", "shipped", "cancelled"],
  packed: ["to_pick", "shipped", "cancelled"],
  shipped: ["delivered", "packed"],
  delivered: ["shipped"],
  cancelled: [],
};
/** Statuses whose quantities count as shipped on the parts order. */
export const SHIPPED: readonly OutStatus[] = ["shipped", "delivered"];
/** Statuses whose quantities are set aside for a shipment that hasn't left yet. */
export const ALLOCATED: readonly OutStatus[] = ["to_pick", "packed"];

export const OUT_SOURCES = ["parts_order", "change_part", "other"] as const;
export type OutSource = (typeof OUT_SOURCES)[number];

export const SH_MAX = {
  supplier: 200, reference: 80, tracking: 60, broker: 120, customs_notes: 2000, notes: 5000, part_code: 60, description: 300,
  bin: 40, issue_note: 1000, customer: 200, ship_to: 600, service: 80, resolution: 1000,
} as const;
export const MAX_SH_LINES = 300;

// ---------- the dashboard ----------

export interface InSummary { shown: InShown; expected_date: string | null; customs_status: Customs; open_issues: number }
export interface OutSummary { status: OutStatus; ship_date: string | null }

export interface ShipKpis {
  arrivingThisWeek: number;
  lateInbound: number;
  heldAtCustoms: number;
  openIssues: number;
  toShipToday: number;
  shippedThisWeek: number;
  inTransit: number;
}

/** Monday of the week `day` is in. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const arrivingSoon = (s: InSummary, today: string) => inOpen(s.shown) && s.shown !== "Partly received" && !!s.expected_date && s.expected_date >= today && s.expected_date <= addDays(today, 7);
export const inLate = (s: InSummary, today: string) => inOpen(s.shown) && s.shown !== "Arrived" && s.shown !== "Partly received" && !!s.expected_date && s.expected_date < today;
export const toShipToday = (s: OutSummary, today: string) => (s.status === "to_pick" || s.status === "packed") && (!s.ship_date || s.ship_date <= today);
export const shippedThisWeek = (s: OutSummary, today: string) => (s.status === "shipped" || s.status === "delivered") && !!s.ship_date && s.ship_date >= weekStart(today) && s.ship_date <= today;

export function shipKpis(inbound: InSummary[], outbound: OutSummary[], today: string): ShipKpis {
  return {
    arrivingThisWeek: inbound.filter((s) => arrivingSoon(s, today)).length,
    lateInbound: inbound.filter((s) => inLate(s, today)).length,
    heldAtCustoms: inbound.filter((s) => inOpen(s.shown) && s.customs_status === "held").length,
    openIssues: inbound.reduce((n, s) => n + s.open_issues, 0),
    toShipToday: outbound.filter((s) => toShipToday(s, today)).length,
    shippedThisWeek: outbound.filter((s) => shippedThisWeek(s, today)).length,
    inTransit: outbound.filter((s) => s.status === "shipped").length,
  };
}

export const IN_CSV_HEADER = ["Shipment #", "Supplier", "Reference", "Mode", "Carrier", "Tracking or container", "Expected", "Status", "Customs", "Line", "Part code", "Description", "Qty expected", "Qty received", "Bin"];
export const OUT_CSV_HEADER = ["Shipment #", "For", "Order #", "Customer", "Carrier", "Service", "Tracking", "Boxes", "Weight (lb)", "Ship date", "Status", "Line", "Part code", "Description", "Qty"];

// Parts orders: spare parts quotes and the orders they turn into (change parts are separate: cp_orders).
// Used by the portal server (routes/parts-orders.ts), the staff app and the demo preview, so the
// status rules, limits and dashboard numbers are the same everywhere.
//
// HARD RULE (LOCKED_RULES in src/portal/lib/settings.ts): no money. There is no price, cost, value or
// total anywhere in a parts order: only parts, quantities, people and dates. A test checks the tables.

/** What is stored. Shipping progress (partly shipped, shipped) is never stored: it comes from the lines. */
export type PoStatus = "quote" | "sent" | "lost" | "booked" | "closed" | "cancelled";
export const PO_STATUSES: PoStatus[] = ["quote", "sent", "lost", "booked", "closed", "cancelled"];
export const isPoStatus = (v: unknown): v is PoStatus => typeof v === "string" && (PO_STATUSES as string[]).includes(v);

/** What people see. */
export type PoShown = "Quote" | "Quote sent" | "Lost" | "Booked" | "Partially shipped" | "Shipped" | "Closed" | "Cancelled";

/**
 * The one table of allowed moves, used by the server and the buttons on screen.
 * Booking needs the customer's PO, Lost and Cancel need a reason, Close needs everything shipped,
 * Cancel needs nothing shipped. "Revise" (a new quote revision) is its own action.
 */
export const PO_MOVES: Record<PoStatus, PoStatus[]> = {
  quote: ["sent", "booked", "lost"],
  sent: ["booked", "lost", "quote"],
  lost: ["quote"],
  booked: ["closed", "cancelled"],
  closed: ["booked"],
  cancelled: [],
};
export const canMove = (from: PoStatus, to: PoStatus) => PO_MOVES[from].includes(to);

/** A line's quantities. `shipped` counts shipments marked shipped or delivered; `allocated` is on a shipment still being picked or packed. */
export interface LineQty { qty: number; shipped: number; allocated?: number; backorder?: boolean | number }

export const remaining = (l: LineQty) => Math.max(0, l.qty - l.shipped);
/** Still to be put on a shipment: ordered, less shipped, less already on a shipment being packed. */
export const toAllocate = (l: LineQty) => Math.max(0, l.qty - l.shipped - (l.allocated ?? 0));
/** Waiting on stock: marked by sales (on order from Italy), or the rest of a line that went out short. */
export const isBackordered = (l: LineQty) => remaining(l) > 0 && (!!l.backorder || l.shipped > 0);

export function shownStatus(status: PoStatus, lines: LineQty[]): PoShown {
  switch (status) {
    case "quote": return "Quote";
    case "sent": return "Quote sent";
    case "lost": return "Lost";
    case "closed": return "Closed";
    case "cancelled": return "Cancelled";
    case "booked": {
      const shipped = lines.reduce((n, l) => n + Math.min(l.shipped, l.qty), 0);
      if (!shipped) return "Booked";
      return lines.every((l) => l.shipped >= l.qty) ? "Shipped" : "Partially shipped";
    }
  }
}

export const isQuote = (s: PoStatus) => s === "quote" || s === "sent";
/** Fully shipped: every line has gone out. */
export const fullyShipped = (lines: LineQty[]) => lines.length > 0 && lines.every((l) => l.shipped >= l.qty);

/** "A", "B", ... "Z", "AA" for quote revisions 0, 1, ... */
export function revLetter(n: number): string {
  let s = "";
  let x = Math.max(0, Math.floor(n));
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

// ---------- fields ----------

/** Header fields people type, in screen and export order. */
export const PO_FIELDS = ["customer", "contact", "machine", "customer_po", "salesperson", "follow_up", "valid_until", "promised_date", "hold_reason"] as const;
export type PoField = (typeof PO_FIELDS)[number];

export const PO_LABELS: Record<PoField, string> = {
  customer: "Customer",
  contact: "Customer contact",
  machine: "Machine",
  customer_po: "Customer PO",
  salesperson: "Salesperson",
  follow_up: "Follow up",
  valid_until: "Quote valid until",
  promised_date: "Promised ship date",
  hold_reason: "On hold because",
};

export const PO_MAX: Record<PoField, number> & { notes: number; reason: number; part_code: number; description: number } = {
  customer: 200, contact: 200, machine: 20, customer_po: 80, salesperson: 80, follow_up: 10, valid_until: 10, promised_date: 10, hold_reason: 200,
  notes: 5000, reason: 300, part_code: 60, description: 300,
};
export const PO_DATES: ReadonlySet<PoField> = new Set(["follow_up", "valid_until", "promised_date"]);
export const MAX_LINES = 200;
export const MAX_QTY = 100000;

export const LOST_REASONS = ["Price", "Lead time", "Bought elsewhere", "Project cancelled", "No answer", "Other"];

export const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

export type PoInput = Partial<Record<PoField, string | null>>;

/** Check and tidy typed header fields. Only fields present in `b` come back. Throws a plain message. */
export function cleanPoFields(b: Record<string, unknown>): PoInput {
  const out: PoInput = {};
  for (const f of PO_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
    const raw = b[f];
    if (raw !== null && raw !== undefined && typeof raw !== "string") throw new Error(`${PO_LABELS[f]} must be text.`);
    let v = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (v.length > PO_MAX[f]) throw new Error(`${PO_LABELS[f]} is too long (limit ${PO_MAX[f]} characters).`);
    if (v && PO_DATES.has(f) && !isDay(v)) throw new Error(`${PO_LABELS[f]} must be a date.`);
    if (f === "machine") {
      v = v.toUpperCase();
      if (v && !/^[A-Z0-9-]{2,20}$/.test(v)) throw new Error("Machine numbers look like 3069MB or RA1018.");
    }
    out[f] = v || null;
  }
  if ("customer" in out && !out.customer) throw new Error("Customer is required.");
  return out;
}

export interface LineInput { id?: string; part_code: string | null; description: string | null; qty: number; backorder: boolean }

/** Check the lines sent from the screen. Each needs a part code or a description, and a whole quantity of 1 or more. */
export function cleanLines(value: unknown): LineInput[] {
  if (!Array.isArray(value)) throw new Error("Send the list of lines.");
  if (value.length > MAX_LINES) throw new Error(`A parts order can have up to ${MAX_LINES} lines.`);
  return value.map((raw, i) => {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const text = (v: unknown, max: number, what: string) => {
      if (v !== undefined && v !== null && typeof v !== "string") throw new Error(`Line ${i + 1}: ${what} must be text.`);
      const s = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      if (s.length > max) throw new Error(`Line ${i + 1}: ${what} is too long (limit ${max} characters).`);
      return s || null;
    };
    const part_code = text(r.part_code, PO_MAX.part_code, "the part code");
    const description = text(r.description, PO_MAX.description, "the description");
    if (!part_code && !description) throw new Error(`Line ${i + 1}: add a part code or a description.`);
    const qty = typeof r.qty === "string" ? Number(r.qty) : r.qty;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new Error(`Line ${i + 1}: the quantity must be a whole number from 1 to ${MAX_QTY}.`);
    const id = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : undefined;
    return { id, part_code: part_code?.toUpperCase() ?? null, description, qty, backorder: r.backorder === true || r.backorder === 1 };
  });
}

/** Text for one notes box: kept as typed (line breaks allowed), control characters removed. */
export function cleanNotes(v: unknown): string | null {
  if (v !== null && v !== undefined && typeof v !== "string") throw new Error("Notes must be text.");
  // eslint-disable-next-line no-control-regex
  const s = (v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (s.length > PO_MAX.notes) throw new Error(`Notes are too long (limit ${PO_MAX.notes} characters).`);
  return s.trim() ? s : null;
}

// ---------- the dashboard (counts, quantities and days; never money) ----------

/** One order as the list shows it, with its line counts worked out. */
export interface PoSummary {
  status: PoStatus;
  created_at: string;
  booked_at: string | null;
  lost_at: string | null;
  promised_date: string | null;
  follow_up: string | null;
  valid_until: string | null;
  /** The day its last line went out, once every line has. */
  shipped_on: string | null;
  lines: number;
  backordered: number;
  shown: PoShown;
}

export interface PoKpis {
  openQuotes: number;
  openOrders: number;
  late: number;
  backorderedLines: number;
  followUpsDue: number;
  /** Won ÷ (won + lost) over the last 12 months, as a whole percent, or null when nothing was decided. */
  conversion: number | null;
  daysQuoteToOrder: number | null;
  daysOrderToShip: number | null;
  /** Fully shipped orders with a promised date, shipped on or before it, as a whole percent. */
  onTime: number | null;
  /** Orders booked in each of the last 12 months, oldest first. */
  bookings: { month: string; count: number }[];
}

const dayOf = (iso: string) => iso.slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${dayOf(b)}T00:00:00Z`) - Date.parse(`${dayOf(a)}T00:00:00Z`)) / 86400000);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

export const isOpenOrder = (o: Pick<PoSummary, "status" | "shown">) => o.status === "booked" && o.shown !== "Shipped";
export const isLate = (o: Pick<PoSummary, "status" | "shown" | "promised_date">, today: string) => isOpenOrder(o) && !!o.promised_date && o.promised_date < today;
export const followUpDue = (o: Pick<PoSummary, "status" | "follow_up">, today: string) => isQuote(o.status) && !!o.follow_up && o.follow_up <= today;
export const isExpired = (o: Pick<PoSummary, "status" | "valid_until">, today: string) => isQuote(o.status) && !!o.valid_until && o.valid_until < today;

export function poKpis(orders: PoSummary[], today: string): PoKpis {
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const won = orders.filter((o) => o.booked_at && dayOf(o.booked_at) >= yearAgo).length;
  const lost = orders.filter((o) => o.status === "lost" && o.lost_at && dayOf(o.lost_at) >= yearAgo).length;
  const shipped = orders.filter((o) => o.booked_at && o.shipped_on && o.status !== "cancelled");
  const promised = shipped.filter((o) => o.promised_date);
  const months: string[] = [];
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return {
    openQuotes: orders.filter((o) => isQuote(o.status)).length,
    openOrders: orders.filter(isOpenOrder).length,
    late: orders.filter((o) => isLate(o, today)).length,
    backorderedLines: orders.filter(isOpenOrder).reduce((n, o) => n + o.backordered, 0),
    followUpsDue: orders.filter((o) => followUpDue(o, today)).length,
    conversion: won + lost ? Math.round((won / (won + lost)) * 100) : null,
    daysQuoteToOrder: avg(orders.filter((o) => o.booked_at).map((o) => Math.max(0, daysBetween(o.created_at, o.booked_at!)))),
    daysOrderToShip: avg(shipped.map((o) => Math.max(0, daysBetween(o.booked_at!, o.shipped_on!)))),
    onTime: promised.length ? Math.round((promised.filter((o) => o.shipped_on! <= o.promised_date!).length / promised.length) * 100) : null,
    bookings: months.map((month) => ({ month, count: orders.filter((o) => o.booked_at && o.booked_at.slice(0, 7) === month).length })),
  };
}

/** Columns of the CSV export: one row per line, so quantities can be added up in a spreadsheet. No money. */
export const PO_CSV_HEADER = [
  "Quote #", "Revision", "Order #", "Status", "Customer", "Customer contact", "Machine", "Customer PO", "Salesperson",
  "Follow up", "Quote valid until", "Promised ship date", "Booked", "Shipped", "Line", "Part code", "Description", "Qty", "Qty shipped", "Backordered",
];

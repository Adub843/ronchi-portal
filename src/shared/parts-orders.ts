// Parts orders: spare parts sales from the customer's first ask to the invoice.
// Used by the portal server (routes/parts-orders.ts) and the staff app (pages/PartsOrders.tsx).
//
// One order = one customer request for spare parts (by phone, email, a visit, or a quote request from
// the customer parts site). It moves through STATUSES; its lines say what was asked for, where each part
// comes from (Ronchi Mario in Italy, a US supplier, or our own stock), the supplier PO, when it should
// arrive, and how many have arrived and shipped. Prices and totals are only sent to people allowed to
// see them (permission partsorders.prices).

/** The steps of a parts order, in order. On hold, Lost and Cancelled sit outside the line. */
export const STATUSES = [
  "inquiry",   // customer asked; nothing quoted yet
  "quoted",    // quote sent, waiting on the customer
  "ordered",   // customer PO received: a sale
  "sourcing",  // parts ordered from Italy or a supplier, waiting for them
  "ready",     // everything is here and can ship
  "shipped",   // on its way to the customer
  "invoiced",  // invoice made in QuickBooks
  "closed",    // paid and done
  "on_hold",
  "lost",      // customer didn't buy
  "cancelled",
] as const;
export type Status = (typeof STATUSES)[number];
export const isStatus = (v: unknown): v is Status => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

export const STATUS_LABELS: Record<Status, string> = {
  inquiry: "New request",
  quoted: "Quote sent",
  ordered: "Customer PO received",
  sourcing: "Ordered from supplier",
  ready: "Ready to ship",
  shipped: "Shipped",
  invoiced: "Invoiced",
  closed: "Closed",
  on_hold: "On hold",
  lost: "Lost",
  cancelled: "Cancelled",
};

/** Finished orders: they leave the open list. */
export const DONE: ReadonlySet<Status> = new Set(["closed", "lost", "cancelled"]);
/** Orders that count as a sale (the customer said yes). */
export const WON: ReadonlySet<Status> = new Set(["ordered", "sourcing", "ready", "shipped", "invoiced", "closed"]);
/** Orders still being quoted: the open quotes a salesperson follows up. */
export const QUOTING: ReadonlySet<Status> = new Set(["inquiry", "quoted"]);
export const isOpen = (s: string | null | undefined) => !DONE.has(s as Status);

/** The time each step was first reached is kept, for the turnaround and sales reports. */
export const STAMPS: Partial<Record<Status, "quoted_at" | "won_at" | "shipped_at" | "invoiced_at" | "closed_at">> = {
  quoted: "quoted_at",
  ordered: "won_at",
  shipped: "shipped_at",
  invoiced: "invoiced_at",
  closed: "closed_at",
};
/** Reaching a later step also stamps the earlier ones it skipped (an order typed in as Shipped was also won). */
export function stampsFor(s: Status): ("quoted_at" | "won_at" | "shipped_at" | "invoiced_at" | "closed_at")[] {
  const i = STATUSES.indexOf(s);
  if (i < 0 || i > STATUSES.indexOf("closed")) return []; // On hold, Lost and Cancelled stamp nothing
  return STATUSES.slice(0, i + 1).map((x) => STAMPS[x]).filter((x): x is NonNullable<typeof x> => !!x);
}

export const PRIORITIES = ["normal", "urgent", "machine_down"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { normal: "Normal", urgent: "Urgent", machine_down: "Machine down" };

export const SOURCES = ["phone", "email", "parts_site", "visit", "other"] as const;
export const SOURCE_LABELS: Record<(typeof SOURCES)[number], string> = { phone: "Phone", email: "Email", parts_site: "Parts site", visit: "Field service visit", other: "Other" };

/** Where a part comes from. People can also type another supplier. */
export const SUPPLIERS = ["Ronchi Mario (Italy)", "Our stock", "US supplier"] as const;

/** Order fields people type (not lines, not status). Text unless listed in DATE_FIELDS or MONEY_FIELDS. */
export const ORDER_FIELDS = [
  "customer", "contact", "contact_email", "contact_phone", "machine", "ship_to", "customer_po", "quote_no",
  "salesperson", "source", "priority", "needed_by", "promised", "ship_method", "tracking", "invoice_no",
  "discount_pct", "freight", "quote_valid", "lost_reason", "notes",
] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];

export const ORDER_LABELS: Record<OrderField, string> = {
  customer: "Customer",
  contact: "Contact",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  machine: "Machine",
  ship_to: "Ship to",
  customer_po: "Customer PO",
  quote_no: "Quote #",
  salesperson: "Salesperson",
  source: "Came in by",
  priority: "Priority",
  needed_by: "Customer needs it by",
  promised: "Promised ship date",
  ship_method: "Ship by",
  tracking: "Tracking",
  invoice_no: "QuickBooks invoice #",
  discount_pct: "Discount %",
  freight: "Freight",
  quote_valid: "Quote valid until",
  lost_reason: "Why it was lost",
  notes: "Notes",
};

export const ORDER_MAX: Record<OrderField, number> = {
  customer: 200, contact: 120, contact_email: 200, contact_phone: 60, machine: 60, ship_to: 600, customer_po: 80, quote_no: 80,
  salesperson: 80, source: 20, priority: 20, needed_by: 10, promised: 10, ship_method: 120, tracking: 300, invoice_no: 80,
  discount_pct: 10, freight: 20, quote_valid: 10, lost_reason: 300, notes: 5000,
};
export const DATE_FIELDS: ReadonlySet<OrderField> = new Set(["needed_by", "promised", "quote_valid"]);
/** Order fields only people who may see prices can read or change. */
export const MONEY_FIELDS: ReadonlySet<OrderField> = new Set(["discount_pct", "freight"]);

export const LINE_FIELDS = ["part_code", "description", "qty", "unit_price", "unit_cost", "supplier", "supplier_po", "eta", "drop_ship", "qty_received", "qty_shipped", "note"] as const;
export type LineField = (typeof LINE_FIELDS)[number];
export const LINE_MONEY: ReadonlySet<LineField> = new Set(["unit_price", "unit_cost"]);
export const MAX_LINES = 200;

export interface Line {
  id?: string;
  part_code: string | null;
  description: string | null;
  qty: number;
  unit_price: number | null;
  unit_cost: number | null;
  supplier: string | null;
  supplier_po: string | null;
  eta: string | null;
  /** Shipped by the supplier straight to the customer, not through Ronchi America. */
  drop_ship: boolean;
  qty_received: number;
  qty_shipped: number;
  note: string | null;
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Parts we keep on the shelf: nothing to order, already here. */
export const isStock = (l: { supplier: string | null }) => /stock/i.test(l.supplier ?? "");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the order is worth: lines, less the discount, plus freight. Null prices count as 0. */
export function totals(lines: Pick<Line, "qty" | "unit_price" | "unit_cost">[], discountPct?: number | null, freight?: number | null) {
  const parts = lines.reduce((s, l) => s + l.qty * (l.unit_price ?? 0), 0);
  const cost = lines.reduce((s, l) => s + l.qty * (l.unit_cost ?? 0), 0);
  const discount = round2(parts * Math.min(Math.max(discountPct ?? 0, 0), 100) / 100);
  const net = round2(parts - discount);
  const priced = lines.every((l) => l.unit_price != null);
  const costed = lines.length > 0 && lines.every((l) => l.unit_cost != null);
  return {
    parts: round2(parts),
    discount,
    freight: round2(freight ?? 0),
    total: round2(net + (freight ?? 0)),
    /** Margin on the parts (not freight), only when every line has a cost. */
    margin: costed ? round2(net - cost) : null,
    marginPct: costed && net > 0 ? Math.round(((net - cost) / net) * 1000) / 10 : null,
    priced,
  };
}

/** How far along the parts are: lines fully received and fully shipped. */
export function progress(lines: Pick<Line, "qty" | "qty_received" | "qty_shipped" | "supplier">[]) {
  return {
    lines: lines.length,
    received: lines.filter((l) => isStock(l) || l.qty_received >= l.qty).length,
    shipped: lines.filter((l) => l.qty_shipped >= l.qty).length,
  };
}

/**
 * The step an order should be at, judging by its lines, or null to leave it. Like the order tools
 * Ronchi's research looked at, the status moves on by itself, but only forward and only once the
 * customer has said yes: Customer PO received -> Ordered from supplier (a supplier PO is on every
 * line that needs one) -> Ready to ship (everything is here) -> Shipped (everything has gone).
 * A drop-shipped line counts as here once it is ordered, since it never comes through Ronchi.
 */
export function autoStatus(status: Status, lines: Pick<Line, "qty" | "qty_received" | "qty_shipped" | "supplier" | "supplier_po" | "drop_ship">[]): Status | null {
  if (!lines.length || !["ordered", "sourcing", "ready"].includes(status)) return null;
  const at = STATUSES.indexOf(status);
  const needsOrder = lines.filter((l) => !isStock(l));
  const ordered = needsOrder.every((l) => !!l.supplier_po);
  const here = lines.every((l) => isStock(l) || l.qty_received >= l.qty || (l.drop_ship && !!l.supplier_po));
  const gone = lines.every((l) => l.qty_shipped >= l.qty);
  const want: Status = gone ? "shipped" : here ? "ready" : ordered && needsOrder.length ? "sourcing" : status;
  return STATUSES.indexOf(want) > at ? want : null;
}

/** A line is late when its ETA has passed and it hasn't all arrived. */
export const lineLate = (l: Pick<Line, "eta" | "qty" | "qty_received">, today: string) => !!l.eta && l.eta < today && l.qty_received < l.qty;

/** An open order is late when its promised ship date has passed and it hasn't shipped. */
export function orderLate(o: { status: string; promised: string | null }, today: string) {
  const i = STATUSES.indexOf(o.status as Status);
  return isOpen(o.status) && o.status !== "on_hold" && !!o.promised && o.promised < today && i >= 0 && i < STATUSES.indexOf("shipped");
}

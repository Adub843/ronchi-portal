// Machine quotes: the priced offer on a machine deal, kept as revisions (Q1, Q2, ...).
// Used by the portal server (routes/machine-sales.ts) and the staff app (pages/MachineQuote.tsx).
//
// A quote is a draft until it is sent. A sent quote is never edited: a change is a new revision,
// copied from the last one, and sending it replaces the one before. Lines say what is offered, where
// it is built (Italy or the US, which sets the lead time) and whether it is an option the customer
// may add. Only people who may see deal values (machinesales.prices) can open or build quotes.

export const QUOTE_KINDS = ["budget", "firm"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];
export const QUOTE_KIND_LABELS: Record<QuoteKind, string> = { budget: "Budget quote", firm: "Firm quote" };

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", superseded: "Replaced" };

export const ORIGINS = ["italy", "us", "other"] as const;
export type Origin = (typeof ORIGINS)[number];
export const ORIGIN_LABELS: Record<Origin, string> = { italy: "Built in Italy", us: "Built in the US", other: "Other" };

/** Quote fields people type, besides the lines. All text; valid_until is a date, discount_pct a number. */
export const QUOTE_FIELDS = ["kind", "valid_until", "lead_time", "payment_terms", "delivery_terms", "warranty", "notes", "discount_pct"] as const;
export type QuoteField = (typeof QUOTE_FIELDS)[number];
export const QUOTE_LABELS: Record<QuoteField, string> = {
  kind: "Kind of quote",
  valid_until: "Valid until",
  lead_time: "Lead time",
  payment_terms: "Payment terms",
  delivery_terms: "Delivery terms",
  warranty: "Warranty",
  notes: "Notes on the quote",
  discount_pct: "Discount %",
};
export const QUOTE_MAX: Record<QuoteField, number> = { kind: 10, valid_until: 10, lead_time: 300, payment_terms: 1000, delivery_terms: 500, warranty: 500, notes: 5000, discount_pct: 10 };

export const MAX_QUOTE_LINES = 100;

export interface QuoteLine {
  description: string;
  /** More about the line: scope, formats, what is included. */
  detail: string | null;
  origin: Origin;
  qty: number;
  unit_price: number | null;
  /** An option the customer may add: priced, but not in the total. */
  optional: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The lines as typed, checked and tidied, or what is wrong with them. */
export function readQuoteLines(raw: unknown): { lines: QuoteLine[]; problem?: undefined } | { lines?: undefined; problem: string } {
  if (!Array.isArray(raw)) return { problem: "Send the quote's lines as a list." };
  if (raw.length > MAX_QUOTE_LINES) return { problem: `A quote can have up to ${MAX_QUOTE_LINES} lines.` };
  const lines: QuoteLine[] = [];
  for (const r of raw) {
    const x = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const description = typeof x.description === "string" ? x.description.trim() : "";
    if (!description) return { problem: "Every line needs a description." };
    if (description.length > 300) return { problem: "A line's description is too long (limit 300 characters)." };
    const detail = typeof x.detail === "string" ? x.detail.trim().slice(0, 2000) || null : null;
    const origin = (ORIGINS as readonly unknown[]).includes(x.origin) ? (x.origin as Origin) : "italy";
    const qty = x.qty === undefined || x.qty === null || x.qty === "" ? 1 : Number(x.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10_000) return { problem: "A line's quantity must be more than 0." };
    const price = x.unit_price === undefined || x.unit_price === null || x.unit_price === "" ? null : Number(typeof x.unit_price === "string" ? x.unit_price.replace(/[$,\s]/g, "") : x.unit_price);
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000_000)) return { problem: "A line's price must be a number." };
    lines.push({ description, detail, origin, qty: Math.round(qty * 1000) / 1000, unit_price: price === null ? null : round2(price), optional: x.optional === true });
  }
  return { lines };
}

/** What the quote adds up to. Options are shown with a price but are not in the total. */
export function quoteTotals(lines: Pick<QuoteLine, "qty" | "unit_price" | "optional" | "origin">[], discountPct?: number | null) {
  const firm = lines.filter((l) => !l.optional);
  const sum = (ls: typeof lines) => round2(ls.reduce((s, l) => s + l.qty * (l.unit_price ?? 0), 0));
  const subtotal = sum(firm);
  const discount = round2(subtotal * Math.min(Math.max(discountPct ?? 0, 0), 100) / 100);
  return {
    subtotal,
    discount,
    total: round2(subtotal - discount),
    options: sum(lines.filter((l) => l.optional)),
    italy: sum(firm.filter((l) => l.origin === "italy")),
    us: sum(firm.filter((l) => l.origin === "us")),
    /** Every line that counts has a price. */
    priced: firm.length > 0 && firm.every((l) => l.unit_price != null),
  };
}

export const quoteNumber = (dealNumber: string, rev: number) => `${dealNumber}-Q${rev}`;

/** What may happen to a quote next. */
export function nextStatuses(s: QuoteStatus): QuoteStatus[] {
  if (s === "draft") return ["sent"];
  if (s === "sent") return ["accepted", "declined"];
  if (s === "accepted" || s === "declined") return ["sent"]; // undo a wrong click
  return [];
}

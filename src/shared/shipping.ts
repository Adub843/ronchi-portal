// Shipping and receiving: the parts shared by the Worker (routes/shipping.ts) and the app.
//
// A shipment goes OUT (a machine on a truck, spare parts or change parts in a box, samples back to a
// customer) or comes IN (parts from Italy, a supplier delivery, a customer return, sample bottles and
// caps for a change-part fill test). Each one has a number (SH-2026-0001 out, RC-2026-0001 in), a
// status, the carrier and tracking numbers, its packages (boxes, pallets, crates with weight and
// size), and a list of what is in it. It can be tied to the order or job it is for.
//
// Nothing here talks to a carrier. Tracking opens the carrier's own public tracking page from the
// number (the same page a customer would use), so no carrier account or paid service is needed.

export const DIRECTIONS = ["out", "in"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const isDirection = (v: unknown): v is Direction => v === "out" || v === "in";

// ---- What kind of shipment ----

export const KINDS: Record<Direction, readonly string[]> = {
  out: ["machine", "spare_parts", "change_parts", "samples", "other"],
  in: ["from_italy", "supplier", "return", "samples", "other"],
};
export const KIND_LABEL: Record<string, string> = {
  machine: "Machine",
  spare_parts: "Spare parts",
  change_parts: "Change parts",
  samples: "Samples",
  other: "Other",
  from_italy: "From Ronchi Italy",
  supplier: "Supplier delivery",
  return: "Customer return",
};
export const isKindFor = (d: Direction, v: unknown) => typeof v === "string" && KINDS[d].includes(v);

// ---- Steps ----

const OUT_STATUSES = ["to_pack", "packed", "shipped", "delivered", "on_hold", "cancelled"] as const;
const IN_STATUSES = ["expected", "arrived", "partly_received", "received", "on_hold", "cancelled"] as const;
export type Status = (typeof OUT_STATUSES)[number] | (typeof IN_STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  to_pack: "To pack",
  packed: "Packed, ready to go",
  shipped: "Shipped",
  delivered: "Delivered",
  expected: "Expected",
  arrived: "Arrived, not checked in",
  partly_received: "Partly received",
  received: "Received",
  on_hold: "On hold",
  cancelled: "Cancelled",
};
export const statusesFor = (d: Direction): readonly Status[] => (d === "out" ? OUT_STATUSES : IN_STATUSES);
export const isStatusFor = (d: Direction, v: unknown): v is Status => typeof v === "string" && (statusesFor(d) as readonly string[]).includes(v);
export const firstStatus = (d: Direction): Status => (d === "out" ? "to_pack" : "expected");
/** Finished: drops off the "open" lists. */
export const DONE_STATUSES: ReadonlySet<Status> = new Set(["delivered", "received", "cancelled"]);

/** A receipt's status from what has been checked in so far (only once it has arrived). */
export function receiveStatus(lines: { qty: number; qty_received: number }[]): Status {
  if (lines.length && lines.every((l) => l.qty_received >= l.qty)) return "received";
  if (lines.some((l) => l.qty_received > 0)) return "partly_received";
  return "arrived";
}

// ---- Problems found when receiving (or reported after delivery) ----

export const PROBLEMS = ["damaged", "short", "over", "wrong_item", "other"] as const;
export type Problem = (typeof PROBLEMS)[number];
export const PROBLEM_LABEL: Record<Problem, string> = {
  damaged: "Damaged",
  short: "Short (fewer than expected)",
  over: "Extra (more than expected)",
  wrong_item: "Wrong item",
  other: "Other problem",
};
export const isProblem = (v: unknown): v is Problem => typeof v === "string" && (PROBLEMS as readonly string[]).includes(v);

// ---- Carriers and tracking ----

/**
 * url: the carrier's public tracking page with {n} for the number (opens straight to the shipment).
 * page: for carriers whose tracking page can't be filled in from a link (most LTL carriers), the page
 * to open; the app copies the PRO number so it can be pasted there. Neither needs a carrier account.
 * These patterns aren't official and can change: see docs/research/shipping-and-receiving-software.md.
 */
export const CARRIERS: { id: string; name: string; freight?: boolean; url: string | null; page?: string }[] = [
  { id: "ups", name: "UPS", url: "https://www.ups.com/track?loc=en_US&tracknum={n}" },
  { id: "fedex", name: "FedEx", url: "https://www.fedex.com/fedextrack/?trknbr={n}" },
  { id: "usps", name: "USPS", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels={n}" },
  { id: "dhl", name: "DHL Express", url: "https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}" },
  { id: "ups_freight", name: "TForce Freight (LTL)", freight: true, url: null },
  { id: "fedex_freight", name: "FedEx Freight (LTL)", freight: true, url: "https://www.fedex.com/fedextrack/?trknbr={n}" },
  { id: "estes", name: "Estes (LTL)", freight: true, url: null, page: "https://www.estes-express.com/resources/enhanced-tracking" },
  { id: "odfl", name: "Old Dominion (LTL)", freight: true, url: null, page: "https://www.odfl.com/us/en/tools/trace-track-ltl-freight.html" },
  { id: "xpo", name: "XPO (LTL)", freight: true, url: null, page: "https://ltl.xpo.com/" },
  { id: "saia", name: "Saia (LTL)", freight: true, url: null, page: "https://www.saia.com/track" },
  { id: "rl", name: "R+L Carriers (LTL)", freight: true, url: null, page: "https://www.rlcarriers.com/freight/shipping/shipment-tracing" },
  { id: "abf", name: "ABF Freight (LTL)", freight: true, url: null },
  { id: "freight_other", name: "Other freight / truckload", freight: true, url: null },
  { id: "forwarder", name: "Freight forwarder (ocean or air)", freight: true, url: null },
  { id: "ronchi", name: "Ronchi truck or hand delivery", url: null },
  { id: "pickup", name: "Customer picks up", url: null },
  { id: "other", name: "Other", url: null },
];
const CARRIER_BY_ID = new Map(CARRIERS.map((c) => [c.id, c]));
export const isCarrier = (v: unknown): v is string => typeof v === "string" && CARRIER_BY_ID.has(v);
export const carrierName = (id: string | null | undefined) => (id ? CARRIER_BY_ID.get(id)?.name ?? id : "");

/** Every tracking number typed (one per package), split on commas, spaces or new lines. */
export function trackingNumbers(text: string | null | undefined): string[] {
  return [...new Set((text ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * Each tracking number with a link to the carrier's public tracking page (url null when there isn't one).
 * copy: true when the link only opens the carrier's tracking page and the number has to be pasted in.
 */
export function trackingLinks(carrier: string | null | undefined, text: string | null | undefined): { number: string; url: string | null; copy?: true }[] {
  const c = carrier ? CARRIER_BY_ID.get(carrier) : undefined;
  return trackingNumbers(text).map((number) =>
    c?.url ? { number, url: c.url.replace("{n}", encodeURIComponent(number)) } : c?.page ? { number, url: c.page, copy: true } : { number, url: null });
}

/** A best guess at the parcel carrier from the shape of a tracking number, or null. */
export function guessCarrier(number: string): string | null {
  const n = number.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "ups";
  if (/^(94|93|92|95)\d{20}$/.test(n) || /^[A-Z]{2}\d{9}US$/.test(n)) return "usps";
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n) || /^\d{20}$/.test(n)) return "fedex";
  if (/^\d{10}$/.test(n)) return "dhl";
  return null;
}

// ---- Numbers ----

/** The next shipment number: SH-2026-0042 out, RC-2026-0042 in, from the highest one this year. */
export function nextNumber(d: Direction, year: number, highest: string | null): string {
  const prefix = `${d === "out" ? "SH" : "RC"}-${year}-`;
  const last = highest?.startsWith(prefix) ? Number(highest.slice(prefix.length)) || 0 : 0;
  return prefix + String(last + 1).padStart(4, "0");
}

// ---- Packages ----

export const PACKAGE_TYPES = ["box", "envelope", "pallet", "crate", "skid", "drum", "other"] as const;
export const PACKAGE_LABEL: Record<(typeof PACKAGE_TYPES)[number], string> = {
  box: "Box", envelope: "Envelope", pallet: "Pallet", crate: "Crate", skid: "Skid", drum: "Drum", other: "Other",
};
export interface Package { type: (typeof PACKAGE_TYPES)[number]; count: number; weight: number | null; length: number | null; width: number | null; height: number | null }
export const MAX_PACKAGES = 50;

/** Check the packages list (weights in pounds, sizes in inches). Throws a plain message when it's wrong. */
export function cleanPackages(value: unknown): Package[] {
  if (!Array.isArray(value)) throw new Error("Packages must be a list.");
  if (value.length > MAX_PACKAGES) throw new Error(`Up to ${MAX_PACKAGES} package lines.`);
  return value.map((raw) => {
    const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!(PACKAGE_TYPES as readonly string[]).includes(p.type as string)) throw new Error("Pick a package type from the list.");
    const count = Number(p.count);
    if (!Number.isInteger(count) || count < 1 || count > 999) throw new Error("Package count must be a whole number from 1 to 999.");
    const num = (v: unknown, what: string, max: number) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > max) throw new Error(`${what} must be a number above 0 and up to ${max}.`);
      return Math.round(n * 10) / 10;
    };
    return {
      type: p.type as Package["type"], count,
      weight: num(p.weight, "Weight", 100_000),
      length: num(p.length, "Length", 1_000), width: num(p.width, "Width", 1_000), height: num(p.height, "Height", 1_000),
    };
  });
}

/** Number of pieces and total weight (each line's weight is per piece). */
export function packageTotals(list: Package[]): { pieces: number; weight: number } {
  return {
    pieces: list.reduce((n, p) => n + p.count, 0),
    weight: Math.round(list.reduce((n, p) => n + (p.weight ?? 0) * p.count, 0) * 10) / 10,
  };
}

// ---- Typed fields ----

/** The text fields of a shipment, with their length limits. */
export const SHIP_MAX = {
  party: 200,          // the customer (out) or the supplier / sender (in)
  machine: 60,         // machine number, e.g. 4110MB
  reference: 120,      // customer PO, supplier PO, RMA number or Ronchi Italy order
  address: 600,        // ship to (out) or ship from (in)
  origin: 600,         // ship from (out): Ronchi America's dock, kept from the last shipment
  contact_name: 120,
  contact_phone: 60,
  contact_email: 200,
  carrier_other: 120,  // carrier name when "Other" is picked
  service: 120,        // Ground, 2nd Day Air, LTL standard, ocean...
  tracking: 2000,      // one or more tracking or PRO numbers
  bol_number: 80,      // bill of lading number
  freight_class: 10,   // NMFC freight class, e.g. 85
  vessel: 120,         // in from Italy: ship name and voyage, or flight
  container: 60,       // in from Italy: container number
  broker: 120,         // in from Italy: customs broker
  problem_note: 2000,
  notes: 10_000,
} as const;
export type ShipTextField = keyof typeof SHIP_MAX;
export const SHIP_TEXT_FIELDS = Object.keys(SHIP_MAX) as ShipTextField[];

/**
 * A suggested LTL freight class from one piece's weight (lb) and size (in), by density (pounds per cubic
 * foot), using the density scale most LTL carriers use. Only a suggestion: some items have their own NMFC
 * class, so check with the carrier. null when weight or size is missing.
 */
export function freightClass(weight: number | null | undefined, length: number | null | undefined, width: number | null | undefined, height: number | null | undefined): string | null {
  if (!weight || !length || !width || !height) return null;
  const pcf = weight / ((length * width * height) / 1728);
  const scale: [number, string][] = [[1, "400"], [2, "300"], [4, "250"], [6, "175"], [8, "125"], [10, "100"], [12, "92.5"], [15, "85"], [22.5, "70"], [30, "65"], [35, "60"], [50, "55"]];
  return scale.find(([max]) => pcf < max)?.[1] ?? "50";
}

/** Extras a freight carrier needs to know (they change the price). */
export const FREIGHT_OPTIONS = ["liftgate", "inside_delivery", "appointment", "residential", "limited_access"] as const;
export const FREIGHT_LABEL: Record<(typeof FREIGHT_OPTIONS)[number], string> = {
  liftgate: "Liftgate needed",
  inside_delivery: "Inside delivery",
  appointment: "Call for appointment",
  residential: "Residential address",
  limited_access: "Limited access site",
};

/** How an incoming shipment travels (mostly for shipments from Italy). */
export const MODES = ["ocean", "air", "truck", "parcel"] as const;
export const MODE_LABEL: Record<(typeof MODES)[number], string> = { ocean: "Ocean", air: "Air", truck: "Truck", parcel: "Parcel" };
export const isMode = (v: unknown) => typeof v === "string" && (MODES as readonly string[]).includes(v);

/** What can be linked as the reason for a shipment. */
export const SOURCES = ["parts_order", "cp_order", "job"] as const;
export type Source = (typeof SOURCES)[number];
export const isSource = (v: unknown): v is Source => typeof v === "string" && (SOURCES as readonly string[]).includes(v);

export const MAX_LINES = 100;

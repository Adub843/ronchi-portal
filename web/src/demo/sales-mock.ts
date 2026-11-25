// DEMO ONLY. Parts orders and shipping and receiving in the preview, with example quotes, orders and
// shipments. Customers are made up. Uses the same shared rules as the real server (statuses, the
// tracker's numbers, tracking links), so the screens behave the same. No money anywhere, like the real thing.
import { toCsv } from "../../../src/shared/csv";
import {
  canMove, cleanLines, cleanNotes, cleanPoFields, fullyShipped, isBackordered, isPoStatus, isQuote, PO_CSV_HEADER, PO_FIELDS, PO_MOVES, poKpis,
  remaining, revLetter, shownStatus, toAllocate, type PoStatus,
} from "../../../src/shared/parts-orders";
import {
  ALLOCATED, IN_CSV_HEADER, inShown, isOutStatus, OUT_CSV_HEADER, OUT_LABELS, OUT_MOVES, SHIPPED, shipKpis, templateProblem, trackingHint, trackingUrl,
  type InStage, type OutStatus,
} from "../../../src/shared/shipping";

export class SalesFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, message: string): never => { throw new SalesFail(status, message); };

interface Ctx { me: { id: string; name: string }; perms: Set<string>; newId: () => string; pdf: (title: string) => Blob; machines: { id: string; serial: string }[]; cpOrders: any[] }

let s: ReturnType<typeof seed> | null = null;

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const at = (n: number, h = 10) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const now = () => new Date().toISOString();

const CARRIERS = [
  ["ups", "UPS", "parcel", "https://www.ups.com/track?tracknum={n}", 1], ["fedex", "FedEx", "parcel", "https://www.fedex.com/fedextrack/?trknbr={n}", 1],
  ["usps", "USPS", "parcel", "https://tools.usps.com/go/TrackConfirmAction?tLabels={n}", 1], ["dhl", "DHL Express", "courier", "https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}", 1],
  ["odfl", "Old Dominion", "ltl", "https://www.odfl.com/us/en/tools/trace-track-ltl-freight/trace.html?proNumbers={n}", 0], ["estes", "Estes", "ltl", "https://www.estes-express.com/myestes/shipment-tracking/?type=PRO&query={n}", 0],
  ["saia", "Saia", "ltl", "https://www.saia.com/track/details;pro={n}", 0], ["rl", "R+L Carriers", "ltl", "https://www2.rlcarriers.com/freight/shipping/shipment-tracing?pro={n}", 0],
  ["abf", "ABF Freight", "ltl", "https://arcb.com/tools/tracking.html#/{n}", 0], ["xpo", "XPO", "ltl", null, 0], ["ocean", "Ocean line", "ocean", null, 0],
  ["pickup", "Customer pickup", "pickup", null, 1], ["other", "Other", "other", null, 1],
] as const;

function seed(c: Ctx) {
  const id = c.newId;
  const orders: any[] = [];
  const lines: any[] = [];
  const audit: any[] = [];
  const outbound: any[] = [];
  const outLines: any[] = [];
  const counters: Record<string, number> = {};
  const num = (p: string) => { const y = new Date().getFullYear(); const k = `${p}-${y}`; counters[k] = (counters[k] ?? 0) + 1; return `${k}-${String(counters[k]).padStart(4, "0")}`; };
  const o = (f: any, ls: [string, string, number, boolean?][], who = "Andrew Yang") => {
    const row = {
      id: id(), quote_number: num("Q"), quote_rev: 0, order_number: null as string | null, status: "quote" as PoStatus, contact: null, machine: null, customer_po: null, salesperson: who,
      follow_up: null, valid_until: null, promised_date: null, hold_reason: null, reason: null, request_id: null, request_number: null, notes: null, revision: 1,
      sent_at: null, booked_at: null, lost_at: null, closed_at: null, cancelled_at: null, created_at: at(-20), updated_at: at(-1), ...f,
    };
    if (row.booked_at && !row.order_number) row.order_number = num("SO");
    orders.push(row);
    ls.forEach(([part_code, description, qty, backorder], i) => lines.push({ id: id(), order_id: row.id, line_no: i + 1, part_code, description, qty, backorder: backorder ? 1 : 0 }));
    audit.push({ type: "parts_order", id: row.id, at: row.created_at, action: "po.create", who, detail: { lines: ls.length } });
    if (row.booked_at) audit.unshift({ type: "parts_order", id: row.id, at: row.booked_at, action: "po.status", who, detail: { from: "sent", to: "booked", customer_po: row.customer_po } });
    return row;
  };
  // Earlier months' bookings, so the tracker has a year to show.
  const months = [-330, -300, -270, -250, -215, -190, -160, -150, -120, -95, -70, -64, -40, -33, -12];
  months.forEach((n, i) => {
    const r = o({ customer: ["Example Foods Inc.", "Example Pharma Co.", "Example Home Care", "Example Personal Care"][i % 4], status: "closed", customer_po: `PO-${4100 + i}`, created_at: at(n - 6), booked_at: at(n), closed_at: at(n + 12), promised_date: day(n + 10) },
      [["R-10442", "Star wheel, 500 ml round", 1 + (i % 3)]], i % 2 ? "Michele Falsini" : "Andrew Yang");
    const out = { id: id(), number: num("OUT"), source: "parts_order", po_order_id: r.id, cp_order_id: null, customer: r.customer, ship_to: null, carrier_id: "ups", service: "Ground", tracking: `1Z999AA1012345${String(6700 + i)}`, boxes: 1, weight_lb: 6.5, ship_date: day(n + (i % 4 === 0 ? 14 : 7)), status: "delivered", notes: null, delivered_at: at(n + 10), revision: 1, created_at: at(n + 1), updated_at: at(n + 8) };
    outbound.push(out);
    outLines.push({ id: id(), outbound_id: out.id, po_line_id: lines[lines.length - 1].id, part_code: "R-10442", description: "Star wheel, 500 ml round", qty: lines[lines.length - 1].qty });
  });
  [-200, -110, -45].forEach((n, i) => o({ customer: "Example Beverage Co.", status: "lost", reason: ["Price", "Lead time", "Bought elsewhere"][i], created_at: at(n - 5), lost_at: at(n) }, [["R-30110", "Guide rail kit", 1]]));

  // Today's work.
  o({ customer: "Example Foods Inc.", contact: "Dana Smith (dana.smith@example.com)", machine: "4222TP", follow_up: day(-1), valid_until: day(20), status: "sent", sent_at: at(-6), notes: "Called Dana. Line 2 shutdown is the week of Dec 14, wants everything before then." },
    [["R-20871", "Piston O-ring kit, 12 heads", 2], ["R-20877", "Nozzle seal, 500 ml", 24], ["R-11905", "Filling valve spring", 12]]);
  o({ customer: "Example Personal Care", contact: "Sam Ortiz", machine: "3535MB", follow_up: day(4), valid_until: day(30) },
    [["R-40220", "Gripper pad set", 1], ["R-40231", "Cap chute guide, left", 1]], "Michele Falsini");
  o({ customer: "Example Home Care", machine: "4212MB", status: "quote", quote_rev: 1, follow_up: day(2), created_at: at(-9) },
    [["R-55002", "Trigger sprayer chuck insert", 6]]);
  const late = o({ customer: "Example Pharma Co.", contact: "Lee Park", machine: "3069MB", customer_po: "PO-77810", status: "booked", created_at: at(-30), booked_at: at(-24), promised_date: day(-3) },
    [["R-30815", "Capper clutch, magnetic", 1, true], ["R-30816", "Clutch spring set", 4]], "Michele Falsini");
  const partial = o({ customer: "Example Foods Inc.", contact: "Dana Smith", machine: "4222TP", customer_po: "4500018832", status: "booked", created_at: at(-18), booked_at: at(-15), promised_date: day(5) },
    [["R-10442", "Star wheel, 500 ml round", 2], ["R-20871", "Piston O-ring kit, 12 heads", 10, true], ["R-11905", "Filling valve spring", 24]]);
  const fresh = o({ customer: "Example Personal Care", machine: "3535MB", customer_po: "PC-2291", status: "booked", created_at: at(-4), booked_at: at(-1), promised_date: day(9) },
    [["R-40220", "Gripper pad set", 2], ["R-40231", "Cap chute guide, left", 1]]);
  o({ customer: "Example Pharma Co.", machine: "3811CP", customer_po: "PO-77502", status: "booked", created_at: at(-40), booked_at: at(-36), promised_date: day(-20) },
    [["R-30816", "Clutch spring set", 2]], "Michele Falsini");

  // The partial order: some shipped by UPS last week, the rest waiting on Italy.
  const pl = lines.filter((l) => l.order_id === partial.id);
  const sh1 = { id: id(), number: num("OUT"), source: "parts_order", po_order_id: partial.id, cp_order_id: null, customer: partial.customer, ship_to: "Example Foods Inc.\nAttn: Receiving, Dock 4\n1200 Example Pkwy\nAtlanta, GA 30336", carrier_id: "ups", service: "Ground", tracking: "1Z999AA10123456784", boxes: 2, weight_lb: 18.4, ship_date: day(-3), status: "shipped", notes: null, delivered_at: null, revision: 3, created_at: at(-4), updated_at: at(-3) };
  outbound.push(sh1);
  outLines.push({ id: id(), outbound_id: sh1.id, po_line_id: pl[0].id, part_code: pl[0].part_code, description: pl[0].description, qty: 2 }, { id: id(), outbound_id: sh1.id, po_line_id: pl[1].id, part_code: pl[1].part_code, description: pl[1].description, qty: 4 }, { id: id(), outbound_id: sh1.id, po_line_id: pl[2].id, part_code: pl[2].part_code, description: pl[2].description, qty: 24 });
  audit.unshift({ type: "parts_order", id: partial.id, at: at(-3), action: "po.shipment.status", who: "Lola Parker", detail: { number: sh1.number, from: "packed", to: "shipped", tracking: sh1.tracking } });
  // The fresh order is being packed today.
  const fl = lines.filter((l) => l.order_id === fresh.id);
  const sh2 = { id: id(), number: num("OUT"), source: "parts_order", po_order_id: fresh.id, cp_order_id: null, customer: fresh.customer, ship_to: "Example Personal Care\n77 Example Way\nNew Albany, OH 43054", carrier_id: "fedex", service: "2Day", tracking: null, boxes: 1, weight_lb: null, ship_date: day(0), status: "packed", notes: null, delivered_at: null, revision: 2, created_at: at(0, 8), updated_at: at(0, 9) };
  outbound.push(sh2);
  outLines.push(...fl.map((l) => ({ id: id(), outbound_id: sh2.id, po_line_id: l.id, part_code: l.part_code, description: l.description, qty: l.qty })));
  // A change-part set going out by freight.
  const cp = c.cpOrders.find((x) => x.phase !== "sale");
  if (cp) {
    const sh3 = { id: id(), number: num("OUT"), source: "change_part", po_order_id: null, cp_order_id: cp.id, customer: cp.customer, ship_to: null, carrier_id: "odfl", service: "LTL standard", tracking: "07812345678", boxes: 1, weight_lb: 212, ship_date: day(-1), status: "shipped", notes: "One crate, 48 x 40 x 36 in.", delivered_at: null, revision: 2, created_at: at(-2), updated_at: at(-1) };
    outbound.push(sh3);
    outLines.push({ id: id(), outbound_id: sh3.id, po_line_id: null, part_code: null, description: cp.part ?? "Change-part set", qty: 1 });
  }
  void late;

  // Coming in.
  const inbound: any[] = [];
  const inLines: any[] = [];
  const receipts: any[] = [];
  const issues: any[] = [];
  const inb = (f: any, ls: [string, string, number, string?][]) => {
    const row = { id: id(), number: num("IN"), reference: null, mode: "courier", carrier_id: null, tracking: null, expected_date: null, stage: "expected", customs_status: "none", broker: null, customs_notes: null, notes: null, received_at: null, revision: 1, created_at: at(-10), updated_at: at(-1), ...f };
    inbound.push(row);
    ls.forEach(([part_code, description, qty, bin], i) => inLines.push({ id: id(), inbound_id: row.id, line_no: i + 1, part_code, description, qty_expected: qty, bin: bin ?? null }));
    return row;
  };
  inb({ supplier: "Ronchi Mario S.p.A.", reference: "IT-ORD-3391", mode: "air", carrier_id: "dhl", tracking: "1234567890", expected_date: day(2), stage: "in_transit", customs_status: "pending", broker: "Example Customs Brokers", customs_notes: "Entry filed. Waiting on release." },
    [["R-20871", "Piston O-ring kit, 12 heads", 20], ["R-30815", "Capper clutch, magnetic", 2]]);
  inb({ supplier: "Ronchi Mario S.p.A.", reference: "IT-ORD-3402 (machine 4301MB)", mode: "ocean", carrier_id: "ocean", tracking: "MSCU1234567", expected_date: day(-2), stage: "at_customs", customs_status: "held", broker: "Example Customs Brokers", customs_notes: "Held for exam. Broker expects release in 2 to 3 days." },
    [["4301MB", "Monoblock filler and capper, 3 crates", 1]]);
  const got = inb({ supplier: "Example Seals LLC", reference: "RA-PO-1187", mode: "courier", carrier_id: "ups", tracking: "1Z999AA10123450001", expected_date: day(-4), stage: "arrived" },
    [["R-20877", "Nozzle seal, 500 ml", 50, "B-02-1"], ["R-11905", "Filling valve spring", 40, "B-02-3"]]);
  const gl = inLines.filter((l) => l.inbound_id === got.id);
  receipts.push({ id: id(), inbound_id: got.id, line_id: gl[0].id, qty: 48, damaged: 2, bin: "B-02-1", by_name: "Lola Parker", at: at(-3, 14) }, { id: id(), inbound_id: got.id, line_id: gl[1].id, qty: 25, damaged: 0, bin: "B-02-3", by_name: "Lola Parker", at: at(-3, 14) });
  issues.push({ id: id(), inbound_id: got.id, line_id: gl[0].id, kind: "damaged", qty: 2, note: "Two seals cut by the strapping.", status: "open", resolution: null, by_name: "Lola Parker", created_at: at(-3, 14), resolved_by_name: null, resolved_at: null });
  inb({ supplier: "Ronchi Mario S.p.A.", reference: "IT-ORD-3376", mode: "air", carrier_id: "dhl", tracking: "9876543210", expected_date: day(-12), stage: "arrived", received_at: at(-11) }, [["R-10442", "Star wheel, 500 ml round", 6, "A-03-2"]]);
  receipts.push({ id: id(), inbound_id: inbound[3].id, line_id: inLines[inLines.length - 1].id, qty: 6, damaged: 0, bin: "A-03-2", by_name: "Lola Parker", at: at(-11) });

  return {
    orders, lines, audit, outbound, outLines, inbound, inLines, receipts, issues, revisions: [] as any[], poFiles: [] as any[], shFiles: [] as any[],
    carriers: CARRIERS.map(([cid, name, mode, url_template, checked], i): any => ({ id: cid, name, mode, url_template, checked, active: 1, sort: i, updated_by: null, updated_at: null })) as any[],
    counters, num,
  };
}

export function resetSales() {
  s = null;
}

const can = (c: Ctx, p: string) => c.perms.has(p);
const need = (c: Ctx, p: string) => { if (!can(c, p)) fail(403, "Your role doesn't allow this."); };
const guard = <T>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof SalesFail) throw e; return fail(400, (e as Error).message); } };

function lineState(lineId: string) {
  const d = s!;
  let shipped = 0, allocated = 0, last: string | null = null;
  for (const ol of d.outLines.filter((x) => x.po_line_id === lineId)) {
    const o = d.outbound.find((x) => x.id === ol.outbound_id)!;
    if ((SHIPPED as readonly string[]).includes(o.status)) { shipped += ol.qty; if (o.ship_date && (!last || o.ship_date > last)) last = o.ship_date; }
    if ((ALLOCATED as readonly string[]).includes(o.status)) allocated += ol.qty;
  }
  return { shipped, allocated, last_ship: last };
}
const linesOf = (orderId: string) => s!.lines.filter((l) => l.order_id === orderId).sort((a, b) => a.line_no - b.line_no).map((l) => ({ ...l, ...lineState(l.id) }));

function summary(o: any) {
  const ls = linesOf(o.id);
  const today = day(0);
  const shown = shownStatus(o.status, ls);
  return {
    ...o, rev: revLetter(o.quote_rev), shown, lines: ls.length, qty: ls.reduce((n, l) => n + l.qty, 0), qty_shipped: ls.reduce((n, l) => n + Math.min(l.shipped, l.qty), 0),
    backordered: ls.filter(isBackordered).length,
    shipped_on: o.status !== "cancelled" && fullyShipped(ls) ? ls.reduce<string | null>((m, l) => (l.last_ship && (!m || l.last_ship > m) ? l.last_ship : m), null) : null,
    late: o.status === "booked" && shown !== "Shipped" && !!o.promised_date && o.promised_date < today,
    expired: isQuote(o.status) && !!o.valid_until && o.valid_until < today,
    due: isQuote(o.status) && !!o.follow_up && o.follow_up <= today,
  };
}
const history = (type: string, oid: string) => s!.audit.filter((h) => h.type === type && h.id === oid).sort((a, b) => b.at.localeCompare(a.at)).map(({ at: a, action, who, detail }) => ({ at: a, action, who, detail }));
const log = (c: Ctx, type: string, oid: string, action: string, detail: any = null) => s!.audit.push({ type, id: oid, at: now(), action, who: c.me.name, detail });
const carrierOf = (cid: string | null) => s!.carriers.find((x) => x.id === cid) ?? null;
function storeFiles(c: Ctx, body: any, extra: Record<string, unknown>) {
  const files: File[] = body.files ?? [];
  if (!files.length) fail(400, "Choose a file to add.");
  return files.map((f) => ({ id: c.newId(), name: f.name, size: f.size, created_at: now(), by_name: c.me.name, url: URL.createObjectURL(f), ...extra }));
}

// ---------- parts orders ----------

export function partsOrdersRoute(method: string, seg: string[], body: any, c: Ctx): unknown {
  if (!s) s = seed(c);
  const d = s;
  need(c, "psales.view");
  const find = (oid: string) => d.orders.find((x) => x.id === oid) ?? fail(404, "Not found.");
  const check = (o: any) => { if (body.revision !== o.revision) fail(409, "Someone else changed this parts order while you were working on it. Reload to see their changes."); };
  if (!seg[1] && method === "GET") {
    const orders = [...d.orders].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((o) => ({ ...summary(o), machine_id: c.machines.find((m) => m.serial === o.machine)?.id ?? null }));
    return { orders, kpis: poKpis(orders, day(0)) };
  }
  if (seg[1] === "export") {
    const rows: unknown[][] = [];
    for (const o of d.orders) {
      const ls = linesOf(o.id);
      const sm = summary(o);
      for (const l of ls) rows.push([o.quote_number, sm.rev, o.order_number, sm.shown, o.customer, o.contact, o.machine, o.customer_po, o.salesperson, o.follow_up, o.valid_until, o.promised_date, o.booked_at?.slice(0, 10), sm.shipped_on, l.line_no, l.part_code, l.description, l.qty, Math.min(l.shipped, l.qty), isBackordered(l) ? "Yes" : ""]);
    }
    return { __text: toCsv(PO_CSV_HEADER, rows) };
  }
  if (seg[1] === "files" && method === "DELETE") { need(c, "psales.edit"); d.poFiles = d.poFiles.filter((f) => f.id !== seg[2]); return { ok: true }; }
  if (seg[1] === "from-request") return fail(400, "The preview has no customer parts site, so there are no requests to start from.");
  if (!seg[1] && method === "POST") {
    need(c, "psales.edit");
    const f = guard(() => cleanPoFields(body));
    const ls = guard(() => (body.lines ? cleanLines(body.lines) : []));
    if (!f.customer) fail(400, "Customer is required.");
    const o = { id: c.newId(), quote_number: d.num("Q"), quote_rev: 0, order_number: null, status: "quote", ...Object.fromEntries(PO_FIELDS.map((k) => [k, null])), ...f, salesperson: f.salesperson || c.me.name, reason: null, request_id: null, request_number: null, notes: guard(() => cleanNotes(body.notes)), revision: 1, sent_at: null, booked_at: null, lost_at: null, closed_at: null, cancelled_at: null, created_at: now(), updated_at: now() };
    d.orders.push(o);
    ls.forEach((l, i) => d.lines.push({ id: c.newId(), order_id: o.id, line_no: i + 1, part_code: l.part_code, description: l.description, qty: l.qty, backorder: l.backorder ? 1 : 0 }));
    log(c, "parts_order", o.id, "po.create", { lines: ls.length });
    return { id: o.id };
  }
  const o = find(seg[1]!);
  if (method === "GET") {
    const ls = linesOf(o.id);
    const ships = d.outbound.filter((x) => x.po_order_id === o.id).map((x) => ({ ...x, carrier: carrierOf(x.carrier_id)?.name ?? null, tracking_url: trackingUrl(carrierOf(x.carrier_id)?.url_template, x.tracking), lines: d.outLines.filter((l) => l.outbound_id === x.id) }));
    return {
      order: { ...summary(o), machine_id: c.machines.find((m) => m.serial === o.machine)?.id ?? null, moves: PO_MOVES[o.status as PoStatus] },
      lines: ls.map((l) => ({ ...l, backorder: !!l.backorder, remaining: remaining(l), backordered: isBackordered(l) })),
      revisions: d.revisions.filter((r) => r.order_id === o.id).sort((a, b) => b.rev - a.rev).map((r) => ({ ...r, rev: revLetter(r.rev) })),
      files: d.poFiles.filter((f) => f.order_id === o.id), shipments: ships, history: history("parts_order", o.id),
    };
  }
  need(c, "psales.edit");
  const touch = () => { o.revision++; o.updated_at = now(); };
  if (seg[2] === "files") { const added = storeFiles(c, body, { order_id: o.id }); d.poFiles.unshift(...added); log(c, "parts_order", o.id, "po.file.add", { names: added.map((f) => f.name) }); return { ids: added.map((f) => f.id) }; }
  if (seg[2] === "notes") { o.notes = guard(() => cleanNotes(body.notes)); o.updated_at = now(); log(c, "parts_order", o.id, "po.notes"); return { ok: true }; }
  if (seg[2] === "lines") {
    check(o);
    const ls = guard(() => cleanLines(body.lines));
    const had = linesOf(o.id);
    for (const l of ls) { const old = had.find((h) => h.id === l.id); if (old && l.qty < old.shipped + old.allocated) fail(400, `Line ${old.line_no}: ${old.shipped + old.allocated} are already shipped or being packed, so the quantity can't be less.`); }
    for (const h of had) if (!ls.some((l) => l.id === h.id) && d.outLines.some((x) => x.po_line_id === h.id)) fail(400, `Line ${h.line_no} is on a shipment, so it can't be removed.`);
    d.lines = d.lines.filter((l) => l.order_id !== o.id || ls.some((x) => x.id === l.id));
    ls.forEach((l, i) => {
      const ex = d.lines.find((x) => x.id === l.id);
      if (ex) Object.assign(ex, { line_no: i + 1, part_code: l.part_code, description: l.description, qty: l.qty, backorder: l.backorder ? 1 : 0 });
      else d.lines.push({ id: c.newId(), order_id: o.id, line_no: i + 1, part_code: l.part_code, description: l.description, qty: l.qty, backorder: l.backorder ? 1 : 0 });
    });
    touch();
    log(c, "parts_order", o.id, "po.lines", { after: ls.map((l) => `${l.part_code ?? l.description} × ${l.qty}`) });
    return { ok: true, revision: o.revision };
  }
  if (seg[2] === "revise") {
    check(o);
    if (!isQuote(o.status)) fail(409, "Only a quote can be revised.");
    d.revisions.push({ order_id: o.id, rev: o.quote_rev, saved_at: now(), saved_by: c.me.name, lines: linesOf(o.id).map((l) => ({ part_code: l.part_code, description: l.description, qty: l.qty })) });
    log(c, "parts_order", o.id, "po.revise", { from: revLetter(o.quote_rev), to: revLetter(o.quote_rev + 1) });
    o.quote_rev++; o.status = "quote"; touch();
    return { ok: true, revision: o.revision, rev: revLetter(o.quote_rev) };
  }
  if (seg[2] === "status") {
    check(o);
    const to = isPoStatus(body.to) ? body.to : fail(400, "Pick what to change it to.");
    if (!canMove(o.status, to)) fail(409, "It can't be changed to that.");
    const ls = linesOf(o.id);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) || null : null;
    if (to === "booked" && o.status !== "closed") {
      const po = String(body.customer_po ?? o.customer_po ?? "").trim();
      if (!po) fail(400, "Add the customer's PO to book the order.");
      if (!ls.length) fail(400, "Add at least one line before booking the order.");
      Object.assign(o, { customer_po: po, promised_date: body.promised_date ?? o.promised_date, order_number: o.order_number ?? d.num("SO"), booked_at: o.booked_at ?? now(), follow_up: null });
    }
    if (to === "lost") { if (!reason) fail(400, "Say why it was lost."); Object.assign(o, { reason, lost_at: now() }); }
    if (to === "cancelled") { if (!reason) fail(400, "Say why it was cancelled."); if (ls.some((l) => l.shipped || l.allocated)) fail(409, "Parts on this order have shipped or are being packed, so it can't be cancelled."); Object.assign(o, { reason, cancelled_at: now() }); }
    if (to === "closed" && !fullyShipped(ls)) fail(409, "Ship every line before closing the order, or cancel what's left.");
    if (to === "quote") Object.assign(o, { reason: null, lost_at: null });
    if (to === "sent") o.sent_at = now();
    log(c, "parts_order", o.id, "po.status", { from: o.status, to, reason, customer_po: to === "booked" ? o.customer_po : undefined });
    o.status = to; touch();
    return { ok: true, revision: o.revision };
  }
  if (method === "PATCH") {
    check(o);
    const f = guard(() => cleanPoFields(body));
    const changes: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(f)) if ((o[k] ?? null) !== (v ?? null)) { changes[k] = [o[k] ?? null, v]; o[k] = v; }
    if (Object.keys(changes).length) { touch(); log(c, "parts_order", o.id, "po.update", { changes }); }
    return { ok: true, revision: o.revision };
  }
  return fail(404, "Not found.");
}

// ---------- shipping ----------

export function shippingRoute(method: string, seg: string[], q: URLSearchParams, body: any, c: Ctx): unknown {
  if (!s) s = seed(c);
  const d = s;
  need(c, "ship.view");
  const today = day(0);
  const inSum = (i: any) => {
    const ls = d.inLines.filter((l) => l.inbound_id === i.id).map((l) => {
      const rs = d.receipts.filter((r) => r.line_id === l.id);
      const good = rs.reduce((n, r) => n + r.qty, 0), dmg = rs.reduce((n, r) => n + r.damaged, 0);
      return { ...l, qty_good: good, qty_damaged: dmg, qty_received: good + dmg, open: Math.max(0, l.qty_expected - good - dmg) };
    });
    const car = carrierOf(i.carrier_id);
    return { ...i, carrier: car?.name ?? null, tracking_url: trackingUrl(car?.url_template, i.tracking), shown: inShown(i.stage as InStage, ls), lines: ls.length, qty_expected: ls.reduce((n, l) => n + l.qty_expected, 0), qty_received: ls.reduce((n, l) => n + l.qty_received, 0), open_issues: d.issues.filter((x) => x.inbound_id === i.id && x.status === "open").length, _lines: ls };
  };
  const outSum = (o: any) => {
    const car = carrierOf(o.carrier_id);
    const po = d.orders.find((x) => x.id === o.po_order_id);
    const ls = d.outLines.filter((l) => l.outbound_id === o.id);
    return { ...o, carrier: car?.name ?? null, carrier_mode: car?.mode ?? null, tracking_url: trackingUrl(car?.url_template, o.tracking), order_number: po?.order_number ?? null, quote_number: po?.quote_number ?? null, order_po: po?.customer_po ?? null, lines: ls.length, qty: ls.reduce((n, l) => n + l.qty, 0) };
  };
  const strip = ({ _lines, ...x }: any) => x;

  if (!seg[1]) {
    const inbound = [...d.inbound].sort((a, b) => (b.expected_date ?? "").localeCompare(a.expected_date ?? "")).map(inSum);
    const outbound = [...d.outbound].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(outSum);
    return { inbound: inbound.map(strip), outbound, kpis: shipKpis(inbound, outbound, today) };
  }
  if (seg[1] === "carriers") {
    if (method === "GET") return { carriers: d.carriers };
    need(c, "ship.edit");
    if (method === "POST") {
      if (!String(body.name ?? "").trim()) fail(400, "The carrier name is required.");
      if (body.url_template && templateProblem(body.url_template)) fail(400, templateProblem(body.url_template)!);
      d.carriers.push({ id: c.newId(), name: String(body.name).trim(), mode: body.mode ?? "other", url_template: body.url_template ?? null, checked: 0, active: 1, sort: 500, updated_by: null, updated_at: now() });
      return { ok: true };
    }
    const car = d.carriers.find((x) => x.id === seg[2]) ?? fail(404, "Not found.");
    if (body.url_template !== undefined) {
      if (body.url_template && templateProblem(body.url_template)) fail(400, templateProblem(body.url_template)!);
      if (body.url_template !== car.url_template) car.checked = 0;
      car.url_template = body.url_template || null;
    }
    if (body.checked !== undefined) car.checked = body.checked ? 1 : 0;
    if (body.active !== undefined) car.active = body.active ? 1 : 0;
    return { ok: true };
  }
  if (seg[1] === "export") {
    if (q.get("kind") === "out") {
      const rows = d.outbound.flatMap((o) => { const sm = outSum(o); return d.outLines.filter((l) => l.outbound_id === o.id).map((l, i) => [o.number, o.source, sm.order_number, o.customer, sm.carrier, o.service, o.tracking, o.boxes, o.weight_lb, o.ship_date, OUT_LABELS[o.status as OutStatus], i + 1, l.part_code, l.description, l.qty]); });
      return { __text: toCsv(OUT_CSV_HEADER, rows) };
    }
    const rows = d.inbound.flatMap((i) => { const sm = inSum(i); return sm._lines.map((l: any) => [i.number, i.supplier, i.reference, i.mode, sm.carrier, i.tracking, i.expected_date, sm.shown, i.customs_status, l.line_no, l.part_code, l.description, l.qty_expected, l.qty_received, l.bin]); });
    return { __text: toCsv(IN_CSV_HEADER, rows) };
  }
  if (seg[1] === "files" && method === "DELETE") { need(c, "ship.edit"); d.shFiles = d.shFiles.filter((f) => f.id !== seg[2]); return { ok: true }; }
  if (seg[1] === "sources") {
    need(c, "ship.edit");
    const partsOrders = d.orders.filter((o) => o.status === "booked").map((o) => ({ ...o, lines: linesOf(o.id).map((l) => ({ ...l, to_ship: toAllocate(l) })) })).filter((o) => o.lines.some((l: any) => l.to_ship > 0));
    return { partsOrders, changeParts: c.cpOrders.filter((x) => x.phase !== "sale" && !x.removed_at).slice(0, 50) };
  }
  if (seg[1] === "issues") {
    need(c, "ship.edit");
    const i = d.issues.find((x) => x.id === seg[2]) ?? fail(404, "Not found.");
    if (body.status === "resolved" && !String(body.resolution ?? "").trim()) fail(400, "Say how it was sorted out.");
    Object.assign(i, body.status === "resolved" ? { status: "resolved", resolution: body.resolution, resolved_by_name: c.me.name, resolved_at: now() } : { status: "open", resolution: null });
    log(c, "inbound", i.inbound_id, body.status === "resolved" ? "inbound.issue.resolve" : "inbound.issue.reopen", { kind: i.kind, resolution: body.resolution });
    return { ok: true };
  }

  if (seg[1] === "inbound") {
    if (!seg[2]) {
      need(c, "ship.edit");
      if (!String(body.supplier ?? "").trim()) fail(400, "The supplier is required.");
      const row = { id: c.newId(), number: d.num("IN"), supplier: body.supplier.trim(), reference: body.reference || null, mode: body.mode ?? "courier", carrier_id: body.carrier_id || null, tracking: body.tracking || null, expected_date: body.expected_date || null, stage: "expected", customs_status: body.customs_status ?? "none", broker: body.broker || null, customs_notes: null, notes: null, received_at: null, revision: 1, created_at: now(), updated_at: now() };
      d.inbound.push(row);
      (body.lines ?? []).forEach((l: any, i: number) => d.inLines.push({ id: c.newId(), inbound_id: row.id, line_no: i + 1, part_code: l.part_code?.toUpperCase() || null, description: l.description || null, qty_expected: Number(l.qty_expected ?? l.qty), bin: null }));
      log(c, "inbound", row.id, "inbound.create");
      return { id: row.id, number: row.number, hint: trackingHint(row.carrier_id, row.tracking) };
    }
    const i = d.inbound.find((x) => x.id === seg[2]) ?? fail(404, "Not found.");
    if (method === "GET") {
      const sm = inSum(i);
      return {
        inbound: strip(sm), lines: sm._lines,
        issues: d.issues.filter((x) => x.inbound_id === i.id).map((x) => { const l = d.inLines.find((y) => y.id === x.line_id); return { ...x, line_no: l?.line_no ?? null, part_code: l?.part_code ?? null }; }),
        receipts: d.receipts.filter((r) => r.inbound_id === i.id).sort((a, b) => b.at.localeCompare(a.at)).map((r) => { const l = d.inLines.find((y) => y.id === r.line_id)!; return { ...r, line_no: l.line_no, part_code: l.part_code }; }),
        files: d.shFiles.filter((f) => f.owner_id === i.id), history: history("inbound", i.id),
      };
    }
    need(c, "ship.edit");
    if (seg[3] === "files") { const added = storeFiles(c, body, { owner_id: i.id, issue_id: null }); d.shFiles.unshift(...added); log(c, "inbound", i.id, "inbound.file.add", { names: added.map((f) => f.name) }); return { ids: added.map((f) => f.id) }; }
    if (seg[3] === "issues") {
      const iss = { id: c.newId(), inbound_id: i.id, line_id: body.line_id || null, kind: body.kind, qty: body.qty ? Number(body.qty) : null, note: body.note || null, status: "open", resolution: null, by_name: c.me.name, created_at: now(), resolved_by_name: null, resolved_at: null };
      d.issues.unshift(iss);
      log(c, "inbound", i.id, "inbound.issue", { kind: iss.kind, qty: iss.qty, note: iss.note });
      return { id: iss.id };
    }
    if (seg[3] === "receive") {
      const got = (body.lines ?? []).filter((g: any) => g.qty > 0 || g.damaged > 0);
      if (!got.length) fail(400, "Type how many came in on at least one line.");
      for (const g of got) {
        const l = d.inLines.find((x) => x.id === g.line_id) ?? fail(400, "One of the lines isn't on this shipment.");
        d.receipts.push({ id: c.newId(), inbound_id: i.id, line_id: l.id, qty: g.qty, damaged: g.damaged, bin: g.bin?.toUpperCase() || null, by_name: c.me.name, at: now() });
        if (g.bin) l.bin = g.bin.toUpperCase();
        if (g.damaged) d.issues.unshift({ id: c.newId(), inbound_id: i.id, line_id: l.id, kind: "damaged", qty: g.damaged, note: body.note || null, status: "open", resolution: null, by_name: c.me.name, created_at: now(), resolved_by_name: null, resolved_at: null });
      }
      if (["expected", "in_transit", "at_customs"].includes(i.stage)) i.stage = "arrived";
      const sm = inSum(i);
      if (sm.shown === "Received") i.received_at = now();
      i.revision++;
      log(c, "inbound", i.id, "inbound.receive", { lines: got.map((g: any) => ({ line: d.inLines.find((x) => x.id === g.line_id)!.line_no, qty: g.qty, damaged: g.damaged, bin: g.bin })) });
      return { ok: true, received: sm.shown === "Received", issues: got.filter((g: any) => g.damaged).length };
    }
    if (seg[3] === "lines") {
      d.inLines = d.inLines.filter((l) => l.inbound_id !== i.id || (body.lines ?? []).some((x: any) => x.id === l.id));
      (body.lines ?? []).forEach((l: any, n: number) => {
        const ex = d.inLines.find((x) => x.id === l.id);
        if (ex) Object.assign(ex, { line_no: n + 1, part_code: l.part_code || null, description: l.description || null, qty_expected: Number(l.qty_expected) });
        else d.inLines.push({ id: c.newId(), inbound_id: i.id, line_no: n + 1, part_code: l.part_code || null, description: l.description || null, qty_expected: Number(l.qty_expected), bin: null });
      });
      i.revision++;
      log(c, "inbound", i.id, "inbound.lines");
      return { ok: true };
    }
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of ["supplier", "reference", "mode", "carrier_id", "tracking", "expected_date", "stage", "customs_status", "broker", "customs_notes", "notes"]) {
      if (body[k] === undefined) continue;
      const v = body[k] === "" ? null : body[k];
      if ((i[k] ?? null) !== v) { changes[k] = [i[k] ?? null, v]; i[k] = v; }
    }
    i.revision++;
    if (Object.keys(changes).length) log(c, "inbound", i.id, "inbound.update", { changes });
    return { ok: true, revision: i.revision, hint: trackingHint(i.carrier_id, i.tracking) };
  }

  if (seg[1] === "outbound") {
    if (!seg[2]) {
      need(c, "ship.edit");
      if (!body.lines?.length) fail(400, "Pick what goes in this shipment.");
      let customer = String(body.customer ?? "").trim();
      let lines: any[] = body.lines;
      if (body.source === "parts_order") {
        const o = d.orders.find((x) => x.id === body.po_order_id) ?? fail(400, "Pick the parts order to ship.");
        customer = o.customer;
        const open = linesOf(o.id);
        lines = body.lines.map((r: any) => {
          const l = open.find((x) => x.id === r.po_line_id) ?? fail(400, "One of the lines isn't on this order.");
          if (r.qty > toAllocate(l)) fail(400, `Line ${l.line_no}: only ${toAllocate(l)} left to ship.`);
          return { po_line_id: l.id, part_code: l.part_code, description: l.description, qty: r.qty };
        });
      } else if (body.source === "change_part") {
        customer = c.cpOrders.find((x) => x.id === body.cp_order_id)?.customer ?? fail(400, "Pick the change-part order to ship.");
      } else if (!customer) fail(400, "Say who it's going to.");
      const row = { id: c.newId(), number: d.num("OUT"), source: body.source, po_order_id: body.po_order_id || null, cp_order_id: body.cp_order_id || null, customer, ship_to: body.ship_to || null, carrier_id: body.carrier_id || null, service: body.service || null, tracking: null, boxes: null, weight_lb: null, ship_date: body.ship_date || null, status: "to_pick", notes: null, delivered_at: null, revision: 1, created_at: now(), updated_at: now() };
      d.outbound.push(row);
      for (const l of lines) d.outLines.push({ id: c.newId(), outbound_id: row.id, po_line_id: l.po_line_id ?? null, part_code: l.part_code || null, description: l.description || null, qty: Number(l.qty) });
      log(c, "outbound", row.id, "outbound.create");
      if (row.po_order_id) log(c, "parts_order", row.po_order_id, "po.shipment", { number: row.number, lines: lines.map((l) => `${l.part_code ?? l.description} × ${l.qty}`) });
      return { id: row.id, number: row.number };
    }
    const o = d.outbound.find((x) => x.id === seg[2]) ?? fail(404, "Not found.");
    if (method === "GET") {
      const po = d.orders.find((x) => x.id === o.po_order_id) ?? null;
      const shipped = (SHIPPED as readonly string[]).includes(o.status);
      return {
        outbound: { ...outSum(o), hint: trackingHint(o.carrier_id, o.tracking), moves: OUT_MOVES[o.status as OutStatus] },
        lines: d.outLines.filter((l) => l.outbound_id === o.id).map((l) => {
          const pl = l.po_line_id ? d.lines.find((x) => x.id === l.po_line_id) : null;
          const st = pl ? lineState(pl.id) : null;
          return { ...l, line_no: pl?.line_no ?? null, ordered: pl?.qty ?? null, owed: pl && st ? Math.max(0, pl.qty - st.shipped - (shipped ? 0 : l.qty)) : null };
        }),
        order: po, changePart: c.cpOrders.find((x) => x.id === o.cp_order_id) ?? null, files: d.shFiles.filter((f) => f.owner_id === o.id), history: history("outbound", o.id),
      };
    }
    need(c, "ship.edit");
    if (seg[3] === "files") { const added = storeFiles(c, body, { owner_id: o.id, issue_id: null }); d.shFiles.unshift(...added); log(c, "outbound", o.id, "outbound.file.add", { names: added.map((f) => f.name) }); return { ids: added.map((f) => f.id) }; }
    if (seg[3] === "status") {
      if (body.revision !== o.revision) fail(409, "Someone else changed this shipment while you were working on it. Reload to see their changes.");
      const to = isOutStatus(body.to) ? body.to : fail(400, "Pick what to change it to.");
      if (!OUT_MOVES[o.status as OutStatus].includes(to)) fail(409, "It can't be changed to that.");
      if (to === "shipped" && o.status !== "delivered") {
        const car = carrierOf(o.carrier_id) ?? fail(400, "Pick the carrier before marking it shipped.");
        if (!o.tracking && !["pickup", "other"].includes(car.mode)) fail(400, "Add the tracking number before marking it shipped.");
        if (!o.ship_date || o.ship_date > today) o.ship_date = today;
      }
      if (to === "delivered") o.delivered_at = now();
      log(c, "outbound", o.id, "outbound.status", { from: o.status, to });
      if (o.po_order_id) log(c, "parts_order", o.po_order_id, "po.shipment.status", { number: o.number, from: o.status, to, tracking: o.tracking });
      o.status = to; o.revision++; o.updated_at = now();
      return { ok: true, revision: o.revision };
    }
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of ["carrier_id", "service", "tracking", "boxes", "weight_lb", "ship_date", "ship_to", "notes"]) {
      if (body[k] === undefined) continue;
      let v = body[k] === "" ? null : body[k];
      if ((k === "boxes" || k === "weight_lb") && v !== null) v = Number(v);
      if ((o[k] ?? null) !== v) { changes[k] = [o[k] ?? null, v]; o[k] = v; }
    }
    o.revision++; o.updated_at = now();
    if (Object.keys(changes).length) log(c, "outbound", o.id, "outbound.update", { changes });
    return { ok: true, revision: o.revision, hint: trackingHint(o.carrier_id, o.tracking) };
  }
  return fail(404, "Not found.");
}

/** For the machine page in the preview. */
export function partsOrdersFor(serial: string, c: Ctx) {
  if (!s) s = seed(c);
  return s.orders.filter((o) => o.machine === serial).map((o) => ({ id: o.id, quote_number: o.quote_number, order_number: o.order_number, status: o.status, customer_po: o.customer_po }));
}

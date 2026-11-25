// DEMO ONLY. Parts orders in the preview, with made-up customers, parts and prices.
// Follows routes/parts-orders.ts closely (same shared rules), without a server.
import { autoStatus, isOpen, isStatus, MONEY_FIELDS, ORDER_FIELDS, progress, stampsFor, totals, type Line, type Status } from "../../../src/shared/parts-orders";

export class PartsOrdersFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (s: number, m: string): never => { throw new PartsOrdersFail(s, m); };

interface Ctx { me: { id: string; name: string }; perms: Set<string>; newId: () => string }
type Row = Record<string, any>;

let orders: Row[] | null = null;
let history: Row[] = [];
const nowIso = () => new Date().toISOString();
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const ITALY = "Ronchi Mario (Italy)";

function line(part_code: string, description: string, qty: number, unit_price: number, unit_cost: number, supplier: string, extra: Partial<Line> = {}): Line {
  return { id: Math.random().toString(36).slice(2), part_code, description, qty, unit_price, unit_cost, supplier, supplier_po: null, eta: null, drop_ship: false, qty_received: 0, qty_shipped: 0, note: null, ...extra };
}

function seed(c: Ctx) {
  let seq = 1040;
  const o = (status: Status, f: Row, lines: Line[], daysAgo: number) => {
    const t = ago(daysAgo);
    const row: Row = { id: c.newId(), seq: ++seq, status, priority: "normal", created_at: t, updated_at: t, revision: 1, removed_at: null, lines, created_by_name: "Andrew Yang", updated_by_name: "Andrew Yang", ...f };
    for (const s of stampsFor(status)) row[s] = ago(Math.max(daysAgo - 2, 0));
    history.push({ order: row.id, at: t, action: "parts_order.create", who: "Andrew Yang", changes: { customer: [null, row.customer], status: [null, status] } });
    return row;
  };
  orders = [
    o("sourcing", { customer: "Example Foods Inc.", contact: "Dana Smith", contact_email: "dana.smith@example.com", contact_phone: "(404) 555-0142", machine: "4222TP", customer_po: "EF-88213", quote_no: "Q-2611-07", salesperson: "Andrew Yang", source: "phone", priority: "machine_down", needed_by: day(3), promised: day(5), ship_method: "UPS next day air", ship_to: "Example Foods Inc.\n1200 Example Pkwy\nAtlanta, GA 30336", discount_pct: 5, freight: 145 },
      [line("R10-2231", "O-ring kit, filling valve", 12, 18.5, 9.1, ITALY, { supplier_po: "RA-PO-2611-14", eta: day(-1) }), line("R44-0910", "Capping clutch assembly", 2, 640, 405, "Our stock", { qty_received: 2 }), line("R31-1177", "Star wheel, 500 ml round", 1, 1280, 790, ITALY, { supplier_po: "RA-PO-2611-14", eta: day(6) })], 6),
    o("quoted", { customer: "Example Pharma Co.", contact: "Lee Park", contact_email: "lpark@example.com", machine: "3069MB", quote_no: "Q-2611-11", quote_valid: day(21), salesperson: "Michele Falsini", source: "email" },
      [line("R22-0045", "Piston seal set", 24, 9.75, 4.2, ITALY), line("R22-0046", "Piston, 250 ml", 2, 310, 190, ITALY)], 4),
    o("inquiry", { customer: "Example Home Care", contact: "Sam Ortiz", contact_email: "sam.ortiz@example.com", machine: "4212MB", source: "parts_site", quote_request_no: "RQ-261124-04821", notes: "Line 3 is running slow. Asked for spares for the next PM." },
      [line("R55-3001", "Trigger sprayer chuck insert", 6, 0, 0, ITALY, { unit_price: null, unit_cost: null }), line("R55-3010", "Chuck spring", 6, 0, 0, ITALY, { unit_price: null, unit_cost: null })], 1),
    o("ready", { customer: "Example Beverage LLC", contact: "Chris Lane", machine: "3535MB", customer_po: "PO-55120", salesperson: "Andrew Yang", source: "phone", promised: day(1) },
      [line("R12-8800", "Guide rail, left", 2, 220, 120, "US supplier", { supplier_po: "BRG-7710", qty_received: 2 }), line("R12-8801", "Guide rail, right", 2, 220, 120, "US supplier", { supplier_po: "BRG-7710", qty_received: 2 })], 12),
    o("shipped", { customer: "Example Foods Inc.", contact: "Dana Smith", machine: "4222TP", customer_po: "EF-87990", salesperson: "Andrew Yang", source: "email", tracking: "1Z999AA10123456784", ship_method: "UPS ground" },
      [line("R10-2231", "O-ring kit, filling valve", 6, 18.5, 9.1, ITALY, { supplier_po: "RA-PO-2610-22", qty_received: 6, qty_shipped: 6 })], 34),
    o("closed", { customer: "Example Pharma Co.", machine: "3069MB", customer_po: "XP-4410", invoice_no: "INV-30188", salesperson: "Michele Falsini", source: "phone" },
      [line("R22-0045", "Piston seal set", 48, 9.75, 4.2, ITALY, { supplier_po: "RA-PO-2609-03", qty_received: 48, qty_shipped: 48 })], 70),
    o("lost", { customer: "Example Snacks", machine: "3811CP", quote_no: "Q-2610-30", salesperson: "Andrew Yang", source: "email", lost_reason: "Lead time from Italy too long" },
      [line("R70-1200", "Conveyor belt, 3 m", 1, 980, 600, ITALY)], 40),
    o("ordered", { customer: "Example Beverage LLC", machine: "3535MB", customer_po: "PO-55188", salesperson: "Andrew Yang", source: "visit", needed_by: day(14) },
      [line("R31-1190", "Star wheel, 1 L square", 1, 1350, 820, ITALY), line("R44-0950", "Cap chuck, 38 mm", 4, 185, 98, ITALY, { drop_ship: true })], 2),
  ];
}

const num = (seq: number) => `P-${seq}`;
const hide = (r: Row, prices: boolean) => {
  if (prices) return r;
  const out = { ...r };
  for (const k of [...MONEY_FIELDS, "unit_price", "unit_cost", "total"]) delete out[k];
  return out;
};
const listRow = (o: Row, prices: boolean) => {
  const p = progress(o.lines);
  const nextEta = o.lines.filter((l: Line) => l.qty_received < l.qty && l.eta).map((l: Line) => l.eta).sort()[0] ?? null;
  const { lines, ...rest } = o;
  return hide({ ...rest, number: num(o.seq), open: isOpen(o.status), lines: p.lines, received: p.received, shipped: p.shipped, next_eta: nextEta, parts_text: lines.map((l: Line) => `${l.part_code} ${l.description}`).join(" "), total: totals(lines, o.discount_pct, o.freight).total }, prices);
};

/** Parts orders for a machine's page. */
export function partsOrdersFor(serial: string, c: Ctx) {
  if (!c.perms.has("partsorders.view")) return undefined;
  if (!orders) seed(c);
  return orders!.filter((o) => !o.removed_at && o.machine === serial).map((o) => ({ id: o.id, number: num(o.seq), customer: o.customer, status: o.status, customer_po: o.customer_po ?? null, updated_at: o.updated_at }));
}

/** One parts order with its lines, for the shipping preview (Ship this order). */
export function demoPartsOrder(id: string, c: Ctx): Row | null {
  if (!orders) seed(c);
  const o = orders!.find((x) => x.id === id && !x.removed_at);
  return o ? { ...o, number: num(o.seq) } : null;
}

export function resetPartsOrders() {
  orders = null;
  history = [];
}

function cleanLines(raw: any[], prices: boolean, old: Line[]): Line[] {
  return raw.map((l, i) => {
    const prev = old.find((x) => x.id === l.id);
    const n = (v: any) => (v === "" || v == null ? null : Number(v));
    const qty = Number(l.qty);
    if (!(qty > 0)) fail(400, `Line ${i + 1}: quantity must be more than 0.`);
    if (!String(l.part_code ?? "").trim() && !String(l.description ?? "").trim()) fail(400, `Line ${i + 1}: give a part number or a description.`);
    return {
      id: prev?.id ?? Math.random().toString(36).slice(2), part_code: String(l.part_code ?? "").trim() || null, description: String(l.description ?? "").trim() || null, qty,
      unit_price: prices ? n(l.unit_price) : prev?.unit_price ?? null, unit_cost: prices ? n(l.unit_cost) : prev?.unit_cost ?? null,
      supplier: l.supplier || null, supplier_po: l.supplier_po || null, eta: l.eta || null, drop_ship: !!l.drop_ship,
      qty_received: Number(l.qty_received) || 0, qty_shipped: Number(l.qty_shipped) || 0, note: l.note || null,
    };
  });
}

export function partsOrdersRoute(method: string, seg: string[], q: URLSearchParams, body: any, c: Ctx): any {
  if (!c.perms.has("partsorders.view")) fail(403, "Your role doesn't allow this.");
  if (!orders) seed(c);
  const all = orders!;
  const prices = c.perms.has("partsorders.prices");
  const live = all.filter((o) => !o.removed_at);
  const need = (p: string) => { if (!c.perms.has(p)) fail(403, "Your role doesn't allow this."); };
  const fields = (b: Row) => {
    const out: Row = {};
    for (const f of ORDER_FIELDS) if (f in b && (prices || !MONEY_FIELDS.has(f))) out[f] = b[f] === "" ? null : MONEY_FIELDS.has(f) && b[f] != null ? Number(b[f]) : b[f];
    if (out.machine) out.machine = String(out.machine).toUpperCase();
    return out;
  };
  const log = (o: Row, action: string, changes: Row) => history.unshift({ order: o.id, at: nowIso(), action, who: c.me.name, changes });

  if (seg.length === 1 && method === "GET") return { orders: live.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((o) => listRow(o, prices)) };
  if (seg[1] === "to-order") {
    const lines = live.filter((o) => o.status === "ordered" || o.status === "sourcing").flatMap((o) => o.lines.filter((l: Line) => !l.supplier_po && !/stock/i.test(l.supplier ?? "")).map((l: Line) => hide({ ...l, drop_ship: l.drop_ship ? 1 : 0, order_id: o.id, number: num(o.seq), customer: o.customer, machine: o.machine, priority: o.priority, needed_by: o.needed_by ?? null, supplier: l.supplier ?? "" }, prices)));
    return { lines: lines.sort((a, b) => a.supplier.localeCompare(b.supplier)) };
  }
  if (seg[1] === "reports") {
    need("partsorders.reports");
    const from = q.get("from") ?? "0000", to = q.get("to") ?? "9999";
    const won = live.filter((o) => o.won_at && !["lost", "cancelled"].includes(o.status) && o.won_at.slice(0, 10) >= from && o.won_at.slice(0, 10) <= to).map((o): Row => ({ ...o, total: totals(o.lines, o.discount_pct, o.freight).total }));
    const group = (key: (o: Row) => string, name: string): Row[] => {
      const m = new Map<string, Row[]>();
      for (const o of won) m.set(key(o), [...(m.get(key(o)) ?? []), o]);
      return [...m.entries()].map(([k, os]) => ({ [name]: k, orders: os.length, total: Math.round(os.reduce((sum, x) => sum + x.total, 0) * 100) / 100 })).sort((a, b) => b.total - a.total);
    };
    const parts = new Map<string, Row>();
    for (const o of won) for (const l of o.lines as Line[]) if (l.part_code) { const p = parts.get(l.part_code) ?? { part_code: l.part_code, description: l.description, qty: 0, orders: 0, total: 0 }; p.qty += l.qty; p.orders++; p.total += l.qty * (l.unit_price ?? 0); parts.set(l.part_code, p); }
    const shipped = won.filter((o) => o.shipped_at);
    const quoted = live.filter((o) => o.quoted_at);
    return {
      from, to,
      byMonth: group((o) => o.won_at.slice(0, 7), "month").sort((a, b) => String(a.month).localeCompare(String(b.month))),
      byCustomer: group((o) => o.customer, "customer"), bySalesperson: group((o) => o.salesperson ?? "", "salesperson"),
      topParts: [...parts.values()].sort((a, b) => b.qty - a.qty),
      turnaround: { shipped: shipped.length, days: shipped.length ? Math.round((shipped.reduce((s, o) => s + (Date.parse(o.shipped_at) - Date.parse(o.won_at)) / 86400000, 0) / shipped.length) * 10) / 10 : null },
      quotes: { quoted: quoted.length, won: quoted.filter((o) => o.won_at && !["lost", "cancelled"].includes(o.status)).length, lost: quoted.filter((o) => o.status === "lost").length },
      open: live.filter((o) => isOpen(o.status)).length,
      late: live.filter((o) => o.promised && o.promised < day(0) && ["inquiry", "quoted", "ordered", "sourcing", "ready"].includes(o.status)).length,
    };
  }
  if (seg[1] === "part") {
    const code = decodeURIComponent(seg[2] ?? "").toUpperCase();
    const rows = live.flatMap((o) => o.lines.filter((l: Line) => (l.part_code ?? "").toUpperCase() === code).map((l: Line) => hide({ id: o.id, number: num(o.seq), customer: o.customer, machine: o.machine ?? null, status: o.status, qty: l.qty, unit_price: l.unit_price, updated_at: o.updated_at }, prices)));
    return { orders: rows };
  }
  if (seg[1] === "from-quote") fail(400, "Making a parts order from a quote request isn't part of the preview. Use New order instead.");
  if (seg.length === 1 && method === "POST") {
    need("partsorders.add");
    const f = fields(body);
    if (!f.customer) fail(400, "Customer is required.");
    const lines = cleanLines(body.lines ?? [], prices, []);
    const status = (isStatus(body.status) ? body.status : "inquiry") as Status;
    const st = autoStatus(status, lines) ?? status;
    const o: Row = { id: c.newId(), seq: Math.max(1000, ...all.map((x) => x.seq)) + 1, priority: "normal", ...f, status: st, lines, revision: 1, created_at: nowIso(), updated_at: nowIso(), created_by_name: c.me.name, updated_by_name: c.me.name };
    for (const s of stampsFor(st)) o[s] = nowIso();
    all.push(o);
    log(o, "parts_order.create", { customer: [null, o.customer], status: [null, st] });
    return { id: o.id, number: num(o.seq) };
  }
  const o = live.find((x) => x.id === seg[1]);
  if (!o) fail(404, "Not found.");
  if (seg[2] === "copy") {
    need("partsorders.add");
    return partsOrdersRoute("POST", ["parts-orders"], q, { ...o, status: "inquiry", customer_po: null, invoice_no: null, tracking: null, lines: o!.lines.map((l: Line) => ({ ...l, id: undefined, supplier_po: null, eta: null, qty_received: 0, qty_shipped: 0 })) }, { ...c, perms: new Set([...c.perms, "partsorders.prices"]) });
  }
  if (method === "DELETE") {
    need("partsorders.remove");
    o!.removed_at = nowIso();
    return { ok: true };
  }
  if (method === "PATCH") {
    need("partsorders.edit");
    if (body.revision !== o!.revision) fail(409, "Someone else changed this order while you were editing. Reload to see their changes.");
    const f = fields(body);
    const changes: Row = {};
    for (const [k, v] of Object.entries(f)) if ((o![k] ?? null) !== (v ?? null)) { if (!MONEY_FIELDS.has(k as never)) changes[k] = [o![k] ?? null, v]; o![k] = v; }
    if (body.lines) { o!.lines = cleanLines(body.lines, prices, o!.lines); changes.lines = ["…", o!.lines.map((l: Line) => `${l.part_code ?? l.description} x${l.qty}`).join(", ")]; }
    let st = (isStatus(body.status) ? body.status : o!.status) as Status;
    st = autoStatus(st, o!.lines) ?? st;
    if (st !== o!.status) { changes.status = [o!.status, st]; o!.status = st; for (const s of stampsFor(st)) o![s] ??= nowIso(); }
    o!.revision++;
    o!.updated_at = nowIso();
    o!.updated_by_name = c.me.name;
    if (Object.keys(changes).length) log(o!, "parts_order.update", changes);
    return { ok: true, revision: o!.revision };
  }
  const { lines, ...rest } = o!;
  return {
    order: hide({ ...rest, number: num(o!.seq), open: isOpen(o!.status), machine_id: null, progress: progress(lines) }, prices),
    lines: lines.map((l: Line) => hide({ ...l }, prices)),
    totals: prices ? totals(lines, o!.discount_pct, o!.freight) : null,
    history: history.filter((h) => h.order === o!.id),
    shipments: [],
  };
}

// Parts orders: spare parts sales from the customer's first ask to the invoice (src/shared/parts-orders.ts
// has the fields and steps). Modeled on the order screens of the parts and order tools rated best by
// their users (see the research note in project files, "Parts order sales tracking software.md").
//
// Who: partsorders.view to see, .add/.edit/.remove to change, .prices to see or set any money, and
// .reports for the sales reports. Prices are never sent to someone without .prices, and their saves
// keep the prices already there. Every change goes to the audit log (never with prices in it) and shows
// as the order's history. A save sends the revision it started from; a stale one is refused.
//
// Shipping and receiving (routes in the Shipping work, tables shipments + shipment_lines) records what
// actually shipped and arrived against each line. This file only reads those tables, and only when they
// exist, so either piece of work can go live first.
import { Hono, type Context } from "hono";
import { randomId } from "../../shared/crypto";
import {
  DATE_FIELDS, DAY, DONE, isOpen, isStatus, LINE_MONEY, MAX_LINES, MONEY_FIELDS, ORDER_FIELDS, ORDER_LABELS, ORDER_MAX,
  PRIORITIES, QUOTING, WON, autoStatus, isStock, progress, SOURCES, stampsFor, totals, type Line, type OrderField, type Status,
} from "../../shared/parts-orders";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm } from "../lib/http";
import { partsCall } from "../lib/parts-site";
import { loadSettings } from "../lib/settings-store";

export const partsOrders = new Hono<AppEnv>();

type Row = Record<string, any>;
type Ctx = Context<AppEnv>;
const number = (seq: number) => `P-${seq}`;
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Checking what people type ----------

function num(v: unknown, what: string, opts: { min?: number; max?: number; positive?: boolean } = {}): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  if (!Number.isFinite(n)) fail(400, `${what} must be a number.`);
  if (opts.positive && n <= 0) fail(400, `${what} must be more than 0.`);
  if (n < (opts.min ?? 0)) fail(400, `${what} can't be less than ${opts.min ?? 0}.`);
  if (opts.max !== undefined && n > opts.max) fail(400, `${what} can't be more than ${opts.max}.`);
  return Math.round(n * 10000) / 10000;
}

function text(v: unknown, max: number, what: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") fail(400, `${what} must be text.`);
  const t = v.trim();
  if (t.length > max) fail(400, `${what} is too long (limit ${max} characters).`);
  return t || null;
}

/** The order fields present in `b`, checked and tidied. Money fields only for people who may see prices. */
function cleanOrder(b: Row, prices: boolean): Partial<Record<OrderField, string | number | null>> {
  const out: Partial<Record<OrderField, string | number | null>> = {};
  for (const f of ORDER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
    if (MONEY_FIELDS.has(f)) {
      if (!prices) continue;
      out[f] = f === "discount_pct" ? num(b[f], ORDER_LABELS[f], { max: 100 }) : num(b[f], ORDER_LABELS[f], { max: 10_000_000 });
      continue;
    }
    let v = text(b[f], ORDER_MAX[f], ORDER_LABELS[f]);
    if (v && DATE_FIELDS.has(f) && !DAY.test(v)) fail(400, `${ORDER_LABELS[f]} must be a date.`);
    if (v && f === "machine") v = v.toUpperCase();
    if (v && f === "source" && !(SOURCES as readonly string[]).includes(v)) fail(400, "Pick how the order came in.");
    if (f === "priority") {
      v ??= "normal";
      if (!(PRIORITIES as readonly string[]).includes(v)) fail(400, "Pick a priority.");
    }
    out[f] = v;
  }
  if ("customer" in out && !out.customer) fail(400, "Customer is required.");
  return out;
}

/** The order's lines, checked. Without `prices`, each line keeps the prices it already had. */
function cleanLines(raw: unknown, prices: boolean, before: Map<string, Row>): Line[] {
  if (!Array.isArray(raw)) fail(400, "Lines must be a list.");
  if (raw.length > MAX_LINES) fail(400, `An order can have up to ${MAX_LINES} lines.`);
  return raw.map((r, i) => {
    if (!r || typeof r !== "object") fail(400, `Line ${i + 1} is empty.`);
    const l = r as Row;
    const what = (s: string) => `Line ${i + 1}: ${s}`;
    const old = typeof l.id === "string" ? before.get(l.id) : undefined;
    const line: Line = {
      id: old ? (l.id as string) : undefined,
      part_code: text(l.part_code, 60, what("part number")),
      description: text(l.description, 300, what("description")),
      qty: num(l.qty, what("quantity"), { positive: true, max: 1_000_000 }) ?? fail(400, what("quantity is required.")),
      unit_price: prices ? num(l.unit_price, what("price"), { max: 10_000_000 }) : (old?.unit_price ?? null),
      unit_cost: prices ? num(l.unit_cost, what("cost"), { max: 10_000_000 }) : (old?.unit_cost ?? null),
      supplier: text(l.supplier, 120, what("supplier")),
      supplier_po: text(l.supplier_po, 80, what("supplier PO")),
      eta: text(l.eta, 10, what("arrives")),
      drop_ship: l.drop_ship === true || l.drop_ship === 1,
      qty_received: num(l.qty_received, what("received"), { max: 1_000_000 }) ?? 0,
      qty_shipped: num(l.qty_shipped, what("shipped"), { max: 1_000_000 }) ?? 0,
      note: text(l.note, 500, what("note")),
    };
    if (!line.part_code && !line.description) fail(400, what("give a part number or a description."));
    if (line.eta && !DAY.test(line.eta)) fail(400, what("the arrival date must be a date."));
    return line;
  });
}

/** One line of history for the lines, without prices: "R10-2231 x12, R44-0910 x2". */
const linesSummary = (ls: Pick<Line, "part_code" | "description" | "qty" | "qty_received" | "qty_shipped">[]) =>
  ls.map((l) => `${l.part_code ?? l.description} x${l.qty}${l.qty_received ? ` (${l.qty_received} in)` : ""}${l.qty_shipped ? ` (${l.qty_shipped} out)` : ""}`).join(", ").slice(0, 500) || "none";

// ---------- Reading ----------

const LINE_COLS = "id, line_no, part_code, description, qty, unit_price, unit_cost, supplier, supplier_po, eta, drop_ship, qty_received, qty_shipped, note";

/** Do the Shipping tables exist yet? (They come with the Shipping and receiving work.) */
async function shippingReady(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('shipments', 'shipment_lines')").first<{ n: number }>();
  return r?.n === 2;
}

/** What Shipping shipped and received for parts order lines (all of them, or one order's). */
/** The changes written in one history row; an unreadable row shows as no detail instead of breaking the page. */
function readChanges(detail: string | null): Row | null {
  if (!detail) return null;
  try {
    return (JSON.parse(detail) as Row).changes ?? null;
  } catch {
    return null;
  }
}

/** The orders the list shows (bind the machine twice, '' for all): newest 3000. */
const LISTED = "SELECT id FROM parts_orders WHERE removed_at IS NULL AND (? = '' OR machine = ?) ORDER BY updated_at DESC LIMIT 3000";

async function shippedFromShipping(db: D1Database, orderId?: string, machine?: string): Promise<Map<string, { shipped: number; received: number }>> {
  const out = new Map<string, { shipped: number; received: number }>();
  if (!(await shippingReady(db))) return out;
  const { results } = await db.prepare(
    `SELECT l.source_id AS line_id,
            SUM(CASE WHEN s.direction = 'out' AND s.status IN ('shipped','delivered') THEN l.qty ELSE 0 END) AS shipped,
            SUM(CASE WHEN s.direction = 'in' AND s.status != 'cancelled' THEN COALESCE(l.qty_received, 0) ELSE 0 END) AS received
       FROM shipment_lines l JOIN shipments s ON s.id = l.shipment_id
      WHERE l.source_type = 'parts_order_line' AND s.removed_at IS NULL
        ${orderId
          ? "AND l.source_id IN (SELECT id FROM parts_order_lines WHERE order_id = ?)"
          : `AND l.source_id IN (SELECT id FROM parts_order_lines WHERE order_id IN (${LISTED}))`}
      GROUP BY l.source_id`,
  ).bind(...(orderId ? [orderId] : [machine ?? "", machine ?? ""])).all<{ line_id: string; shipped: number; received: number }>();
  for (const r of results) out.set(r.line_id, { shipped: r.shipped ?? 0, received: r.received ?? 0 });
  return out;
}

/** A line as people see it: what was typed by hand or what Shipping recorded, whichever is more. */
function merged(l: Row, ship: Map<string, { shipped: number; received: number }>): Row {
  const s = ship.get(l.id);
  return s ? { ...l, qty_received: Math.max(l.qty_received, s.received), qty_shipped: Math.max(l.qty_shipped, s.shipped) } : l;
}

/** The parts orders a shipment carries lines for, as it is now. */
export async function partsOrdersOnShipment(db: D1Database, shipmentId: string): Promise<string[]> {
  if (!(await shippingReady(db))) return [];
  const { results } = await db.prepare(
    `SELECT DISTINCT p.order_id FROM shipment_lines l JOIN parts_order_lines p ON p.id = l.source_id WHERE l.shipment_id = ? AND l.source_type = 'parts_order_line'`,
  ).bind(shipmentId).all<{ order_id: string }>();
  return results.map((r) => r.order_id);
}

/**
 * After Shipping saves a shipment: move each parts order it carries parts for forward, the same way a
 * save on the order would (autoStatus: only forward, only from Customer PO received onward). Written to
 * the order's history as done by that shipment. Shipping calls this; nothing here changes a shipment.
 */
export async function syncPartsOrdersForShipment(db: D1Database, shipmentId: string, userId: string, ip: string, alsoOrders: string[] = []): Promise<void> {
  if (!(await shippingReady(db))) return;
  if ((await loadSettings(db)).sections.partsOrders === false) return; // section switched off: leave orders alone
  const s = await db.prepare("SELECT number FROM shipments WHERE id = ?").bind(shipmentId).first<{ number: string }>();
  // alsoOrders: orders the shipment carried before this save, whose lines may have been cut from it.
  for (const order_id of new Set([...(await partsOrdersOnShipment(db, shipmentId)), ...alsoOrders])) {
    const o = await db.prepare("SELECT * FROM parts_orders WHERE id = ? AND removed_at IS NULL").bind(order_id).first<Row>();
    if (!o) continue;
    const ship = await shippedFromShipping(db, order_id);
    const ls = (await db.prepare(`SELECT ${LINE_COLS} FROM parts_order_lines WHERE order_id = ?`).bind(order_id).all<Row>()).results;
    const mine = ls.map((l) => merged({ ...l, drop_ship: !!l.drop_ship }, ship) as Line);
    let next = autoStatus(o.status as Status, mine);
    // Shipped, but a shipment was cancelled, cut or removed so not everything has gone any more: step back
    // to where the lines say the order is, so it shows up again as still to ship.
    if (!next && o.status === "shipped" && mine.length && !mine.every((l) => l.qty_shipped >= l.qty)) {
      next = autoStatus("ordered", mine) ?? "ordered";
    }
    if (!next) continue;
    const t = now();
    const set: Row = { status: next };
    if (o.status === "shipped") set.shipped_at = null;
    for (const stamp of stampsFor(next)) if (!o[stamp]) set[stamp] = t;
    const keys = Object.keys(set);
    const r = await db.prepare(`UPDATE parts_orders SET ${keys.map((k) => `${k} = ?, `).join("")}revision = revision + 1, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
      .bind(...keys.map((k) => set[k]), userId, t, order_id, o.revision).run();
    if (!r.meta.changes) continue; // someone saved the order at the same moment; their save runs autoStatus too
    await audit(db, { userId, action: "parts_order.update", targetType: "parts_order", targetId: order_id, detail: { changes: { status: [o.status, next] }, by: `shipment ${s?.number ?? ""}`.trim() }, ip });
  }
}

function hidePrices<T extends Row>(row: T): T {
  const out: Row = { ...row };
  for (const k of [...MONEY_FIELDS, ...LINE_MONEY, "total", "parts"]) delete out[k];
  return out as T;
}

partsOrders.get("/", async (c) => {
  const u = requirePerm(c, "partsorders.view");
  const prices = has(u, "partsorders.prices");
  const machine = (c.req.query("machine") ?? "").trim().toUpperCase().slice(0, 60);
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.seq, o.customer, o.contact, o.machine, o.status, o.priority, o.salesperson, o.customer_po, o.quote_no, o.quote_valid, o.invoice_no,
            o.needed_by, o.promised, o.discount_pct, o.freight, o.won_at, o.created_at, o.updated_at,
            (SELECT MIN(l.eta) FROM parts_order_lines l WHERE l.order_id = o.id AND l.qty_received < l.qty AND l.eta IS NOT NULL) AS next_eta
       FROM parts_orders o
      WHERE o.removed_at IS NULL AND (? = '' OR o.machine = ?)
      ORDER BY o.updated_at DESC LIMIT 3000`,
  ).bind(machine, machine).all<Row>();
  // All lines in one read, then grouped here (cheaper than one sub-query per order).
  const lines = (await c.env.DB.prepare(
    `SELECT l.id, l.order_id, l.part_code, l.description, l.qty, l.unit_price, l.supplier, l.qty_received, l.qty_shipped
       FROM parts_order_lines l
      WHERE l.order_id IN (${LISTED})`,
  ).bind(machine, machine).all<Row>()).results;
  const ship = await shippedFromShipping(c.env.DB, undefined, machine);
  const byOrder = new Map<string, Row[]>();
  for (const l of lines) {
    const list = byOrder.get(l.order_id);
    if (list) list.push(merged(l, ship));
    else byOrder.set(l.order_id, [merged(l, ship)]);
  }
  const orders = results.map((o) => {
    const ls = byOrder.get(o.id) ?? [];
    const p = progress(ls as Line[]);
    const row = {
      ...o, number: number(o.seq), open: isOpen(o.status), lines: p.lines, received: p.received, shipped: p.shipped,
      parts_text: ls.map((l) => `${l.part_code ?? ""} ${l.description ?? ""}`).join(" ").slice(0, 2000),
      total: totals(ls as Line[], o.discount_pct, o.freight).total,
    };
    return prices ? row : hidePrices(row);
  });
  return c.json({ orders });
});

/** Sales reports. Booked sales count from the day the customer said yes (won), lost and cancelled left out. */
partsOrders.get("/reports", async (c) => {
  requirePerm(c, "partsorders.reports");
  requirePerm(c, "partsorders.prices"); // every report is in dollars
  const from = DAY.test(c.req.query("from") ?? "") ? c.req.query("from")! : new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const to = DAY.test(c.req.query("to") ?? "") ? c.req.query("to")! : "9999-12-31";
  const db = c.env.DB;
  const won = `WITH won AS (
      SELECT o.id, o.customer, o.salesperson, o.won_at, o.shipped_at,
             ROUND(COALESCE((SELECT SUM(l.qty * COALESCE(l.unit_price, 0)) FROM parts_order_lines l WHERE l.order_id = o.id), 0)
                   * (1 - COALESCE(o.discount_pct, 0) / 100.0) + COALESCE(o.freight, 0), 2) AS total
        FROM parts_orders o
       WHERE o.removed_at IS NULL AND o.won_at IS NOT NULL AND o.status NOT IN ('lost', 'cancelled')
         AND substr(o.won_at, 1, 10) >= ? AND substr(o.won_at, 1, 10) <= ?)`;
  const [byMonth, byCustomer, bySalesperson, topParts, speed, quotes, open] = await db.batch([
    db.prepare(`${won} SELECT substr(won_at, 1, 7) AS month, COUNT(*) AS orders, ROUND(SUM(total), 2) AS total FROM won GROUP BY month ORDER BY month`).bind(from, to),
    db.prepare(`${won} SELECT customer, COUNT(*) AS orders, ROUND(SUM(total), 2) AS total FROM won GROUP BY customer ORDER BY SUM(total) DESC LIMIT 25`).bind(from, to),
    db.prepare(`${won} SELECT COALESCE(salesperson, '') AS salesperson, COUNT(*) AS orders, ROUND(SUM(total), 2) AS total FROM won GROUP BY COALESCE(salesperson, '') ORDER BY SUM(total) DESC`).bind(from, to),
    db.prepare(`${won} SELECT l.part_code, MAX(l.description) AS description, SUM(l.qty) AS qty, COUNT(DISTINCT l.order_id) AS orders, ROUND(SUM(l.qty * COALESCE(l.unit_price, 0)), 2) AS total
                 FROM parts_order_lines l JOIN won ON won.id = l.order_id WHERE l.part_code IS NOT NULL GROUP BY l.part_code ORDER BY SUM(l.qty) DESC LIMIT 25`).bind(from, to),
    db.prepare(`${won} SELECT COUNT(*) AS shipped, ROUND(AVG(julianday(shipped_at) - julianday(won_at)), 1) AS days FROM won WHERE shipped_at IS NOT NULL`).bind(from, to),
    db.prepare(`SELECT COUNT(*) AS quoted, SUM(won_at IS NOT NULL AND status NOT IN ('lost','cancelled')) AS won, SUM(status = 'lost') AS lost
                  FROM parts_orders WHERE removed_at IS NULL AND quoted_at IS NOT NULL AND substr(quoted_at, 1, 10) >= ? AND substr(quoted_at, 1, 10) <= ?`).bind(from, to),
    db.prepare(`SELECT COUNT(*) AS open, SUM(promised IS NOT NULL AND promised < ? AND status IN ('inquiry','quoted','ordered','sourcing','ready')) AS late
                  FROM parts_orders WHERE removed_at IS NULL AND status NOT IN (${[...DONE].map(() => "?").join(",")})`).bind(today(), ...DONE),
  ]);
  const one = (r: D1Result) => (r.results[0] ?? {}) as Row;
  return c.json({
    from, to,
    byMonth: byMonth!.results, byCustomer: byCustomer!.results, bySalesperson: bySalesperson!.results, topParts: topParts!.results,
    turnaround: { shipped: one(speed!).shipped ?? 0, days: one(speed!).days ?? null },
    quotes: { quoted: one(quotes!).quoted ?? 0, won: one(quotes!).won ?? 0, lost: one(quotes!).lost ?? 0 },
    open: one(open!).open ?? 0, late: one(open!).late ?? 0,
  });
});

/**
 * Parts still to order: lines on orders the customer has said yes to that have no supplier PO yet
 * (stock lines left out), by supplier, so one PO per supplier can go out (for example the weekly order to Italy).
 */
partsOrders.get("/to-order", async (c) => {
  const u = requirePerm(c, "partsorders.view");
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.order_id, 'P-' || o.seq AS number, o.customer, o.machine, o.priority, o.needed_by, l.part_code, l.description, l.qty, l.unit_cost,
            COALESCE(l.supplier, '') AS supplier, l.drop_ship
       FROM parts_order_lines l JOIN parts_orders o ON o.id = l.order_id
      WHERE o.removed_at IS NULL AND o.status IN ('ordered', 'sourcing') AND (l.supplier_po IS NULL OR l.supplier_po = '')
      ORDER BY COALESCE(l.supplier, '') = '', COALESCE(l.supplier, ''), o.priority = 'normal', o.seq, l.line_no LIMIT 2000`,
  ).all<Row>();
  const lines = results.filter((l) => !isStock(l as { supplier: string | null }));
  return c.json({ lines: has(u, "partsorders.prices") ? lines : lines.map(hidePrices) });
});

/** Which orders already hold one of these parts: the "sold before" list on a part. */
partsOrders.get("/part/:code", async (c) => {
  const u = requirePerm(c, "partsorders.view");
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.seq, o.customer, o.machine, o.status, o.won_at, o.created_at, l.qty, l.unit_price
       FROM parts_order_lines l JOIN parts_orders o ON o.id = l.order_id
      WHERE l.part_code = ? AND o.removed_at IS NULL ORDER BY o.created_at DESC LIMIT 50`,
  ).bind(c.req.param("code").slice(0, 60)).all<Row>();
  const prices = has(u, "partsorders.prices");
  return c.json({ orders: results.map((o) => (prices ? { ...o, number: number(o.seq) } : hidePrices({ ...o, number: number(o.seq) }))) });
});

partsOrders.get("/:id", async (c) => {
  const u = requirePerm(c, "partsorders.view");
  const prices = has(u, "partsorders.prices");
  const id = c.req.param("id");
  const o = await c.env.DB.prepare(
    `SELECT o.*, m.id AS machine_id, cu.name AS created_by_name, uu.name AS updated_by_name
       FROM parts_orders o LEFT JOIN machines m ON m.serial = o.machine
       LEFT JOIN users cu ON cu.id = o.created_by LEFT JOIN users uu ON uu.id = o.updated_by
      WHERE o.id = ? AND o.removed_at IS NULL`,
  ).bind(id).first<Row>();
  if (!o) fail(404, "Not found.");
  const ship = await shippedFromShipping(c.env.DB, id);
  const lines = (await c.env.DB.prepare(`SELECT ${LINE_COLS} FROM parts_order_lines WHERE order_id = ? ORDER BY line_no`).bind(id).all<Row>()).results.map((l) => merged({ ...l, drop_ship: !!l.drop_ship }, ship));
  const { results } = await c.env.DB.prepare(
    `SELECT a.at, a.action, a.detail, u.name AS who FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.target_type = 'parts_order' AND a.target_id = ? ORDER BY a.at DESC LIMIT 200`,
  ).bind(id).all<{ at: string; action: string; detail: string | null; who: string | null }>();
  const history = results.map((h) => ({ at: h.at, action: h.action, who: h.who, changes: readChanges(h.detail) }));
  // Only for people who may see Shipping (taken away too when Shipping is switched off).
  const shipments = has(u, "shipping.view") && (await shippingReady(c.env.DB))
    ? (await c.env.DB.prepare(
        `SELECT s.* FROM shipments s WHERE s.removed_at IS NULL AND (
            (s.source_type = 'parts_order' AND s.source_id = ?)
            OR s.id IN (SELECT l.shipment_id FROM shipment_lines l WHERE l.source_type = 'parts_order_line' AND l.source_id IN (SELECT id FROM parts_order_lines WHERE order_id = ?)))
          LIMIT 50`,
      ).bind(id, id).all<Row>()).results.map((s) => ({ id: s.id, number: s.number, direction: s.direction, status: s.status, carrier: s.carrier ?? null, carrier_other: s.carrier_other ?? null, tracking: s.tracking ?? null, ship_date: s.shipped_date ?? null }))
    : [];
  const order = { ...o, number: number(o.seq), open: isOpen(o.status), progress: progress(lines as Line[]) };
  return c.json({
    order: prices ? order : hidePrices(order),
    lines: prices ? lines : lines.map(hidePrices),
    totals: prices ? totals(lines as Line[], o.discount_pct, o.freight) : null,
    history,
    shipments,
  });
});

// ---------- Writing ----------

/** Insert a new order with the next number (P-1001, P-1002, ...) and its lines, all at once. */
async function insertOrder(c: Ctx, userId: string, f: Row, status: Status, lines: Line[], extra: Row = {}): Promise<{ id: string; seq: number }> {
  const id = randomId();
  const t = now();
  const stamps = Object.fromEntries(stampsFor(status).map((s) => [s, t]));
  const row: Row = { ...f, ...extra, ...stamps, status, priority: f.priority ?? "normal" };
  const keys = Object.keys(row);
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = await c.env.DB.prepare("SELECT COALESCE(MAX(seq), 1000) + 1 AS n FROM parts_orders").first<{ n: number }>();
    const seq = next!.n;
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO parts_orders (id, seq, ${keys.join(", ")}, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ${keys.map(() => "?").join(", ")}, ?, ?, ?, ?)`)
          .bind(id, seq, ...keys.map((k) => row[k] ?? null), userId, userId, t, t),
        ...lineInserts(c.env.DB, id, lines),
      ]);
      return { id, seq };
    } catch (e) {
      if (!/UNIQUE/i.test(String(e)) || /quote_request_id/.test(String(e))) throw e; // someone took the number: try the next one
    }
  }
  fail(409, "Couldn't number the order. Try again.");
}

/**
 * Inserts for an order's lines. With `onlyIf`, each insert runs only if the order now has exactly that
 * revision and save time, i.e. only if this same batch's order update went through.
 */
function lineInserts(db: D1Database, orderId: string, lines: Line[], onlyIf?: { rev: number; at: string }) {
  const guard = onlyIf === undefined ? "" : " WHERE (SELECT revision || '|' || updated_at FROM parts_orders WHERE id = ?) = ?";
  return lines.map((l, i) =>
    db.prepare(
      `INSERT INTO parts_order_lines (id, order_id, line_no, part_code, description, qty, unit_price, unit_cost, supplier, supplier_po, eta, drop_ship, qty_received, qty_shipped, note)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${guard}`,
    ).bind(l.id ?? randomId(), orderId, i + 1, l.part_code, l.description, l.qty, l.unit_price, l.unit_cost, l.supplier, l.supplier_po, l.eta, l.drop_ship ? 1 : 0, l.qty_received, l.qty_shipped, l.note,
      ...(onlyIf === undefined ? [] : [orderId, `${onlyIf.rev}|${onlyIf.at}`])),
  );
}

function statusOf(v: unknown): Status {
  if (!isStatus(v)) fail(400, "Pick a status.");
  return v;
}

partsOrders.post("/", async (c) => {
  const u = requirePerm(c, "partsorders.add");
  const b = await body(c);
  const prices = has(u, "partsorders.prices");
  const f = cleanOrder(b, prices);
  if (!f.customer) fail(400, "Customer is required.");
  const status = b.status === undefined ? "inquiry" : statusOf(b.status);
  const lines = b.lines === undefined ? [] : cleanLines(b.lines, prices, new Map());
  const { id, seq } = await insertOrder(c, u.id, f, autoStatus(status, lines) ?? status, lines);
  const changes = Object.fromEntries(Object.entries(f).filter(([k, v]) => v != null && !MONEY_FIELDS.has(k as OrderField)).map(([k, v]) => [k, [null, v]]));
  await audit(c.env.DB, { userId: u.id, action: "parts_order.create", targetType: "parts_order", targetId: id, detail: { changes: { ...changes, status: [null, status], ...(lines.length ? { lines: ["none", linesSummary(lines)] } : {}) } }, ip: c.get("ip") });
  return c.json({ id, number: number(seq) });
});

partsOrders.patch("/:id", async (c) => {
  const u = requirePerm(c, "partsorders.edit");
  const prices = has(u, "partsorders.prices");
  const id = c.req.param("id");
  const b = await body(c);
  const before = await c.env.DB.prepare("SELECT * FROM parts_orders WHERE id = ? AND removed_at IS NULL").bind(id).first<Row>();
  if (!before) fail(404, "Not found.");
  const stale = () => fail(409, "Someone else changed this order while you were editing. Reload to see their changes.");
  if (typeof b.revision !== "number" || b.revision !== before.revision) stale();
  const f = cleanOrder(b, prices);
  const diff: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(f)) if ((before[k] ?? null) !== (v ?? null) && !MONEY_FIELDS.has(k as OrderField)) diff[k] = [before[k] ?? null, v ?? null];
  // Money stays out of the history, but the history still says it changed.
  if (Object.entries(f).some(([k, v]) => MONEY_FIELDS.has(k as OrderField) && (before[k] ?? null) !== (v ?? null))) diff.prices = [null, "changed"];
  const set: Row = Object.fromEntries(Object.entries(f).filter(([k, v]) => (before[k] ?? null) !== (v ?? null)));
  const t = now();
  if (b.status !== undefined) {
    const s = statusOf(b.status);
    if (s !== before.status) {
      // Like the order tools in the research: a quote becomes an order only with the customer's PO.
      if (QUOTING.has(before.status) && WON.has(s) && !(("customer_po" in f ? f.customer_po : before.customer_po))) fail(400, "Type the customer's PO number first.");
      set.status = s;
      diff.status = [before.status, s];
      for (const stamp of stampsFor(s)) if (!before[stamp]) set[stamp] = t;
    }
  }
  let lines: Line[] | null = null;
  if (b.lines !== undefined) {
    const old = (await c.env.DB.prepare(`SELECT ${LINE_COLS} FROM parts_order_lines WHERE order_id = ? ORDER BY line_no`).bind(id).all<Row>()).results;
    lines = cleanLines(b.lines, prices, new Map(old.map((l) => [l.id, l])));
    // The page shows the larger of what was typed and what Shipping recorded. When that shown number comes
    // back unchanged, keep what was typed, so Shipping's counts never get copied into the typed ones (a
    // cancelled shipment would otherwise leave its parts counted for good).
    const shipNow = await shippedFromShipping(c.env.DB, id);
    const oldById = new Map(old.map((l) => [l.id as string, l]));
    for (const l of lines) {
      const o = l.id ? oldById.get(l.id) : undefined;
      const s = l.id ? shipNow.get(l.id) : undefined;
      if (!o || !s) continue;
      if (s.received > o.qty_received && l.qty_received === Math.max(o.qty_received, s.received)) l.qty_received = o.qty_received;
      if (s.shipped > o.qty_shipped && l.qty_shipped === Math.max(o.qty_shipped, s.shipped)) l.qty_shipped = o.qty_shipped;
    }
    const was = linesSummary(old as Line[]), is = linesSummary(lines);
    const moneyChanged = prices && JSON.stringify(old.map((l) => [l.unit_price, l.unit_cost])) !== JSON.stringify(lines.map((l) => [l.unit_price, l.unit_cost]));
    const sameLines = JSON.stringify(old.map((l) => [l.id, l.part_code, l.description, l.qty, l.supplier, l.supplier_po, l.eta, !!l.drop_ship, l.qty_received, l.qty_shipped, l.note]))
      === JSON.stringify(lines.map((l) => [l.id ?? null, l.part_code, l.description, l.qty, l.supplier, l.supplier_po, l.eta, l.drop_ship, l.qty_received, l.qty_shipped, l.note]));
    if (sameLines && !moneyChanged) lines = null;
    else diff.lines = [was, is === was ? `${is} (prices or details changed)` : is];
  }
  // Move the status on by itself when the lines say so (only forward; see autoStatus).
  if (lines || set.status) {
    const ship = await shippedFromShipping(c.env.DB, id);
    const current = (set.status ?? before.status) as Status;
    const ls = lines ?? (await c.env.DB.prepare(`SELECT ${LINE_COLS} FROM parts_order_lines WHERE order_id = ?`).bind(id).all<Row>()).results.map((l) => ({ ...l, drop_ship: !!l.drop_ship }) as Line);
    const next = autoStatus(current, ls.map((l) => merged(l as Row, ship) as Line));
    if (next) {
      set.status = next;
      diff.status = [before.status, next];
      for (const stamp of stampsFor(next)) if (!before[stamp]) set[stamp] = t;
    }
  }
  const keys = Object.keys(set);
  if (!keys.length && !lines) return c.json({ ok: true, revision: before.revision });
  const rev = (before.revision as number) + 1;
  const res = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE parts_orders SET ${keys.map((k) => `${k} = ?, `).join("")}revision = ?, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?`)
      .bind(...keys.map((k) => set[k] ?? null), rev, u.id, t, id, before.revision),
    ...(lines
      ? [c.env.DB.prepare("DELETE FROM parts_order_lines WHERE order_id = ? AND (SELECT revision || '|' || updated_at FROM parts_orders WHERE id = ?) = ?").bind(id, id, `${rev}|${t}`), ...lineInserts(c.env.DB, id, lines, { rev, at: t })]
      : []),
  ]);
  if (!res[0]!.meta.changes) stale();
  await audit(c.env.DB, { userId: u.id, action: "parts_order.update", targetType: "parts_order", targetId: id, detail: { changes: diff }, ip: c.get("ip") });
  return c.json({ ok: true, revision: rev });
});

partsOrders.delete("/:id", async (c) => {
  const u = requirePerm(c, "partsorders.remove");
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("UPDATE parts_orders SET removed_at = ?, updated_by = ?, quote_request_id = NULL WHERE id = ? AND removed_at IS NULL").bind(now(), u.id, id).run();
  if (!r.meta.changes) fail(404, "Not found.");
  await audit(c.env.DB, { userId: u.id, action: "parts_order.remove", targetType: "parts_order", targetId: id, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Order again: a new inquiry for the same customer with the same parts, quantities and prices. */
partsOrders.post("/:id/copy", async (c) => {
  const u = requirePerm(c, "partsorders.add");
  const id = c.req.param("id");
  const o = await c.env.DB.prepare("SELECT * FROM parts_orders WHERE id = ? AND removed_at IS NULL").bind(id).first<Row>();
  if (!o) fail(404, "Not found.");
  const old = (await c.env.DB.prepare(`SELECT ${LINE_COLS} FROM parts_order_lines WHERE order_id = ? ORDER BY line_no`).bind(id).all<Row>()).results;
  const keep = ["customer", "contact", "contact_email", "contact_phone", "machine", "ship_to", "salesperson", "ship_method", "discount_pct"] as const;
  const f = Object.fromEntries(keep.map((k) => [k, o[k] ?? null]));
  const lines: Line[] = old.map((l) => ({ ...(l as Line), id: undefined, drop_ship: !!l.drop_ship, supplier_po: null, eta: null, qty_received: 0, qty_shipped: 0 }));
  const made = await insertOrder(c, u.id, f, "inquiry", lines);
  await audit(c.env.DB, { userId: u.id, action: "parts_order.create", targetType: "parts_order", targetId: made.id, detail: { changes: { copied_from: [null, number(o.seq)], lines: ["none", linesSummary(lines)] } }, ip: c.get("ip") });
  return c.json({ id: made.id, number: number(made.seq) });
});

/** Turn a customer's quote request from the parts site into a parts order (once; a second try opens the first). */
partsOrders.post("/from-quote/:quoteId", async (c) => {
  const u = requirePerm(c, "partsorders.add");
  requirePerm(c, "quotes.manage");
  const qid = c.req.param("quoteId").slice(0, 64);
  const had = await c.env.DB.prepare("SELECT id, seq FROM parts_orders WHERE quote_request_id = ? AND removed_at IS NULL").bind(qid).first<{ id: string; seq: number }>();
  if (had) return c.json({ id: had.id, number: number(had.seq), existing: true });
  const { quote, lines: qlines } = await partsCall<{ quote: Row; lines: Row[] }>(c.env, `/quotes/${encodeURIComponent(qid)}`);
  if (qlines.length > MAX_LINES) fail(400, `That request has more than ${MAX_LINES} lines.`);
  const serials = [...new Set(qlines.map((l) => (l.serial ?? "").toUpperCase()).filter(Boolean))];
  const lines: Line[] = qlines.map((l) => ({
    part_code: l.code ?? null,
    description: (l.code ? (l.name_en || l.name_it) : l.description) || null,
    qty: Number(l.qty) || 1,
    unit_price: null, unit_cost: null, supplier: null, supplier_po: null, eta: null, drop_ship: false, qty_received: 0, qty_shipped: 0,
    note: [serials.length > 1 && l.serial ? `For ${l.serial}` : "", l.note ?? ""].filter(Boolean).join(". ") || null,
  }));
  const f = {
    customer: String(quote.company ?? "").slice(0, 200) || "Unknown customer",
    contact: String(quote.sent_by ?? "").slice(0, 120) || null,
    contact_email: String(quote.email ?? "").slice(0, 200) || null,
    machine: serials.length === 1 ? serials[0]!.slice(0, 60) : null,
    source: "parts_site",
    notes: quote.notes ? String(quote.notes).slice(0, 5000) : null,
  };
  let made: { id: string; seq: number };
  try {
    made = await insertOrder(c, u.id, f, "inquiry", lines, { quote_request_id: qid, quote_request_no: String(quote.number ?? "").slice(0, 40) });
  } catch (e) {
    // Two people pressed the button at once: open the order the other one made.
    if (!/quote_request_id/.test(String(e))) throw e;
    const first = await c.env.DB.prepare("SELECT id, seq FROM parts_orders WHERE quote_request_id = ?").bind(qid).first<{ id: string; seq: number }>();
    if (!first) throw e;
    return c.json({ id: first.id, number: number(first.seq), existing: true });
  }
  await audit(c.env.DB, { userId: u.id, action: "parts_order.create", targetType: "parts_order", targetId: made.id, detail: { changes: { quote_request: [null, quote.number], customer: [null, f.customer], lines: ["none", linesSummary(lines)] } }, ip: c.get("ip") });
  // Let the customer's request show "received" on their side.
  if (quote.status === "sent") await partsCall(c.env, `/quotes/${encodeURIComponent(qid)}`, { method: "PATCH", body: { status: "received", by: u.id } }).catch(() => undefined);
  return c.json({ id: made.id, number: number(made.seq) });
});

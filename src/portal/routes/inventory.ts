// Inventory: stock on the shelves, part by part and shelf by shelf (src/shared/inventory.ts has the rules).
// Modeled on the stock tools rated best by their users (research note in project files, "Inventory software.md").
//
// Who: inventory.view to look, .edit to put stock in, take it out or move it, .adjust to correct a count,
// change a part's details or import a stock list, .prices to see or set costs and stock value.
// Every change in quantity is a row in stock_moves that is never edited; stock_levels is the running
// total, changed in the same batch, and a shelf can't go below zero. Costs never go to someone without
// .prices and never into the audit log.
import { Hono } from "hono";
import { randomId } from "../../shared/crypto";
import { MAX_IMPORT, available, isLow, isOut } from "../../shared/inventory";
import type { AppEnv } from "../env";
import { audit, now } from "../lib/db";
import { body, fail, has, requirePerm } from "../lib/http";

export const inventory = new Hono<AppEnv>();

type Row = Record<string, any>;

function num(v: unknown, what: string, opts: { max?: number; positive?: boolean } = {}): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$\s]/g, "").replace(",", ".")) : NaN;
  if (!Number.isFinite(n)) fail(400, `${what} must be a number.`);
  if (n < 0) fail(400, `${what} can't be less than 0.`);
  if (opts.positive && n <= 0) fail(400, `${what} must be more than 0.`);
  if (n > (opts.max ?? 1_000_000)) fail(400, `${what} can't be more than ${opts.max ?? 1_000_000}.`);
  return Math.round(n * 1000) / 1000;
}
function text(v: unknown, max: number, what: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") fail(400, `${what} must be text.`);
  const t = v.trim();
  if (t.length > max) fail(400, `${what} is too long (limit ${max} characters).`);
  return t || null;
}
const code = (v: unknown): string => {
  const c = text(v, 60, "Part number")?.toUpperCase().replace(/\s+/g, "");
  if (!c) fail(400, "Part number is required.");
  return c;
};
const shelf = (v: unknown, what = "Shelf"): string => text(v, 60, what) ?? fail(400, `${what} is required.`);

/** Do another section's tables exist? (Each section can go live on its own.) */
async function tables(db: D1Database, ...names: string[]): Promise<boolean> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN (${names.map(() => "?").join(",")})`).bind(...names).first<{ n: number }>();
  return r?.n === names.length;
}

/** Held by confirmed parts orders that take the part from our stock, not yet shipped. */
const RESERVED = `SELECT l.part_code AS part_code, SUM(MAX(l.qty - l.qty_shipped, 0)) AS qty
  FROM parts_order_lines l JOIN parts_orders o ON o.id = l.order_id
 WHERE o.removed_at IS NULL AND o.status IN ('ordered', 'sourcing', 'ready') AND l.part_code IS NOT NULL AND l.supplier LIKE '%stock%'`;
/** Expected on deliveries not yet checked in. */
const INCOMING = `SELECT l.part_code AS part_code, SUM(MAX(l.qty - l.qty_received, 0)) AS qty
  FROM shipment_lines l JOIN shipments s ON s.id = l.shipment_id
 WHERE s.removed_at IS NULL AND s.direction = 'in' AND s.status NOT IN ('received', 'cancelled') AND l.part_code IS NOT NULL`;

async function sideTotals(db: D1Database, one?: string): Promise<{ reserved: Map<string, number>; incoming: Map<string, number> }> {
  const reserved = new Map<string, number>(), incoming = new Map<string, number>();
  const where = one ? " AND l.part_code = ? COLLATE NOCASE" : "";
  const bind = one ? [one] : [];
  if (await tables(db, "parts_orders", "parts_order_lines")) {
    for (const r of (await db.prepare(`${RESERVED}${where} GROUP BY l.part_code COLLATE NOCASE`).bind(...bind).all<{ part_code: string; qty: number }>()).results) reserved.set(r.part_code.toUpperCase(), r.qty);
  }
  if (await tables(db, "shipments", "shipment_lines")) {
    for (const r of (await db.prepare(`${INCOMING}${where} GROUP BY l.part_code COLLATE NOCASE`).bind(...bind).all<{ part_code: string; qty: number }>()).results) incoming.set(r.part_code.toUpperCase(), r.qty);
  }
  return { reserved, incoming };
}

function shape(i: Row, side: { reserved: Map<string, number>; incoming: Map<string, number> }, prices: boolean): Row {
  const key = String(i.part_code).toUpperCase();
  const row: Row = { ...i, active: !!i.active, on_hand: i.on_hand ?? 0, reserved: side.reserved.get(key) ?? 0, incoming: side.incoming.get(key) ?? 0 };
  row.available = available(row as never);
  row.low = isLow(row as never);
  row.out = isOut(row as never);
  if (prices) row.value = row.unit_cost == null ? null : Math.round(row.on_hand * row.unit_cost * 100) / 100;
  else delete row.unit_cost;
  return row;
}

inventory.get("/", async (c) => {
  const u = requirePerm(c, "inventory.view");
  const { results } = await c.env.DB.prepare(
    `SELECT i.part_code, i.description, i.bin, i.reorder_point, i.reorder_qty, i.unit_cost, i.active, i.updated_at,
            COALESCE((SELECT SUM(l.qty) FROM stock_levels l WHERE l.part_code = i.part_code), 0) AS on_hand,
            (SELECT group_concat(l.location, ', ') FROM stock_levels l WHERE l.part_code = i.part_code AND l.qty > 0) AS shelves
       FROM stock_items i ORDER BY i.part_code LIMIT 10000`,
  ).all<Row>();
  const side = await sideTotals(c.env.DB);
  const prices = has(u, "inventory.prices");
  return c.json({ items: results.map((i) => shape(i, side, prices)) });
});

/** Shelf names already in use, for the pick lists. */
inventory.get("/shelves", async (c) => {
  requirePerm(c, "inventory.view");
  const { results } = await c.env.DB.prepare("SELECT location FROM stock_levels UNION SELECT bin FROM stock_items WHERE bin IS NOT NULL ORDER BY 1 LIMIT 2000").all<{ location: string }>();
  return c.json({ shelves: results.map((r) => r.location) });
});

inventory.get("/part/:code", async (c) => {
  const u = requirePerm(c, "inventory.view");
  const pc = code(c.req.param("code"));
  const db = c.env.DB;
  const i = await db.prepare("SELECT i.*, COALESCE((SELECT SUM(l.qty) FROM stock_levels l WHERE l.part_code = i.part_code), 0) AS on_hand FROM stock_items i WHERE i.part_code = ?").bind(pc).first<Row>();
  if (!i) fail(404, "Not found.");
  const [levels, moves] = await db.batch([
    db.prepare("SELECT location, qty FROM stock_levels WHERE part_code = ? AND qty > 0 ORDER BY location").bind(pc),
    db.prepare("SELECT m.id, m.at, m.location, m.delta, m.type, m.reason, m.note, m.source_type, m.source_id, u.name AS who FROM stock_moves m LEFT JOIN users u ON u.id = m.user_id WHERE m.part_code = ? ORDER BY m.at DESC, m.rowid DESC LIMIT 300").bind(pc),
  ]);
  const side = await sideTotals(db, pc);
  // Which orders hold it, for people who may see parts orders.
  const holding = has(u, "partsorders.view") && (await tables(db, "parts_orders", "parts_order_lines"))
    ? (await db.prepare(
        `SELECT o.id, 'P-' || o.seq AS number, o.customer, o.status, MAX(l.qty - l.qty_shipped, 0) AS qty
           FROM parts_order_lines l JOIN parts_orders o ON o.id = l.order_id
          WHERE o.removed_at IS NULL AND o.status IN ('ordered', 'sourcing', 'ready') AND l.part_code = ? COLLATE NOCASE AND l.supplier LIKE '%stock%' AND l.qty > l.qty_shipped
          ORDER BY o.seq LIMIT 50`,
      ).bind(pc).all<Row>()).results
    : [];
  const name = await db.prepare("SELECT name_en FROM catalog_parts WHERE code = ?").bind(pc).first<{ name_en: string }>().catch(() => null);
  return c.json({ item: shape(i, side, has(u, "inventory.prices")), levels: levels!.results, moves: moves!.results, holding, catalogName: name?.name_en || null });
});

/** Statements that add `delta` to one shelf and write the ledger row. The CHECK on stock_levels refuses a shelf below zero. */
function post(db: D1Database, m: { part_code: string; location: string; delta: number; type: string; reason?: string | null; note?: string | null; pair_id?: string | null; user: string; at: string }) {
  return [
    // Taking out is an UPDATE: an INSERT of a negative number would trip the CHECK before the shelf's own row is looked at.
    m.delta < 0
      ? db.prepare("UPDATE stock_levels SET qty = ROUND(qty + ?, 3) WHERE part_code = ? AND location = ?").bind(m.delta, m.part_code, m.location)
      : db.prepare("INSERT INTO stock_levels (part_code, location, qty) VALUES (?, ?, ?) ON CONFLICT (part_code, location) DO UPDATE SET qty = ROUND(qty + excluded.qty, 3)").bind(m.part_code, m.location, m.delta),
    db.prepare("INSERT INTO stock_moves (id, at, part_code, location, delta, type, reason, note, pair_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(randomId(), m.at, m.part_code, m.location, m.delta, m.type, m.reason ?? null, m.note ?? null, m.pair_id ?? null, m.user),
  ];
}

/** Make the part's stock record if there is none yet, naming it from the parts catalog when it is in there. */
function ensureItem(db: D1Database, pc: string, description: string | null, location: string, user: string, at: string) {
  return db.prepare(
    `INSERT INTO stock_items (part_code, description, bin, created_at, updated_at, updated_by)
     VALUES (?, COALESCE(?, (SELECT NULLIF(name_en, '') FROM catalog_parts WHERE code = ?)), ?, ?, ?, ?) ON CONFLICT (part_code) DO NOTHING`,
  ).bind(pc, description, pc, location, at, at, user);
}

const belowZero = (e: unknown) => /CHECK constraint/i.test(String(e));

/** Put stock in, take it out, move it between shelves, or correct a count. */
inventory.post("/move", async (c) => {
  const b = await body(c);
  const type = String(b.type);
  if (!["receive", "issue", "move", "adjust"].includes(type)) fail(400, "Pick what you are doing.");
  const u = requirePerm(c, type === "adjust" ? "inventory.adjust" : "inventory.edit");
  const db = c.env.DB;
  const pc = code(b.part_code);
  const location = shelf(b.location);
  const note = text(b.note, 500, "Note");
  const reason = text(b.reason, 80, "Reason");
  const at = now();
  const have = await db.prepare("SELECT qty FROM stock_levels WHERE part_code = ? AND location = ?").bind(pc, location).first<{ qty: number }>();
  const onShelf = have?.qty ?? 0;
  const exists = await db.prepare("SELECT 1 FROM stock_items WHERE part_code = ?").bind(pc).first();
  if (!exists && type !== "receive" && type !== "adjust") fail(404, "That part is not in stock.");
  const stmts: D1PreparedStatement[] = [ensureItem(db, pc, text(b.description, 300, "Description"), location, u.id, at)];
  let detail: Row;
  if (type === "adjust") {
    const counted = num(b.qty, "Counted quantity") ?? fail(400, "Counted quantity is required.");
    if (!reason) fail(400, "Pick a reason for the correction.");
    const delta = Math.round((counted - onShelf) * 1000) / 1000;
    if (delta === 0) return c.json({ ok: true, on_shelf: onShelf });
    stmts.push(...post(db, { part_code: pc, location, delta, type, reason, note, user: u.id, at }));
    detail = { type, location, from: onShelf, to: counted, reason };
  } else {
    const qty = num(b.qty, "Quantity", { positive: true }) ?? fail(400, "Quantity is required.");
    if (type !== "receive" && qty > onShelf) fail(400, `Only ${onShelf} on shelf ${location}. To fix a wrong count, correct the count first.`);
    if (type === "move") {
      const to = shelf(b.to_location, "New shelf");
      if (to.toLowerCase() === location.toLowerCase()) fail(400, "Pick a different shelf to move to.");
      const pair = randomId();
      stmts.push(...post(db, { part_code: pc, location, delta: -qty, type, note, pair_id: pair, user: u.id, at }), ...post(db, { part_code: pc, location: to, delta: qty, type, note, pair_id: pair, user: u.id, at }));
      detail = { type, from: location, to, qty };
    } else {
      stmts.push(...post(db, { part_code: pc, location, delta: type === "receive" ? qty : -qty, type, reason, note, user: u.id, at }));
      detail = { type, location, qty, reason };
    }
  }
  try {
    await db.batch(stmts);
  } catch (e) {
    if (belowZero(e)) fail(409, "Someone else just took that stock. Reload and try again.");
    throw e;
  }
  await audit(db, { userId: u.id, action: "stock.move", targetType: "stock_item", targetId: pc, detail, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Change a part's stock details: description, usual shelf, reorder point and quantity, cost, notes, kept in stock. */
inventory.patch("/part/:code", async (c) => {
  const u = requirePerm(c, "inventory.adjust");
  const pc = code(c.req.param("code"));
  const b = await body(c);
  const before = await c.env.DB.prepare("SELECT * FROM stock_items WHERE part_code = ?").bind(pc).first<Row>();
  if (!before) fail(404, "Not found.");
  const set: Row = {};
  if ("description" in b) set.description = text(b.description, 300, "Description");
  if ("bin" in b) set.bin = text(b.bin, 60, "Usual shelf");
  if ("notes" in b) set.notes = text(b.notes, 2000, "Notes");
  if ("reorder_point" in b) set.reorder_point = num(b.reorder_point, "Reorder point");
  if ("reorder_qty" in b) set.reorder_qty = num(b.reorder_qty, "Reorder quantity");
  if ("active" in b) set.active = b.active === false || b.active === 0 ? 0 : 1;
  if ("unit_cost" in b && has(u, "inventory.prices")) set.unit_cost = num(b.unit_cost, "Cost each", { max: 10_000_000 });
  const keys = Object.keys(set).filter((k) => (before[k] ?? null) !== (set[k] ?? null));
  if (!keys.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE stock_items SET ${keys.map((k) => `${k} = ?, `).join("")}updated_at = ?, updated_by = ? WHERE part_code = ?`).bind(...keys.map((k) => set[k] ?? null), now(), u.id, pc).run();
  const changes = Object.fromEntries(keys.map((k) => [k, k === "unit_cost" ? [null, "changed"] : [before[k] ?? null, set[k] ?? null]]));
  await audit(c.env.DB, { userId: u.id, action: "stock.item", targetType: "stock_item", targetId: pc, detail: { changes }, ip: c.get("ip") });
  return c.json({ ok: true });
});

/**
 * Bring in a stock list (the opening stock, or a full recount): each row sets what is on one shelf for
 * one part. The difference from what the portal had goes into the ledger as Opening stock.
 */
inventory.post("/import", async (c) => {
  const u = requirePerm(c, "inventory.adjust");
  const prices = has(u, "inventory.prices");
  const b = await body(c);
  if (!Array.isArray(b.rows) || !b.rows.length) fail(400, "The list is empty.");
  if (b.rows.length > MAX_IMPORT) fail(400, `A list can have up to ${MAX_IMPORT} lines. Split it in two.`);
  const db = c.env.DB;
  const at = now();
  const seen = new Set<string>();
  const rows = (b.rows as Row[]).map((r, i) => {
    const what = (s: string) => `Line ${i + 1}: ${s}`;
    if (!r || typeof r !== "object") fail(400, what("is empty."));
    const pc = code(r.part_code);
    const location = text(r.location, 60, what("shelf")) ?? "Main";
    const key = `${pc}|${location.toLowerCase()}`;
    if (seen.has(key)) fail(400, what(`${pc} is on shelf ${location} twice.`));
    seen.add(key);
    return {
      pc, location, qty: num(r.qty, what("quantity")) ?? fail(400, what("quantity is required.")),
      description: text(r.description, 300, what("description")), reorder_point: num(r.reorder_point, what("reorder point")), reorder_qty: num(r.reorder_qty, what("reorder quantity")),
      unit_cost: prices ? num(r.unit_cost, what("cost"), { max: 10_000_000 }) : null,
    };
  });
  const levels = new Map<string, number>();
  for (const l of (await db.prepare("SELECT part_code, location, qty FROM stock_levels").all<{ part_code: string; location: string; qty: number }>()).results) levels.set(`${l.part_code.toUpperCase()}|${l.location.toLowerCase()}`, l.qty);
  let changed = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    stmts.push(ensureItem(db, r.pc, r.description, r.location, u.id, at));
    stmts.push(db.prepare("UPDATE stock_items SET description = COALESCE(?, description), reorder_point = COALESCE(?, reorder_point), reorder_qty = COALESCE(?, reorder_qty), unit_cost = COALESCE(?, unit_cost), active = 1, updated_at = ?, updated_by = ? WHERE part_code = ?")
      .bind(r.description, r.reorder_point, r.reorder_qty, r.unit_cost, at, u.id, r.pc));
    const delta = Math.round((r.qty - (levels.get(`${r.pc}|${r.location.toLowerCase()}`) ?? 0)) * 1000) / 1000;
    if (delta !== 0) {
      changed++;
      stmts.push(...post(db, { part_code: r.pc, location: r.location, delta, type: "opening", user: u.id, at }));
    }
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  await audit(db, { userId: u.id, action: "stock.import", targetType: "stock_item", detail: { lines: rows.length, changed }, ip: c.get("ip") });
  return c.json({ ok: true, lines: rows.length, changed });
});

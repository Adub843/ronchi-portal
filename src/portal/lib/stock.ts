// Stock that moves by itself (inventory, part 2): checking a delivery in puts its parts on the shelf,
// and shipping takes them off. Shipping and receiving calls these after it saves; the stock ledger
// (stock_moves) says which shipment and line caused each change, so nothing is counted twice.
//
// Rules:
//  - Coming in: every checked-in item that has a part number goes on the shelf it was put away on
//    (or the part's usual shelf, or "Receiving"). An item on quality hold is not in stock until the
//    hold is cleared.
//  - Going out: when a shipment is marked shipped, each part on it comes off the shelves that hold it,
//    the part's usual shelf first. Only what is there is taken: a shelf never goes below zero, and a
//    part that was never in stock is left alone. Taking the shipment back, or removing it, puts back
//    exactly what was taken.
import { randomId } from "../../shared/crypto";
import { now } from "./db";

/** Where a checked-in part goes when nobody said where it was put. */
export const RECEIVING_SHELF = "Receiving";

interface Ship { id: string; number: string; direction: string; status: string; removed_at: string | null }
interface Line { id: string; part_code: string | null; description: string | null; qty: number; qty_received: number; bin: string | null; hold: number }

const round = (n: number) => Math.round(n * 1000) / 1000;
const key = (s: string) => s.toUpperCase();

async function ready(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('stock_items', 'stock_levels', 'stock_moves')").first<{ n: number }>();
  return r?.n === 3;
}

function add(db: D1Database, m: { part: string; shelf: string; qty: number; description: string | null; ship: Ship; line: string | null; user: string; at: string; reason: string }): D1PreparedStatement[] {
  return [
    db.prepare(
      `INSERT INTO stock_items (part_code, description, bin, created_at, updated_at, updated_by)
       VALUES (?, COALESCE(?, (SELECT NULLIF(name_en, '') FROM catalog_parts WHERE code = ?)), ?, ?, ?, ?) ON CONFLICT (part_code) DO NOTHING`,
    ).bind(m.part, m.description, m.part, m.shelf, m.at, m.at, m.user),
    db.prepare("INSERT INTO stock_levels (part_code, location, qty) VALUES (?, ?, ?) ON CONFLICT (part_code, location) DO UPDATE SET qty = ROUND(qty + excluded.qty, 3)").bind(m.part, m.shelf, m.qty),
    db.prepare("INSERT INTO stock_moves (id, at, part_code, location, delta, type, reason, note, source_type, source_id, source_line, user_id) VALUES (?, ?, ?, ?, ?, 'receive', ?, ?, 'shipment', ?, ?, ?)")
      .bind(randomId(), m.at, m.part, m.shelf, m.qty, m.reason, m.ship.number, m.ship.id, m.line, m.user),
  ];
}

function take(db: D1Database, m: { part: string; shelf: string; qty: number; ship: Ship; line: string | null; user: string; at: string; reason: string }): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE stock_levels SET qty = ROUND(qty - ?, 3) WHERE part_code = ? AND location = ?").bind(m.qty, m.part, m.shelf),
    db.prepare("INSERT INTO stock_moves (id, at, part_code, location, delta, type, reason, note, source_type, source_id, source_line, user_id) VALUES (?, ?, ?, ?, ?, 'issue', ?, ?, 'shipment', ?, ?, ?)")
      .bind(randomId(), m.at, m.part, m.shelf, -m.qty, m.reason, m.ship.number, m.ship.id, m.line, m.user),
  ];
}

/** What is on each shelf for these parts, the part's usual shelf first, then the fullest. */
async function shelves(db: D1Database, parts: string[]): Promise<Map<string, { shelf: string; qty: number }[]>> {
  const out = new Map<string, { shelf: string; qty: number }[]>();
  for (let i = 0; i < parts.length; i += 80) {
    const chunk = parts.slice(i, i + 80);
    const { results } = await db.prepare(
      `SELECT l.part_code, l.location, l.qty FROM stock_levels l LEFT JOIN stock_items i ON i.part_code = l.part_code
        WHERE l.qty > 0 AND l.part_code IN (${chunk.map(() => "?").join(",")})
        ORDER BY (l.location = i.bin) DESC, l.qty DESC`,
    ).bind(...chunk).all<{ part_code: string; location: string; qty: number }>();
    for (const r of results) {
      const k = key(r.part_code);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push({ shelf: r.location, qty: r.qty });
    }
  }
  return out;
}

async function run(db: D1Database, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90)); // each change is 2 or 3 statements, kept together
}

/**
 * Bring the shelves in line with one shipment. Call after the shipment is saved.
 *  - A delivery: what is checked in and not on hold should be in stock; the difference is added or taken back.
 *  - A shipment out: `putBack` returns what it took (it is no longer shipped, was removed, or its items changed);
 *    `take` takes its parts off the shelves (it has just been marked shipped, or its items changed while shipped).
 */
export async function stockForShipment(db: D1Database, shipmentId: string, userId: string, opts: { take?: boolean; putBack?: boolean } = {}): Promise<void> {
  if (!(await ready(db))) return;
  const ship = await db.prepare("SELECT id, number, direction, status, removed_at FROM shipments WHERE id = ?").bind(shipmentId).first<Ship>();
  if (!ship) return;
  const at = now();
  const { results: lines } = await db.prepare("SELECT id, part_code, description, qty, qty_received, bin, hold FROM shipment_lines WHERE shipment_id = ? ORDER BY line_no").bind(shipmentId).all<Line>();
  const stmts: D1PreparedStatement[] = [];

  if (ship.direction === "in") {
    const { results: posted } = await db.prepare("SELECT source_line, part_code, location, SUM(delta) AS net FROM stock_moves WHERE source_type = 'shipment' AND source_id = ? GROUP BY source_line, part_code, location").bind(shipmentId).all<{ source_line: string | null; part_code: string; location: string; net: number }>();
    const levels = await shelves(db, [...new Set(posted.map((p) => key(p.part_code)))]);
    const seen = new Set<string>();
    const back = (lineId: string | null, part: string, want: number, reason: string) => {
      // Take back up to `want` from the shelves this line was put on, as far as it is still there.
      for (const p of posted.filter((x) => x.source_line === lineId && x.net > 0)) {
        if (want <= 0) break;
        const lvl = levels.get(key(part))?.find((l) => key(l.shelf) === key(p.location));
        const q = round(Math.min(want, p.net, lvl?.qty ?? 0));
        if (q <= 0) continue;
        lvl!.qty = round(lvl!.qty - q);
        want = round(want - q);
        stmts.push(...take(db, { part, shelf: p.location, qty: q, ship, line: lineId, user: userId, at, reason }));
      }
    };
    for (const l of lines) {
      seen.add(l.id);
      if (!l.part_code) continue;
      const part = key(l.part_code.replace(/\s+/g, ""));
      if (!part) continue;
      const have = round(posted.filter((p) => p.source_line === l.id).reduce((s, p) => s + p.net, 0));
      const want = ship.removed_at || l.hold ? 0 : l.qty_received;
      if (want > have) {
        const usual = l.bin ? null : await db.prepare("SELECT bin FROM stock_items WHERE part_code = ?").bind(part).first<{ bin: string | null }>();
        stmts.push(...add(db, { part, shelf: l.bin || usual?.bin || RECEIVING_SHELF, qty: round(want - have), description: l.description, ship, line: l.id, user: userId, at, reason: "Delivery checked in" }));
      } else if (want < have) back(l.id, part, round(have - want), l.hold ? "On quality hold" : "Delivery removed");
    }
    await run(db, stmts);
    return;
  }

  // Going out.
  const { results: taken } = await db.prepare("SELECT part_code, location, SUM(delta) AS net FROM stock_moves WHERE source_type = 'shipment' AND source_id = ? GROUP BY part_code, location HAVING SUM(delta) < 0").bind(shipmentId).all<{ part_code: string; location: string; net: number }>();
  if (opts.putBack) {
    for (const t of taken) stmts.push(...add(db, { part: key(t.part_code), shelf: t.location, qty: round(-t.net), description: null, ship, line: null, user: userId, at, reason: "Shipment taken back" }));
  }
  const gone = !ship.removed_at && (ship.status === "shipped" || ship.status === "delivered");
  if (opts.take && gone && (opts.putBack || !taken.length)) {
    await run(db, stmts.splice(0)); // what was put back can be taken again
    const parts = [...new Set(lines.filter((l) => l.part_code).map((l) => key(l.part_code!.replace(/\s+/g, ""))))];
    const levels = await shelves(db, parts);
    for (const l of lines) {
      if (!l.part_code) continue;
      const part = key(l.part_code.replace(/\s+/g, ""));
      let want = l.qty;
      for (const lvl of levels.get(part) ?? []) {
        if (want <= 0) break;
        const q = round(Math.min(want, lvl.qty));
        if (q <= 0) continue;
        lvl.qty = round(lvl.qty - q);
        want = round(want - q);
        stmts.push(...take(db, { part, shelf: lvl.shelf, qty: q, ship, line: l.id, user: userId, at, reason: "Shipped" }));
      }
    }
  }
  await run(db, stmts);
}

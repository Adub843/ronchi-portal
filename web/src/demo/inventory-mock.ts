// DEMO ONLY. Inventory in the preview, with made-up parts, shelves and costs.
// Follows routes/inventory.ts closely (same shared rules), without a server.
import { available, isLow, isOut, toOrder } from "../../../src/shared/inventory";

export class InventoryFail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (s: number, m: string): never => { throw new InventoryFail(s, m); };

interface Ctx { shelf?: string; me: { id: string; name: string }; perms: Set<string>; newId: () => string }
type Row = Record<string, any>;

let items: Row[] | null = null;
let levels: Row[] = [];
let moves: Row[] = [];
const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const RESERVED: Record<string, { qty: number; orders: Row[] }> = {
  "R44-0910": { qty: 2, orders: [{ id: "demo", number: "P-1041", customer: "Example Foods Inc.", status: "sourcing", qty: 2 }] },
};
const INCOMING: Record<string, number> = { "R10-2231": 12, "R22-0045": 24 };

function seed(c: Ctx) {
  const it = (part_code: string, description: string, bin: string, qty: number, reorder_point: number | null, unit_cost: number, extra: [string, number][] = []) => {
    levels.push({ part_code, location: bin, qty }, ...extra.map(([location, q]) => ({ part_code, location, qty: q })));
    moves.push({ id: c.newId(), at: ago(30), part_code, location: bin, delta: qty, type: "opening", reason: null, note: null, who: "Meagan" });
    return { part_code, description, bin, reorder_point, reorder_qty: reorder_point ? reorder_point * 2 : null, unit_cost, notes: null, active: true, updated_at: ago(30) };
  };
  items = [
    it("R10-2231", "O-ring kit, filling valve", "A1-1", 4, 10, 9.1),
    it("R44-0910", "Capping clutch assembly", "B2-3", 3, 2, 405),
    it("R22-0045", "Piston seal set", "A1-2", 0, 12, 4.2),
    it("R31-1177", "Star wheel, 500 ml round", "C4-1", 2, null, 760),
    it("R12-8800", "Guide rail, left", "C1-2", 6, 2, 120),
    it("R12-8801", "Guide rail, right", "C1-2", 6, 2, 120),
    it("R55-3010", "Chuck spring", "A2-4", 48, 20, 1.85, [["Field kit 1", 6]]),
    it("R44-0950", "Cap chuck, 38 mm", "B2-1", 9, 4, 98),
    it("R70-1200", "Conveyor belt, 3 m", "D1", 1, 1, 600),
    it("CM000240", "Washer Grower UNI 1751", "A3-2", 140, 50, 0.06),
  ];
  moves.push(
    { id: c.newId(), at: ago(6), part_code: "R10-2231", location: "A1-1", delta: -6, type: "issue", reason: "Parts order", note: "P-1045", who: "Meagan" },
    { id: c.newId(), at: ago(12), part_code: "R10-2231", location: "A1-1", delta: 10, type: "receive", reason: "Delivery checked in", note: "RC-2026-0007", source_type: "shipment", source_id: "demo", who: "Meagan" },
    { id: c.newId(), at: ago(3), part_code: "R22-0045", location: "A1-2", delta: -2, type: "adjust", reason: "Counted", note: null, who: "Meagan" },
  );
}

function shape(i: Row, prices: boolean): Row {
  const on_hand = levels.filter((l) => l.part_code === i.part_code).reduce((s, l) => s + l.qty, 0);
  const row: Row = { ...i, on_hand, reserved: RESERVED[i.part_code]?.qty ?? 0, incoming: INCOMING[i.part_code] ?? 0, shelves: levels.filter((l) => l.part_code === i.part_code && l.qty > 0).map((l) => l.location).join(", ") || null };
  row.available = available(row as never);
  row.low = isLow(row as never);
  row.out = isOut(row as never);
  row.to_order = toOrder(row as never);
  if (prices) row.value = row.unit_cost == null ? null : Math.round(on_hand * row.unit_cost * 100) / 100;
  else delete row.unit_cost;
  return row;
}

export function resetInventory() {
  items = null;
  levels = [];
  moves = [];
}

export function inventoryRoute(method: string, seg: string[], body: any, c: Ctx): any {
  if (!c.perms.has("inventory.view")) fail(403, "Your role doesn't allow this.");
  if (!items) seed(c);
  const all = items!;
  const prices = c.perms.has("inventory.prices");
  const need = (p: string) => { if (!c.perms.has(p)) fail(403, "Your role doesn't allow this."); };
  const level = (pc: string, loc: string) => {
    let l = levels.find((x) => x.part_code === pc && x.location.toLowerCase() === loc.toLowerCase());
    if (!l) { l = { part_code: pc, location: loc, qty: 0 }; levels.push(l); }
    return l;
  };
  const log = (pc: string, location: string, delta: number, type: string, reason?: string, note?: string) => moves.unshift({ id: c.newId(), at: new Date().toISOString(), part_code: pc, location, delta, type, reason: reason || null, note: note || null, who: c.me.name });
  const ensure = (pc: string, description: string, bin: string) => {
    if (!all.some((i) => i.part_code === pc)) all.push({ part_code: pc, description: description || null, bin, reorder_point: null, reorder_qty: null, unit_cost: null, notes: null, active: true, updated_at: new Date().toISOString() });
  };

  if (seg.length === 1 && method === "GET") return { items: all.map((i) => shape(i, prices)).sort((a, b) => a.part_code.localeCompare(b.part_code)) };
  if (seg[1] === "shelves") return { shelves: [...new Set([...levels.map((l) => l.location), ...all.map((i) => i.bin).filter(Boolean)])].sort() };
  if (seg[1] === "move" && method === "POST") {
    const type = body.type;
    need(type === "adjust" ? "inventory.adjust" : "inventory.edit");
    const pc = String(body.part_code ?? "").trim().toUpperCase();
    const loc = String(body.location ?? "").trim();
    if (!pc) fail(400, "Part number is required.");
    if (!loc) fail(400, "Shelf is required.");
    const qty = Number(body.qty);
    if (!(qty >= 0) || body.qty === "") fail(400, "Quantity must be a number.");
    const l = level(pc, loc);
    if (type === "adjust") {
      if (!body.reason) fail(400, "Pick a reason for the correction.");
      ensure(pc, body.description, loc);
      if (qty !== l.qty) { log(pc, loc, qty - l.qty, type, body.reason, body.note); l.qty = qty; }
    } else if (type === "receive") {
      ensure(pc, body.description, loc);
      l.qty += qty; log(pc, loc, qty, type, body.reason, body.note);
    } else {
      if (qty > l.qty) fail(400, `Only ${l.qty} on shelf ${loc}. To fix a wrong count, correct the count first.`);
      if (type === "move") {
        const to = String(body.to_location ?? "").trim();
        if (!to) fail(400, "New shelf is required.");
        if (to.toLowerCase() === loc.toLowerCase()) fail(400, "Pick a different shelf to move to.");
        l.qty -= qty; level(pc, to).qty += qty; log(pc, loc, -qty, type, "", body.note); log(pc, to, qty, type, "", body.note);
      } else { l.qty -= qty; log(pc, loc, -qty, type, body.reason, body.note); }
    }
    return { ok: true };
  }
  if (seg[1] === "count" && method === "GET") {
    need("inventory.adjust");
    const shelf = (c.shelf ?? "").trim().toLowerCase();
    return {
      shelf,
      lines: all.map((i) => ({ part_code: i.part_code, description: i.description, qty: levels.find((l) => l.part_code === i.part_code && l.location.toLowerCase() === shelf)?.qty ?? 0, bin: i.bin }))
        .filter((l) => l.qty > 0 || String(l.bin ?? "").toLowerCase() === shelf).sort((a, b) => a.part_code.localeCompare(b.part_code)),
    };
  }
  if (seg[1] === "count" && method === "POST") {
    need("inventory.adjust");
    const loc = String(body.location ?? "").trim();
    if (!loc) fail(400, "Shelf is required.");
    const differences: Row[] = [];
    for (const r of body.lines as Row[]) {
      const pc = String(r.part_code).trim().toUpperCase(), qty = Number(r.qty);
      if (!(qty >= 0)) fail(400, `Counted quantity of ${pc} must be a number.`);
      const l = level(pc, loc);
      if (l.qty === qty) continue;
      ensure(pc, "", loc);
      differences.push({ part_code: pc, from: l.qty, to: qty });
      log(pc, l.location, qty - l.qty, "adjust", "Counted", body.note);
      l.qty = qty;
    }
    return { ok: true, counted: body.lines.length, changed: differences.length, differences };
  }
  if (seg[1] === "import" && method === "POST") {
    need("inventory.adjust");
    let changed = 0;
    for (const r of body.rows as Row[]) {
      const pc = String(r.part_code).trim().toUpperCase(), loc = String(r.location || "Main").trim(), qty = Number(String(r.qty).replace(",", "."));
      ensure(pc, r.description, loc);
      const l = level(pc, loc);
      if (l.qty !== qty) { changed++; log(pc, loc, qty - l.qty, "opening"); l.qty = qty; }
    }
    return { ok: true, lines: body.rows.length, changed };
  }
  if (seg[1] === "part") {
    const pc = decodeURIComponent(seg[2] ?? "").toUpperCase();
    const i = all.find((x) => x.part_code === pc);
    if (!i) return fail(404, "Not found.");
    if (method === "PATCH") {
      need("inventory.adjust");
      for (const k of ["description", "bin", "notes"]) if (k in body) i[k] = body[k] || null;
      for (const k of ["reorder_point", "reorder_qty"]) if (k in body) i[k] = body[k] === "" || body[k] == null ? null : Number(body[k]);
      if ("unit_cost" in body && prices) i.unit_cost = body.unit_cost === "" ? null : Number(body.unit_cost);
      if ("active" in body) i.active = !!body.active;
      return { ok: true };
    }
    return {
      item: shape(i, prices), levels: levels.filter((l) => l.part_code === pc && l.qty > 0).sort((a, b) => a.location.localeCompare(b.location)),
      moves: moves.filter((m) => m.part_code === pc).sort((a, b) => b.at.localeCompare(a.at)),
      holding: c.perms.has("partsorders.view") ? RESERVED[pc]?.orders ?? [] : [], catalogName: null,
    };
  }
  return fail(404, "Not found.");
}

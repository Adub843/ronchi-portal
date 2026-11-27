import { describe, expect, it } from "vitest";
import { Browser, person } from "./helpers";

const move = (p: any, body: Record<string, unknown>) => p.json("/api/inventory/move", { body });
const item = async (p: any, code: string) => (await p.json(`/api/inventory/part/${code}`)).data;

describe("inventory", () => {
  it("everyone on staff can look; only some roles change stock, and fewer correct counts", async () => {
    const meagan = await person("scheduling");
    expect((await move(meagan, { type: "receive", part_code: "inv-a1", description: "Test seal", location: "A1", qty: 10 })).status).toBe(200);
    for (const role of ["tech", "engineering", "billing", "service", "sales", "manager", "admin"]) {
      expect((await (await person(role)).fetch("/api/inventory")).status, role).toBe(200);
    }
    for (const role of ["tech", "engineering", "billing"]) {
      const p = await person(role);
      expect((await move(p, { type: "issue", part_code: "INV-A1", location: "A1", qty: 1 })).status, role).toBe(403);
      expect((await p.fetch("/api/inventory/part/INV-A1", { method: "PATCH", body: { bin: "Z9" } })).status, role).toBe(403);
      expect((await p.fetch("/api/inventory/import", { body: { rows: [{ part_code: "X", qty: 1 }] } })).status, role).toBe(403);
    }
    for (const role of ["service", "sales"]) {
      const p = await person(role);
      expect((await move(p, { type: "adjust", part_code: "INV-A1", location: "A1", qty: 9, reason: "Counted" })).status, role).toBe(403);
    }
    expect((await new Browser().fetch("/api/inventory")).status).toBe(401);
  });

  it("keeps a running total per shelf from a ledger that records every change", async () => {
    const meagan = await person("scheduling");
    await move(meagan, { type: "receive", part_code: "INV-B1", description: "Clutch", location: "B2", qty: 5 });
    await move(meagan, { type: "receive", part_code: "INV-B1", location: "B2", qty: 3 });
    await move(meagan, { type: "issue", part_code: "INV-B1", location: "B2", qty: 2, reason: "Parts order", note: "P-1001" });
    await move(meagan, { type: "move", part_code: "INV-B1", location: "B2", to_location: "Field kit 1", qty: 4 });
    const d = await item(meagan, "INV-B1");
    expect(d.item).toMatchObject({ part_code: "INV-B1", description: "Clutch", bin: "B2", on_hand: 6, available: 6, out: false });
    expect(d.levels).toEqual([{ location: "B2", qty: 2 }, { location: "Field kit 1", qty: 4 }]);
    expect(d.moves.map((m: any) => [m.type, m.location, m.delta]).reverse()).toEqual([["receive", "B2", 5], ["receive", "B2", 3], ["issue", "B2", -2], ["move", "B2", -4], ["move", "Field kit 1", 4]]);
    expect(d.moves.reduce((s: number, m: any) => s + m.delta, 0)).toBe(6);
  });

  it("never lets a shelf go below zero, and checks what is typed", async () => {
    const meagan = await person("scheduling");
    await move(meagan, { type: "receive", part_code: "INV-C1", location: "C1", qty: 2 });
    expect((await move(meagan, { type: "issue", part_code: "INV-C1", location: "C1", qty: 3 })).status).toBe(400);
    expect((await move(meagan, { type: "move", part_code: "INV-C1", location: "C1", to_location: "c1", qty: 1 })).status).toBe(400);
    expect((await move(meagan, { type: "move", part_code: "INV-C1", location: "C1", qty: 1 })).status).toBe(400);
    expect((await move(meagan, { type: "issue", part_code: "NOT-THERE", location: "C1", qty: 1 })).status).toBe(404);
    expect((await move(meagan, { type: "receive", part_code: "INV-C1", location: "C1", qty: 0 })).status).toBe(400);
    expect((await move(meagan, { type: "receive", part_code: "INV-C1", location: "C1", qty: "lots" })).status).toBe(400);
    expect((await move(meagan, { type: "receive", part_code: "", location: "C1", qty: 1 })).status).toBe(400);
    expect((await move(meagan, { type: "receive", part_code: "INV-C1", qty: 1 })).status).toBe(400);
    expect((await move(meagan, { type: "burn", part_code: "INV-C1", location: "C1", qty: 1 })).status).toBe(400);
    expect((await item(meagan, "INV-C1")).item.on_hand).toBe(2);
  });

  it("corrects a count only with a reason, and writes the difference to the ledger", async () => {
    const meagan = await person("scheduling");
    await move(meagan, { type: "receive", part_code: "INV-D1", location: "D1", qty: 10 });
    expect((await move(meagan, { type: "adjust", part_code: "INV-D1", location: "D1", qty: 7 })).status).toBe(400);
    expect((await move(meagan, { type: "adjust", part_code: "INV-D1", location: "D1", qty: 7, reason: "Counted" })).status).toBe(200);
    const d = await item(meagan, "INV-D1");
    expect(d.item.on_hand).toBe(7);
    expect(d.moves[0]).toMatchObject({ type: "adjust", delta: -3, reason: "Counted" });
  });

  it("flags low and out of stock from the reorder point", async () => {
    const meagan = await person("scheduling");
    await move(meagan, { type: "receive", part_code: "INV-E1", location: "E1", qty: 5 });
    expect((await meagan.fetch("/api/inventory/part/INV-E1", { method: "PATCH", body: { reorder_point: 5, reorder_qty: 20, bin: "E1" } })).status).toBe(200);
    expect((await item(meagan, "INV-E1")).item).toMatchObject({ low: true, out: false, reorder_point: 5 });
    await move(meagan, { type: "issue", part_code: "INV-E1", location: "E1", qty: 5 });
    const list = (await meagan.json("/api/inventory")).data.items;
    expect(list.find((i: any) => i.part_code === "INV-E1")).toMatchObject({ on_hand: 0, out: true, low: false });
  });

  it("holds stock for confirmed parts orders that take the part from our stock", async () => {
    const meagan = await person("scheduling");
    const sales = await person("sales");
    await move(meagan, { type: "receive", part_code: "INV-F1", location: "F1", qty: 10 });
    const quote = await sales.json("/api/parts-orders", { body: { customer: "Acme", lines: [{ part_code: "INV-F1", qty: 4, supplier: "Our stock" }] } });
    expect((await item(meagan, "INV-F1")).item.reserved).toBe(0); // only an inquiry so far
    await sales.json(`/api/parts-orders/${quote.data.id}`, { method: "PATCH", body: { revision: 1, customer_po: "PO-1", status: "ordered" } });
    const d = await item(sales, "INV-F1");
    expect(d.item).toMatchObject({ on_hand: 10, reserved: 4, available: 6 });
    expect(d.holding).toHaveLength(1);
    expect(d.holding[0]).toMatchObject({ customer: "Acme", qty: 4 });
    expect((await item(await person("tech"), "INV-F1")).holding).toEqual([]); // may not see parts orders
  });

  it("shows costs and stock value only to people with See stock costs", async () => {
    const manager = await person("manager");
    await move(manager, { type: "receive", part_code: "INV-G1", location: "G1", qty: 4 });
    await manager.fetch("/api/inventory/part/INV-G1", { method: "PATCH", body: { unit_cost: 12.5 } });
    expect((await item(manager, "INV-G1")).item).toMatchObject({ unit_cost: 12.5, value: 50 });
    for (const role of ["tech", "scheduling", "service", "engineering"]) {
      const d = await item(await person(role), "INV-G1");
      expect("unit_cost" in d.item, role).toBe(false);
      expect("value" in d.item, role).toBe(false);
    }
    // Someone who can correct stock but not see costs can't change a cost.
    const meagan = await person("scheduling");
    await meagan.fetch("/api/inventory/part/INV-G1", { method: "PATCH", body: { unit_cost: 1, bin: "G2" } });
    expect((await item(manager, "INV-G1")).item).toMatchObject({ unit_cost: 12.5, bin: "G2" });
  });

  it("imports a stock list: each line sets one part on one shelf", async () => {
    const meagan = await person("scheduling");
    await move(meagan, { type: "receive", part_code: "INV-H1", location: "H1", qty: 3 });
    const r = await meagan.json("/api/inventory/import", { body: { rows: [
      { part_code: "inv-h1", location: "H1", qty: "8", reorder_point: "2" },
      { part_code: "INV-H2", description: "New washer", location: "H2", qty: "40" },
      { part_code: "INV-H3", qty: "1,5" },
    ] } });
    expect(r.data).toMatchObject({ lines: 3, changed: 3 });
    expect((await item(meagan, "INV-H1")).item).toMatchObject({ on_hand: 8, reorder_point: 2 });
    expect((await item(meagan, "INV-H1")).moves[0]).toMatchObject({ type: "opening", delta: 5 });
    expect((await item(meagan, "INV-H2")).item).toMatchObject({ on_hand: 40, description: "New washer" });
    expect((await item(meagan, "INV-H3")).levels).toEqual([{ location: "Main", qty: 1.5 }]);
    expect((await meagan.fetch("/api/inventory/import", { body: { rows: [{ part_code: "A", location: "X", qty: 1 }, { part_code: "a", location: "x", qty: 2 }] } })).status).toBe(400);
    expect((await meagan.fetch("/api/inventory/import", { body: { rows: [] } })).status).toBe(400);
  });

  it("says how many to order: the reorder quantity, or enough to get back above the reorder point", async () => {
    const meagan = await person("scheduling");
    await meagan.json("/api/inventory/import", { body: { rows: [
      { part_code: "INV-R1", location: "R1", qty: 4, reorder_point: 10, reorder_qty: 20 }, // low: order the usual 20
      { part_code: "INV-R2", location: "R1", qty: 0, reorder_point: 12 },                   // out, no usual quantity: 12 short
      { part_code: "INV-R3", location: "R1", qty: 30, reorder_point: 10, reorder_qty: 20 },  // enough
      { part_code: "INV-R4", location: "R1", qty: 5 },                                       // no reorder point, nothing waits
      { part_code: "INV-R5", location: "R1", qty: 10, reorder_point: 10 },                   // at the point: at least one
    ] } });
    const list = (await meagan.json("/api/inventory")).data.items;
    const q = (code: string) => list.find((i: any) => i.part_code === code).to_order;
    expect([q("INV-R1"), q("INV-R2"), q("INV-R3"), q("INV-R4"), q("INV-R5")]).toEqual([20, 12, null, null, 1]);
    // A part no longer kept in stock is never on the list.
    await meagan.fetch("/api/inventory/part/INV-R1", { method: "PATCH", body: { active: false } });
    expect((await item(meagan, "INV-R1")).item.to_order).toBe(null);
  });

  it("counts a shelf: what differs is corrected as Counted, what was not counted is left alone", async () => {
    const meagan = await person("scheduling");
    await meagan.json("/api/inventory/import", { body: { rows: [
      { part_code: "INV-S1", location: "S1", qty: 10 }, { part_code: "INV-S2", location: "S1", qty: 5 }, { part_code: "INV-S3", location: "S1", qty: 7 },
      { part_code: "INV-S1", location: "S2", qty: 3 },
    ] } });
    await move(meagan, { type: "move", part_code: "INV-S3", location: "S1", to_location: "S2", qty: 7 }); // usually on S1, none there now
    const sheet = (await meagan.json("/api/inventory/count?shelf=s1")).data;
    expect(sheet.lines.map((l: any) => [l.part_code, l.qty])).toEqual([["INV-S1", 10], ["INV-S2", 5], ["INV-S3", 0]]);
    const r = await meagan.json("/api/inventory/count", { body: { location: "s1", note: "November count", lines: [
      { part_code: "INV-S1", qty: 8 }, { part_code: "INV-S3", qty: 0 }, { part_code: "inv-s9", description: "Found on the shelf", qty: 2 },
    ] } });
    expect(r.data).toMatchObject({ counted: 3, changed: 2, differences: [{ part_code: "INV-S1", from: 10, to: 8 }, { part_code: "INV-S9", from: 0, to: 2 }] });
    const s1 = await item(meagan, "INV-S1");
    expect(s1.levels).toEqual([{ location: "S1", qty: 8 }, { location: "S2", qty: 3 }]);
    expect(s1.moves[0]).toMatchObject({ type: "adjust", reason: "Counted", note: "November count", location: "S1", delta: -2 });
    expect((await item(meagan, "INV-S2")).item.on_hand).toBe(5);
    expect((await item(meagan, "INV-S9")).item).toMatchObject({ on_hand: 2, description: "Found on the shelf", bin: "S1" });
    // Checks: something counted, no part twice, real numbers; and only people who may correct stock.
    expect((await meagan.fetch("/api/inventory/count", { body: { location: "S1", lines: [] } })).status).toBe(400);
    expect((await meagan.fetch("/api/inventory/count", { body: { location: "S1", lines: [{ part_code: "A", qty: 1 }, { part_code: "a", qty: 2 }] } })).status).toBe(400);
    expect((await meagan.fetch("/api/inventory/count", { body: { location: "S1", lines: [{ part_code: "INV-S1", qty: -1 }] } })).status).toBe(400);
    expect((await meagan.fetch("/api/inventory/count", { body: { lines: [{ part_code: "INV-S1", qty: 1 }] } })).status).toBe(400);
    for (const role of ["service", "sales", "tech"]) {
      const p = await person(role);
      expect((await p.fetch("/api/inventory/count?shelf=S1")).status, role).toBe(403);
      expect((await p.fetch("/api/inventory/count", { body: { location: "S1", lines: [{ part_code: "INV-S1", qty: 1 }] } })).status, role).toBe(403);
    }
  });

  it("closes to everyone but admins when the section is switched off", async () => {
    const admin = await person("admin");
    const cur = await admin.json("/api/settings");
    const put = (on: boolean) => admin.json("/api/settings", { method: "PUT", body: { ...cur.data.settings, sections: { ...cur.data.settings.sections, inventory: on } } });
    expect((await put(false)).status).toBe(200);
    expect((await (await person("scheduling")).fetch("/api/inventory")).status).toBe(403);
    expect((await admin.fetch("/api/inventory")).status).toBe(200);
    expect((await put(true)).status).toBe(200);
  });
});

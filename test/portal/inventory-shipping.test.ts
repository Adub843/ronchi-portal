import { describe, expect, it } from "vitest";
import { person } from "./helpers";

const part = async (p: any, code: string) => (await p.json(`/api/inventory/part/${code}`)).data;
const ship = async (p: any, id: string) => (await p.json(`/api/shipping/${id}`)).data;

describe("stock follows shipping and receiving", () => {
  it("checking a delivery in puts the parts on the shelf they were put away on", async () => {
    const meagan = await person("scheduling");
    const made = await meagan.json("/api/shipping", { body: { direction: "in", kind: "from_italy", party: "Ronchi Mario", lines: [{ part_code: "AUTO-IN-1", description: "Gasket", qty: 10 }, { description: "No part number", qty: 1 }] } });
    expect(made.status).toBe(200);
    let s = await ship(meagan, made.data.id);
    expect((await meagan.fetch("/api/inventory/part/AUTO-IN-1")).status).toBe(404); // nothing in stock until it is checked in
    await meagan.json(`/api/shipping/${made.data.id}/receive`, { body: { revision: s.shipment.revision, lines: [{ id: s.lines[0].id, qty: 4, bin: "A-03" }] } });
    let d = await part(meagan, "AUTO-IN-1");
    expect(d.item).toMatchObject({ description: "Gasket", bin: "A-03", on_hand: 4, incoming: 6 });
    expect(d.moves[0]).toMatchObject({ type: "receive", location: "A-03", delta: 4, reason: "Delivery checked in", note: s.shipment.number, source_id: made.data.id });
    // The rest comes in with no shelf typed: it goes to the same line's shelf.
    s = await ship(meagan, made.data.id);
    await meagan.json(`/api/shipping/${made.data.id}/receive`, { body: { revision: s.shipment.revision, lines: [{ id: s.lines[0].id, qty: 6 }, { id: s.lines[1].id, qty: 1 }] } });
    d = await part(meagan, "AUTO-IN-1");
    expect(d.item).toMatchObject({ on_hand: 10, incoming: 0 });
    expect(d.levels).toEqual([{ location: "A-03", qty: 10 }]);
  });

  it("keeps an item on quality hold out of stock until the hold is cleared", async () => {
    const meagan = await person("scheduling");
    const made = await meagan.json("/api/shipping", { body: { direction: "in", kind: "supplier", party: "Supplier", lines: [{ part_code: "AUTO-HOLD-1", description: "Sensor", qty: 3 }] } });
    let s = await ship(meagan, made.data.id);
    await meagan.json(`/api/shipping/${made.data.id}/receive`, { body: { revision: s.shipment.revision, lines: [{ id: s.lines[0].id, qty: 3, hold: true, hold_note: "Check thread" }] } });
    expect((await meagan.fetch("/api/inventory/part/AUTO-HOLD-1")).status).toBe(404);
    s = await ship(meagan, made.data.id);
    await meagan.json(`/api/shipping/${made.data.id}/lines/${s.lines[0].id}/hold`, { body: { revision: s.shipment.revision, hold: false } });
    let d = await part(meagan, "AUTO-HOLD-1");
    expect(d.item.on_hand).toBe(3);
    expect(d.levels).toEqual([{ location: "Receiving", qty: 3 }]);
    // Back on hold: it comes off the shelf again.
    s = await ship(meagan, made.data.id);
    await meagan.json(`/api/shipping/${made.data.id}/lines/${s.lines[0].id}/hold`, { body: { revision: s.shipment.revision, hold: true, note: "Wrong part" } });
    d = await part(meagan, "AUTO-HOLD-1");
    expect(d.item.on_hand).toBe(0);
    expect(d.moves[0]).toMatchObject({ type: "issue", delta: -3, reason: "On quality hold" });
  });

  it("takes parts off the shelf when a shipment leaves, and puts them back if it is taken back", async () => {
    const meagan = await person("scheduling");
    const move = (body: Record<string, unknown>) => meagan.json("/api/inventory/move", { body });
    await move({ type: "receive", part_code: "AUTO-OUT-1", location: "B1", qty: 3 });
    await move({ type: "receive", part_code: "AUTO-OUT-1", location: "B2", qty: 5 });
    const made = await meagan.json("/api/shipping", { body: { direction: "out", kind: "spare_parts", party: "Customer", lines: [{ part_code: "auto-out-1", description: "Belt", qty: 4 }, { part_code: "NEVER-STOCKED", description: "Other", qty: 2 }] } });
    expect((await part(meagan, "AUTO-OUT-1")).item.on_hand).toBe(8); // not shipped yet
    let s = await ship(meagan, made.data.id);
    expect((await meagan.fetch(`/api/shipping/${made.data.id}`, { method: "PATCH", body: { revision: s.shipment.revision, status: "shipped" } })).status).toBe(200);
    let d = await part(meagan, "AUTO-OUT-1");
    expect(d.item.on_hand).toBe(4);
    expect(d.levels).toEqual([{ location: "B2", qty: 4 }]); // the fullest shelf first: 4 of the 5 on B2
    expect(d.moves[0]).toMatchObject({ type: "issue", reason: "Shipped", note: s.shipment.number });
    expect((await meagan.fetch("/api/inventory/part/NEVER-STOCKED")).status).toBe(404); // a part that was never in stock is left alone
    // Saving something else on a shipped shipment takes nothing more.
    s = await ship(meagan, made.data.id);
    await meagan.fetch(`/api/shipping/${made.data.id}`, { method: "PATCH", body: { revision: s.shipment.revision, tracking: "1Z999" } });
    expect((await part(meagan, "AUTO-OUT-1")).item.on_hand).toBe(4);
    // Delivered is still gone; nothing changes.
    s = await ship(meagan, made.data.id);
    await meagan.fetch(`/api/shipping/${made.data.id}`, { method: "PATCH", body: { revision: s.shipment.revision, status: "delivered" } });
    expect((await part(meagan, "AUTO-OUT-1")).item.on_hand).toBe(4);
    // Removed: everything it took goes back where it came from.
    expect((await meagan.fetch(`/api/shipping/${made.data.id}`, { method: "DELETE" })).status).toBe(200);
    d = await part(meagan, "AUTO-OUT-1");
    expect(d.item.on_hand).toBe(8);
    expect(d.levels).toEqual([{ location: "B1", qty: 3 }, { location: "B2", qty: 5 }]);
  });

  it("takes only what is there, never below zero", async () => {
    const meagan = await person("scheduling");
    await meagan.json("/api/inventory/move", { body: { type: "receive", part_code: "AUTO-SHORT-1", location: "C1", qty: 2 } });
    const made = await meagan.json("/api/shipping", { body: { direction: "out", kind: "spare_parts", party: "Customer", status: "shipped", lines: [{ part_code: "AUTO-SHORT-1", description: "Pin", qty: 5 }] } });
    expect(made.status).toBe(200);
    expect((await part(meagan, "AUTO-SHORT-1")).item.on_hand).toBe(0);
  });
});

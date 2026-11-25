import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { person } from "./helpers";

const year = new Date().getUTCFullYear();

const outgoing = (extra: Record<string, unknown> = {}) => ({
  direction: "out", kind: "spare_parts", party: "Acme Bottling", machine: "4110mb", reference: "PO 5521",
  address: "1 Main St\nPottstown, PA 19464", contact_name: "Dana Smith", contact_phone: "555-0100", contact_email: "dana@acme.test",
  carrier: "ups", service: "Ground", planned_date: "2026-12-01",
  packages: [{ type: "box", count: 2, weight: 14, length: 18, width: 12, height: 10 }],
  lines: [{ part_code: "R-10442", description: "Piston O-ring kit", qty: 4 }, { part_code: "R-2210", description: "Star wheel 38mm", qty: 1 }],
  ...extra,
});
const incoming = (extra: Record<string, unknown> = {}) => ({
  direction: "in", kind: "from_italy", party: "Ronchi Mario S.p.A.", reference: "IT-ORD-88", carrier: "forwarder", planned_date: "2026-12-10",
  lines: [{ part_code: "R-10442", description: "Piston O-ring kit", qty: 10 }, { part_code: "R-7781", description: "Capping head clutch", qty: 2 }],
  ...extra,
});

describe("shipping and receiving", () => {
  it("scheduling makes an outgoing shipment with a number, packages, a packing list and tracking links", async () => {
    const meagan = await person("scheduling");
    const r = await meagan.json("/api/shipping", { body: outgoing() });
    expect(r.status).toBe(200);
    expect(r.data.number).toMatch(new RegExp(`^SH-${year}-\\d{4}$`));
    const s = await meagan.json(`/api/shipping/${r.data.id}`);
    expect(s.data.shipment).toMatchObject({ direction: "out", kind: "spare_parts", status: "to_pack", party: "Acme Bottling", machine: "4110MB", carrier: "ups" });
    expect(s.data.shipment.packages).toHaveLength(1);
    expect(s.data.totals).toEqual({ pieces: 2, weight: 28 });
    expect(s.data.lines.map((l: any) => [l.line_no, l.part_code, l.qty])).toEqual([[1, "R-10442", 4], [2, "R-2210", 1]]);
    // A second one counts up.
    const r2 = await meagan.json("/api/shipping", { body: outgoing() });
    expect(Number(r2.data.number.slice(-4))).toBe(Number(r.data.number.slice(-4)) + 1);
  });

  it("every staff member can look, only shipping editors can change", async () => {
    const meagan = await person("scheduling");
    const tech = await person("tech");
    const billing = await person("billing");
    const r = await meagan.json("/api/shipping", { body: outgoing() });
    expect((await tech.json(`/api/shipping/${r.data.id}`)).status).toBe(200);
    expect((await tech.json("/api/shipping", { body: outgoing() })).status).toBe(403);
    expect((await billing.json(`/api/shipping/${r.data.id}`, { method: "PATCH", body: { revision: 1, status: "packed" } })).status).toBe(403);
    expect((await (await person("sales")).json("/api/shipping", { body: outgoing() })).status).toBe(200);
  });

  it("refuses a shipment without a customer or supplier, a wrong status, or nonsense packages", async () => {
    const m = await person("scheduling");
    expect((await m.json("/api/shipping", { body: outgoing({ party: "" }) })).status).toBe(400);
    expect((await m.json("/api/shipping", { body: outgoing({ direction: "sideways" }) })).status).toBe(400);
    expect((await m.json("/api/shipping", { body: outgoing({ kind: "from_italy" }) })).status).toBe(400);
    expect((await m.json("/api/shipping", { body: outgoing({ packages: [{ type: "box", count: -1 }] }) })).status).toBe(400);
    expect((await m.json("/api/shipping", { body: outgoing({ lines: [{ description: "", qty: 1 }] }) })).status).toBe(400);
    const r = await m.json("/api/shipping", { body: outgoing() });
    expect((await m.json(`/api/shipping/${r.data.id}`, { method: "PATCH", body: { revision: 1, status: "received" } })).status).toBe(400);
  });

  it("marking shipped stamps the ship date; two people editing at once can't overwrite each other", async () => {
    const m = await person("scheduling");
    const r = await m.json("/api/shipping", { body: outgoing() });
    const p = await m.json(`/api/shipping/${r.data.id}`, { method: "PATCH", body: { revision: 1, status: "shipped", tracking: "1Z999AA10123456784" } });
    expect(p.status).toBe(200);
    const s = await m.json(`/api/shipping/${r.data.id}`);
    expect(s.data.shipment.status).toBe("shipped");
    expect(s.data.shipment.shipped_date).toBe(new Date().toISOString().slice(0, 10));
    expect(s.data.tracking).toEqual([{ number: "1Z999AA10123456784", url: "https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784" }]);
    expect((await m.json(`/api/shipping/${r.data.id}`, { method: "PATCH", body: { revision: 1, notes: "late" } })).status).toBe(409);
    expect(s.data.history.length).toBeGreaterThanOrEqual(2);
  });

  it("receiving checks items in a bit at a time, notes where they went and any problem", async () => {
    const olivia = await person("scheduling");
    const r = await olivia.json("/api/shipping", { body: incoming() });
    expect(r.data.number).toMatch(new RegExp(`^RC-${year}-\\d{4}$`));
    let s = await olivia.json(`/api/shipping/${r.data.id}`);
    expect(s.data.shipment.status).toBe("expected");
    const [kit, clutch] = s.data.lines;
    const a = await olivia.json(`/api/shipping/${r.data.id}/receive`, { body: { revision: s.data.shipment.revision, lines: [{ id: kit.id, qty: 6, bin: "Shelf B3" }], problem: "short", problem_note: "Only 6 kits in the crate" } });
    expect(a.status).toBe(200);
    s = await olivia.json(`/api/shipping/${r.data.id}`);
    expect(s.data.shipment).toMatchObject({ status: "partly_received", problem: "short", problem_note: "Only 6 kits in the crate" });
    expect(s.data.shipment.shipped_date).toBe(new Date().toISOString().slice(0, 10)); // arrived today
    expect(s.data.lines[0]).toMatchObject({ qty_received: 6, bin: "Shelf B3" });
    // Receiving more than was expected is refused unless it's noted as extra.
    expect((await olivia.json(`/api/shipping/${r.data.id}/receive`, { body: { revision: s.data.shipment.revision, lines: [{ id: clutch.id, qty: 5 }] } })).status).toBe(400);
    await olivia.json(`/api/shipping/${r.data.id}/receive`, { body: { revision: s.data.shipment.revision, lines: [{ id: kit.id, qty: 4 }, { id: clutch.id, qty: 2, bin: "Cage 1" }] } });
    s = await olivia.json(`/api/shipping/${r.data.id}`);
    expect(s.data.shipment.status).toBe("received");
    expect(s.data.shipment.done_date).toBe(new Date().toISOString().slice(0, 10));
    expect(s.data.lines.map((l: any) => l.qty_received)).toEqual([10, 2]);
    // Outgoing shipments aren't received.
    const out = await olivia.json("/api/shipping", { body: outgoing() });
    expect((await olivia.json(`/api/shipping/${out.data.id}/receive`, { body: { revision: 1, lines: [] } })).status).toBe(400);
  });

  it("keeps the Italy details (mode, vessel, container, broker) and puts doubtful parts on quality hold", async () => {
    const m = await person("scheduling");
    const r = await m.json("/api/shipping", { body: incoming({ mode: "ocean", vessel: "MSC Aurora 2251W", container: "MSCU1234567", broker: "Example Customs", bol_number: "MEDU8877" }) });
    expect((await m.json("/api/shipping", { body: incoming({ mode: "rocket" }) })).status).toBe(400);
    let s = await m.json(`/api/shipping/${r.data.id}`);
    expect(s.data.shipment).toMatchObject({ mode: "ocean", vessel: "MSC Aurora 2251W", container: "MSCU1234567", broker: "Example Customs", bol_number: "MEDU8877" });
    const [kit] = s.data.lines;
    await m.json(`/api/shipping/${r.data.id}/receive`, { body: { revision: s.data.shipment.revision, lines: [{ id: kit.id, qty: 10, hold: true, hold_note: "Seals look cracked, ask Italy" }] } });
    s = await m.json(`/api/shipping/${r.data.id}`);
    expect(s.data.lines[0]).toMatchObject({ hold: 1, hold_note: "Seals look cracked, ask Italy" });
    const held = await m.json("/api/shipping?view=hold");
    expect(held.data.shipments.map((x: any) => x.id)).toContain(r.data.id);
    expect(held.data.counts.hold).toBeGreaterThan(0);
    // Clearing the hold
    const c = await m.json(`/api/shipping/${r.data.id}/lines/${kit.id}/hold`, { body: { revision: s.data.shipment.revision, hold: false } });
    expect(c.status).toBe(200);
    s = await m.json(`/api/shipping/${r.data.id}`);
    expect(s.data.lines[0].hold).toBe(0);
  });

  it("lists open work, and finds shipments by text, machine or what they're for", async () => {
    const m = await person("scheduling");
    const party = `Findme ${crypto.randomUUID().slice(0, 6)}`;
    const a = await m.json("/api/shipping", { body: outgoing({ party, machine: "4999XX" }) });
    await m.json("/api/shipping", { body: incoming({ party }) });
    const list = await m.json(`/api/shipping?q=${encodeURIComponent(party)}`);
    expect(list.data.shipments).toHaveLength(2);
    const outs = await m.json(`/api/shipping?direction=out&q=${encodeURIComponent(party)}`);
    expect(outs.data.shipments.map((s: any) => s.id)).toEqual([a.data.id]);
    expect(outs.data.shipments[0]).toMatchObject({ pieces: 2, lines: 2 });
    const byMachine = await m.json("/api/shipping?machine=4999xx");
    expect(byMachine.data.shipments.map((s: any) => s.id)).toEqual([a.data.id]);
    expect(list.data.counts).toMatchObject({ to_pack: expect.any(Number), expected: expect.any(Number) });
  });

  it("ties a shipment to a change-part order: shipping it fills the order's ship date and status", async () => {
    const sales = await person("sales");
    const o = await sales.json("/api/change-parts", { body: { customer: "Acme Bottling", machine: "4110MB", part: "38mm star wheel set", status: "Ready to ship" } });
    const pre = await sales.json(`/api/shipping/prefill?source=cp_order&id=${o.data.id}`);
    expect(pre.data).toMatchObject({ party: "Acme Bottling", machine: "4110MB", kind: "change_parts" });
    expect(pre.data.lines[0].description).toBe("38mm star wheel set");
    const r = await sales.json("/api/shipping", { body: outgoing({ ...pre.data, source_type: "cp_order", source_id: o.data.id }) });
    expect(r.status).toBe(200);
    await sales.json(`/api/shipping/${r.data.id}`, { method: "PATCH", body: { revision: 1, status: "shipped" } });
    const order = await sales.json(`/api/change-parts/${o.data.id}`);
    expect(order.data.order).toMatchObject({ status: "Shipped to customer", ship_date: new Date().toISOString().slice(0, 10) });
    const linked = await sales.json(`/api/shipping?link=cp_order:${o.data.id}`);
    expect(linked.data.shipments.map((s: any) => s.id)).toEqual([r.data.id]);
 
    // A later step (waiting on the customer's approval) isn't pulled back when another box ships.
    const cur = (await sales.json(`/api/change-parts/${o.data.id}`)).data.order;
    expect((await sales.json(`/api/change-parts/${o.data.id}`, { method: "PATCH", body: { revision: cur.revision, status: "Waiting on customer approval" } })).status).toBe(200);
    const r2 = await sales.json("/api/shipping", { body: outgoing({ ...pre.data, status: "shipped", source_type: "cp_order", source_id: o.data.id }) });
    expect(r2.status).toBe(200);
    expect((await sales.json(`/api/change-parts/${o.data.id}`)).data.order.status).toBe("Waiting on customer approval");
  });

  it("receiving a customer's sample bottles for a change-part order fills 'samples received'", async () => {
    const sales = await person("sales");
    const o = await sales.json("/api/change-parts", { body: { customer: "Acme Bottling", part: "Trigger cap chuck" } });
    const r = await sales.json("/api/shipping", { body: incoming({ kind: "samples", party: "Acme Bottling", source_type: "cp_order", source_id: o.data.id, lines: [{ description: "Sample bottles 500 ml", qty: 24 }] }) });
    const s = await sales.json(`/api/shipping/${r.data.id}`);
    await sales.json(`/api/shipping/${r.data.id}/receive`, { body: { revision: s.data.shipment.revision, lines: [{ id: s.data.lines[0].id, qty: 24 }] } });
    const order = await sales.json(`/api/change-parts/${o.data.id}`);
    expect(order.data.order.samples_received).toBe(new Date().toISOString().slice(0, 10));
  });

  it("prefills from a job (customer, machine, site address and contact) and refuses links to things that don't exist", async () => {
    const meagan = await person("scheduling");
    const job = await meagan.json("/api/jobs", { body: { job_number: `J-${crypto.randomUUID().slice(0, 6)}`, customer: "Example Foods", machine: "4222TP", location: "1200 Example Pkwy, Atlanta, GA", contact_name: "Lee", contact_phone: "555", work_days: [] } });
    const pre = await meagan.json(`/api/shipping/prefill?source=job&id=${job.data.id}`);
    expect(pre.data).toMatchObject({ party: "Example Foods", machine: "4222TP", address: "1200 Example Pkwy, Atlanta, GA", contact_name: "Lee" });
    expect((await meagan.json("/api/shipping/prefill?source=job&id=nope")).status).toBe(404);
    expect((await meagan.json("/api/shipping", { body: outgoing({ source_type: "job", source_id: "nope" }) })).status).toBe(400);
  });

  it("only fills in from an order or job the person may see", async () => {
    const sales = await person("sales");
    const meagan = await person("scheduling"); // can ship, but can't see change-part orders
    const o = await sales.json("/api/change-parts", { body: { customer: "Secret Bottling", part: "Neck guide" } });
    expect((await meagan.json(`/api/shipping/prefill?source=cp_order&id=${o.data.id}`)).status).toBe(403);
    const r = await sales.json("/api/shipping", { body: outgoing({ source_type: "cp_order", source_id: o.data.id }) });
    const tech = await person("tech");
    const s = await tech.json(`/api/shipping/${r.data.id}`);
    expect(s.data.source).toMatchObject({ type: "cp_order", open: false, label: null });
  });

  it("won't check items into a cancelled receipt, and a hold needs the current revision", async () => {
    const m = await person("scheduling");
    const r = await m.json("/api/shipping", { body: incoming() });
    let s = await m.json(`/api/shipping/${r.data.id}`);
    const line = s.data.lines[0];
    expect((await m.json(`/api/shipping/${r.data.id}/lines/${line.id}/hold`, { body: { revision: 99, hold: true } })).status).toBe(409);
    expect((await m.json(`/api/shipping/${r.data.id}/lines/${line.id}/hold`, { body: { revision: s.data.shipment.revision, hold: true } })).status).toBe(200);
    s = await m.json(`/api/shipping/${r.data.id}`);
    await m.json(`/api/shipping/${r.data.id}`, { method: "PATCH", body: { revision: s.data.shipment.revision, status: "cancelled" } });
    s = await m.json(`/api/shipping/${r.data.id}`);
    expect((await m.json(`/api/shipping/${r.data.id}/receive`, { body: { revision: s.data.shipment.revision, lines: [{ id: line.id, qty: 1 }] } })).status).toBe(400);
    // Outgoing items can't go on quality hold.
    const out = await m.json("/api/shipping", { body: outgoing() });
    const o = await m.json(`/api/shipping/${out.data.id}`);
    expect((await m.json(`/api/shipping/${out.data.id}/lines/${o.data.lines[0].id}/hold`, { body: { revision: 1, hold: true } })).status).toBe(400);
  });

  it("keeps a new order of the items", async () => {
    const m = await person("scheduling");
    const r = await m.json("/api/shipping", { body: outgoing() });
    const s = await m.json(`/api/shipping/${r.data.id}`);
    await m.json(`/api/shipping/${r.data.id}`, { method: "PATCH", body: { revision: 1, lines: [...s.data.lines].reverse() } });
    const after = await m.json(`/api/shipping/${r.data.id}`);
    expect(after.data.lines.map((l: any) => l.part_code)).toEqual(["R-2210", "R-10442"]);
  });

  it("keeps the ship-from address of the last outgoing shipment for the next one", async () => {
    const m = await person("scheduling");
    await m.json("/api/shipping", { body: outgoing({ origin: "Ronchi America\nDock 2" }) });
    const d = await m.json("/api/shipping/prefill");
    expect(d.data.origin).toBe("Ronchi America\nDock 2");
  });

  it("takes photos and papers, and an editor can remove a shipment (kept for the record)", async () => {
    const m = await person("scheduling");
    const r = await m.json("/api/shipping", { body: outgoing() });
    const form = new FormData();
    form.append("files", new File(["%PDF-1.4 signed bol"], "Signed BOL.pdf", { type: "application/pdf" }));
    const up = await m.form(`/api/shipping/${r.data.id}/files`, form);
    expect(up.status).toBe(200);
    const s = await m.json(`/api/shipping/${r.data.id}`);
    expect(s.data.files.map((f: any) => f.name)).toEqual(["Signed BOL.pdf"]);
    const file = await m.fetch(`/api/shipping/files/${s.data.files[0].id}`);
    expect(file.status).toBe(200);
    expect((await m.json(`/api/shipping/${r.data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await m.json(`/api/shipping/${r.data.id}`)).status).toBe(404);
  });

  it("goes away for everyone but admins when the section is switched off", async () => {
    const admin = await person("admin");
    const m = await person("scheduling");
    await admin.json("/api/settings", { method: "PUT", body: { sections: { shipping: false } } });
    try {
      expect((await m.json("/api/shipping")).status).toBe(403);
      expect((await admin.json("/api/shipping")).status).toBe(200);
    } finally {
      await admin.json("/api/settings", { method: "PUT", body: { sections: { shipping: true } } });
    }
  });

  it("writes every change to the activity log", async () => {
    const m = await person("scheduling");
    const r = await m.json("/api/shipping", { body: outgoing() });
    const { results } = await env.DB.prepare("SELECT action FROM audit_log WHERE target_type = 'shipment' AND target_id = ?").bind(r.data.id).all();
    expect(results.map((x: any) => x.action)).toEqual(["shipment.create"]);
  });
});

describe("linking a shipment to an order", () => {
  it("needs permission to see that kind of order", async () => {
    const sales = await person("sales");
    const cp = await sales.json("/api/change-parts", { body: { customer: "Acme", part: "Star wheels", status: "Ready to ship" } });
    expect(cp.status, JSON.stringify(cp.data)).toBe(200);
    const body = { direction: "out", kind: "change_parts", party: "Acme", source_type: "cp_order", source_id: cp.data.id, status: "shipped", lines: [{ description: "Star wheels", qty: 1 }] };
    // Service ships things but can't see change-part orders, so it can't tie a shipment to one.
    const service = await person("service");
    expect((await service.json("/api/shipping", { body })).status).toBe(403);
    expect((await sales.json("/api/shipping", { body })).status).toBe(200);
  });
});

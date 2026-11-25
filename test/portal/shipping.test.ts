import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { forgetSettings } from "../../src/portal/lib/settings-store";
import { templateProblem, trackingHint, trackingUrl } from "../../src/shared/shipping";
import { person } from "./helpers";

type P = Awaited<ReturnType<typeof person>>;

afterEach(async () => {
  await env.DB.prepare("DELETE FROM settings").run();
  forgetSettings();
});

/** A booked parts order with two lines: 2 star wheels and 10 gripper pad kits. */
async function bookedOrder(p: P) {
  const q = await p.json("/api/parts-orders", { body: { customer: "Example Pharma Co.", lines: [{ part_code: "R-10442", qty: 2 }, { part_code: "R-20871", qty: 10, backorder: true }] } });
  const o = (await p.json(`/api/parts-orders/${q.data.id}`)).data;
  const r = await p.json(`/api/parts-orders/${q.data.id}/status`, { body: { revision: o.order.revision, to: "booked", customer_po: "PO-555", promised_date: "2026-12-01" } });
  expect(r.status).toBe(200);
  return { id: q.data.id as string, lines: o.lines as { id: string; part_code: string }[] };
}
const order = async (p: P, id: string) => (await p.json(`/api/parts-orders/${id}`)).data;
async function outMove(p: P, id: string, to: string) {
  const s = (await p.json(`/api/shipping/outbound/${id}`)).data.outbound;
  return p.json(`/api/shipping/outbound/${id}/status`, { body: { revision: s.revision, to } });
}
async function outEdit(p: P, id: string, fields: Record<string, unknown>) {
  const s = (await p.json(`/api/shipping/outbound/${id}`)).data.outbound;
  return p.json(`/api/shipping/outbound/${id}`, { method: "PATCH", body: { revision: s.revision, ...fields } });
}

describe("tracking links", () => {
  it("builds the carrier's tracking page from its template", () => {
    expect(trackingUrl("https://www.ups.com/track?tracknum={n}", " 1Z999AA1 0123456784 ")).toBe("https://www.ups.com/track?tracknum=1Z999AA10123456784");
    expect(trackingUrl("https://www.fedex.com/fedextrack/?trknbr={n}", "123456789012")).toBe("https://www.fedex.com/fedextrack/?trknbr=123456789012");
    expect(trackingUrl("https://example.com/t/{n}", "A&B/1")).toBe("https://example.com/t/A%26B%2F1");
    expect(trackingUrl(null, "123")).toBeNull();
    expect(trackingUrl("https://www.ups.com/track?tracknum={n}", "")).toBeNull();
    expect(trackingUrl("javascript:alert(1)//{n}", "1")).toBeNull();
  });

  it("refuses templates that aren't https or have no place for the number", () => {
    expect(templateProblem("https://www.ups.com/track?tracknum={n}")).toBeNull();
    expect(templateProblem("http://www.ups.com/track?tracknum={n}")).toMatch(/https/);
    expect(templateProblem("https://www.ups.com/track")).toMatch(/\{n\}/);
    expect(templateProblem("javascript:alert({n})")).toMatch(/https/);
  });

  it("warns (never blocks) when a number doesn't look like the carrier's", () => {
    expect(trackingHint("ups", "1Z999AA10123456784")).toBeNull();
    expect(trackingHint("ups", "123")).toMatch(/Check it/);
    expect(trackingHint("usps", "9400111899223817123456")).toBeNull();
    expect(trackingHint("odfl", "anything")).toBeNull();
  });

  it("the carriers list comes with UPS, FedEx, USPS and DHL checked, and the LTL links marked to check", async () => {
    const tech = await person("tech");
    const { data } = await tech.json("/api/shipping/carriers");
    const by = Object.fromEntries(data.carriers.map((c: any) => [c.id, c]));
    for (const id of ["ups", "fedex", "usps", "dhl"]) expect(by[id].checked, id).toBe(1);
    for (const id of ["odfl", "estes", "saia", "rl", "abf"]) expect(by[id].checked, id).toBe(0);
  });

  it("staff who ship can fix a carrier's link (a changed link needs checking again); others can't", async () => {
    const tech = await person("tech");
    expect((await tech.fetch("/api/shipping/carriers/saia", { method: "PATCH", body: { checked: true } })).status).toBe(403);
    const sales = await person("sales");
    expect((await sales.fetch("/api/shipping/carriers/saia", { method: "PATCH", body: { url_template: "http://saia.com/{n}" } })).status).toBe(400);
    expect((await sales.json("/api/shipping/carriers/saia", { method: "PATCH", body: { checked: true } })).status).toBe(200);
    expect((await sales.json("/api/shipping/carriers/saia", { method: "PATCH", body: { url_template: "https://www.saia.com/track/details;pro={n}&x=1" } })).status).toBe(200);
    const saia = (await sales.json("/api/shipping/carriers")).data.carriers.find((c: any) => c.id === "saia");
    expect(saia).toMatchObject({ checked: 0, url_template: "https://www.saia.com/track/details;pro={n}&x=1" });
  });
});

describe("shipping a parts order", () => {
  it("a partial shipment moves the order's shipped quantities and status only once it's marked shipped; the rest stays backordered", async () => {
    const sales = await person("sales");
    const o = await bookedOrder(sales);
    const ship = await sales.json("/api/shipping/outbound", { body: { source: "parts_order", po_order_id: o.id, carrier_id: "ups", lines: [{ po_line_id: o.lines[0]!.id, qty: 2 }, { po_line_id: o.lines[1]!.id, qty: 4 }] } });
    expect(ship.status, JSON.stringify(ship.data)).toBe(200);
    expect(ship.data.number).toMatch(/^OUT-\d{4}-\d{4}$/);
    // Packed but not shipped: nothing counts as shipped yet, but it can't be put on a second shipment.
    let d = await order(sales, o.id);
    expect(d.order.shown).toBe("Booked");
    expect(d.lines.map((l: any) => [l.shipped, l.allocated])).toEqual([[0, 2], [0, 4]]);
    expect((await sales.fetch("/api/shipping/outbound", { body: { source: "parts_order", po_order_id: o.id, lines: [{ po_line_id: o.lines[0]!.id, qty: 1 }] } })).status).toBe(400);
    // No tracking number yet: can't be marked shipped.
    expect((await outMove(sales, ship.data.id, "shipped")).status).toBe(400);
    expect((await outEdit(sales, ship.data.id, { tracking: "1Z999AA10123456784", boxes: 2, weight_lb: "14.5" })).status).toBe(200);
    expect((await outMove(sales, ship.data.id, "shipped")).status).toBe(200);
    d = await order(sales, o.id);
    expect(d.order.shown).toBe("Partially shipped");
    expect(d.lines.map((l: any) => [l.part_code, l.shipped, l.remaining, l.backordered])).toEqual([["R-10442", 2, 0, false], ["R-20871", 4, 6, true]]);
    expect(d.shipments).toHaveLength(1);
    expect(d.shipments[0]).toMatchObject({ status: "shipped", tracking: "1Z999AA10123456784", tracking_url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" });
    expect(d.history.map((h: any) => h.action)).toContain("po.shipment.status");
    expect((await sales.json(`/api/parts-orders/${o.id}/status`, { body: { revision: d.order.revision, to: "closed" } })).status).toBe(409); // not all shipped
    expect((await sales.json(`/api/parts-orders/${o.id}/status`, { body: { revision: d.order.revision, to: "cancelled", reason: "x" } })).status).toBe(409); // some shipped

    // Ship the rest: the order is shipped, and can then be closed.
    const rest = await sales.json("/api/shipping/outbound", { body: { source: "parts_order", po_order_id: o.id, carrier_id: "pickup", lines: [{ po_line_id: o.lines[1]!.id, qty: 6 }] } });
    expect((await sales.json(`/api/shipping/outbound`, { body: { source: "parts_order", po_order_id: o.id, lines: [{ po_line_id: o.lines[1]!.id, qty: 1 }] } })).status).toBe(400); // nothing left
    expect((await outMove(sales, rest.data.id, "shipped")).status).toBe(200); // customer pickup needs no tracking
    d = await order(sales, o.id);
    expect(d.order.shown).toBe("Shipped");
    expect(d.order.shipped_on).toBe(new Date().toISOString().slice(0, 10));
    expect(d.lines.every((l: any) => !l.backordered)).toBe(true);
    expect((await sales.json(`/api/parts-orders/${o.id}/status`, { body: { revision: d.order.revision, to: "closed" } })).status).toBe(200);
  });

  it("can't ship more than is left on a line, or ship a quote", async () => {
    const sales = await person("sales");
    const o = await bookedOrder(sales);
    expect((await sales.fetch("/api/shipping/outbound", { body: { source: "parts_order", po_order_id: o.id, lines: [{ po_line_id: o.lines[0]!.id, qty: 3 }] } })).status).toBe(400);
    const q = await sales.json("/api/parts-orders", { body: { customer: "Q Co", lines: [{ part_code: "R-1", qty: 1 }] } });
    const ql = (await order(sales, q.data.id)).lines[0];
    expect((await sales.fetch("/api/shipping/outbound", { body: { source: "parts_order", po_order_id: q.data.id, lines: [{ po_line_id: ql.id, qty: 1 }] } })).status).toBe(409);
  });

  it("a cancelled shipment frees its quantities again", async () => {
    const sales = await person("sales");
    const o = await bookedOrder(sales);
    const s = await sales.json("/api/shipping/outbound", { body: { source: "parts_order", po_order_id: o.id, lines: [{ po_line_id: o.lines[0]!.id, qty: 2 }] } });
    expect((await outMove(sales, s.data.id, "cancelled")).status).toBe(200);
    expect((await order(sales, o.id)).lines[0]).toMatchObject({ shipped: 0, allocated: 0 });
    expect((await outMove(sales, s.data.id, "packed")).status).toBe(409);
  });

  it("change-part orders and anything else can be shipped with typed lines", async () => {
    const sales = await person("sales");
    const cp = await sales.json("/api/change-parts", { body: { customer: "Example Home Care", part: "Trigger sprayer cap chuck set" } });
    const s = await sales.json("/api/shipping/outbound", { body: { source: "change_part", cp_order_id: cp.data.id, carrier_id: "fedex", lines: [{ description: "Cap chuck set", qty: 1 }] } });
    expect(s.status).toBe(200);
    const d = (await sales.json(`/api/shipping/outbound/${s.data.id}`)).data;
    expect(d.outbound.customer).toBe("Example Home Care");
    expect(d.changePart.id).toBe(cp.data.id);
    expect((await sales.fetch("/api/shipping/outbound", { body: { source: "other", lines: [{ description: "Manual", qty: 1 }] } })).status).toBe(400); // who to
    expect((await sales.json("/api/shipping/outbound", { body: { source: "other", customer: "Ronchi Italy", lines: [{ description: "Returned motor", qty: 1 }] } })).status).toBe(200);
  });
});

describe("receiving", () => {
  async function incoming(p: P) {
    const r = await p.json("/api/shipping/inbound", { body: { supplier: "Ronchi Mario S.p.A.", reference: "IT-ORD-3391", mode: "air", carrier_id: "dhl", tracking: "1234567890", expected_date: "2026-12-03", lines: [{ part_code: "R-10442", qty: 6 }, { part_code: "R-20871", qty: 20 }] } });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    return r.data.id as string;
  }

  it("receives in parts: the rest stays open until it all arrives; damage and extras are written down", async () => {
    const billing = await person("billing");
    const id = await incoming(billing);
    let d = (await billing.json(`/api/shipping/inbound/${id}`)).data;
    expect(d.inbound).toMatchObject({ shown: "Expected", tracking_url: "https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=1234567890" });
    const [a, b] = d.lines;
    const first = await billing.json(`/api/shipping/inbound/${id}/receive`, { body: { lines: [{ line_id: a.id, qty: 5, damaged: 1, bin: "a-03-2" }, { line_id: b.id, qty: 8 }], note: "Crate corner crushed" } });
    expect(first.data).toMatchObject({ ok: true, received: false, issues: 1 });
    d = (await billing.json(`/api/shipping/inbound/${id}`)).data;
    expect(d.inbound.shown).toBe("Partly received");
    expect(d.lines.map((l: any) => [l.qty_received, l.open, l.bin])).toEqual([[6, 0, "A-03-2"], [8, 12, null]]);
    expect(d.issues).toEqual([expect.objectContaining({ kind: "damaged", qty: 1, status: "open", note: "Crate corner crushed" })]);
    const second = await billing.json(`/api/shipping/inbound/${id}/receive`, { body: { lines: [{ line_id: b.id, qty: 13, bin: "B-01" }] } });
    expect(second.data).toMatchObject({ received: true, issues: 1 }); // one over
    d = (await billing.json(`/api/shipping/inbound/${id}`)).data;
    expect(d.inbound.shown).toBe("Received");
    expect(d.issues.map((s: any) => [s.kind, s.qty])).toContainEqual(["over", 1]);
    const issue = d.issues.find((s: any) => s.kind === "damaged");
    expect((await billing.fetch(`/api/shipping/issues/${issue.id}`, { method: "PATCH", body: { status: "resolved" } })).status).toBe(400);
    expect((await billing.json(`/api/shipping/issues/${issue.id}`, { method: "PATCH", body: { status: "resolved", resolution: "Claim filed with DHL" } })).status).toBe(200);
    expect(d.history.map((h: any) => h.action).filter((a: string) => a === "inbound.receive")).toHaveLength(2);
  });

  it("damage photos are kept with the problem; only safe file types up to 25 MB", async () => {
    const sales = await person("sales");
    const id = await incoming(sales);
    const d = (await sales.json(`/api/shipping/inbound/${id}`)).data;
    const issue = await sales.json(`/api/shipping/inbound/${id}/issues`, { body: { kind: "damaged", line_id: d.lines[0].id, qty: 1, note: "Bent flange" } });
    const form = new FormData();
    form.append("files", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "flange.jpg", { type: "image/jpeg" }));
    form.append("issueId", issue.data.id);
    const up = await sales.form(`/api/shipping/inbound/${id}/files`, form);
    expect(up.status).toBe(200);
    const fileId = ((await up.json()) as any).ids[0];
    const got = await sales.fetch(`/api/shipping/files/${fileId}`);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
    const bad = new FormData();
    bad.append("files", new File(["<script>"], "x.html", { type: "text/html" }));
    expect((await sales.form(`/api/shipping/inbound/${id}/files`, bad)).status).toBe(400);
    const files = (await sales.json(`/api/shipping/inbound/${id}`)).data.files;
    expect(files[0]).toMatchObject({ name: "flange.jpg", issue_id: issue.data.id });
  });

  it("a field service engineer can look but not receive, ship or change anything", async () => {
    const sales = await person("sales");
    const id = await incoming(sales);
    const tech = await person("tech");
    expect((await tech.fetch("/api/shipping")).status).toBe(200);
    expect((await tech.fetch(`/api/shipping/inbound/${id}`)).status).toBe(200);
    const line = (await tech.json(`/api/shipping/inbound/${id}`)).data.lines[0];
    expect((await tech.fetch(`/api/shipping/inbound/${id}/receive`, { body: { lines: [{ line_id: line.id, qty: 1 }] } })).status).toBe(403);
    expect((await tech.fetch("/api/shipping/inbound", { body: { supplier: "X" } })).status).toBe(403);
    expect((await tech.fetch("/api/shipping/outbound", { body: { source: "other", customer: "X", lines: [{ description: "x", qty: 1 }] } })).status).toBe(403);
    expect((await tech.fetch("/api/shipping/sources")).status).toBe(403);
  });

  it("switching Shipping off in the command center closes it to everyone but admins", async () => {
    const admin = await person("admin");
    const sales = await person("sales");
    await admin.json("/api/settings", { method: "PUT", body: { sections: { shipping: false } } });
    expect((await sales.fetch("/api/shipping")).status).toBe(403);
    expect((await admin.fetch("/api/shipping")).status).toBe(200);
  });
});

describe("the shipping dashboard", () => {
  it("counts arriving this week, late, to ship today, shipped this week and in transit", async () => {
    const sales = await person("sales");
    const before = (await sales.json("/api/shipping")).data.kpis;
    const today = new Date().toISOString().slice(0, 10);
    await sales.json("/api/shipping/inbound", { body: { supplier: "Ronchi Italy", expected_date: today, lines: [{ part_code: "R-1", qty: 1 }] } });
    await sales.json("/api/shipping/inbound", { body: { supplier: "Ronchi Italy", expected_date: "2020-01-01", lines: [{ part_code: "R-1", qty: 1 }] } });
    const toShip = await sales.json("/api/shipping/outbound", { body: { source: "other", customer: "A", lines: [{ description: "x", qty: 1 }] } });
    const shipped = await sales.json("/api/shipping/outbound", { body: { source: "other", customer: "B", carrier_id: "usps", tracking: "9400111899223817123456", lines: [{ description: "y", qty: 1 }] } });
    await outMove(sales, shipped.data.id, "shipped");
    const k = (await sales.json("/api/shipping")).data.kpis;
    expect(k.arrivingThisWeek - before.arrivingThisWeek).toBe(1);
    expect(k.lateInbound - before.lateInbound).toBe(1);
    expect(k.toShipToday - before.toShipToday).toBe(1);
    expect(k.shippedThisWeek - before.shippedThisWeek).toBe(1);
    expect(k.inTransit - before.inTransit).toBe(1);
    expect(toShip.status).toBe(200);
  });

  it("exports incoming and outgoing shipments as CSV", async () => {
    const sales = await person("sales");
    await sales.json("/api/shipping/inbound", { body: { supplier: "Ronchi Italy", lines: [{ part_code: "R-77", qty: 3 }] } });
    const inCsv = await (await sales.fetch("/api/shipping/export?kind=in")).text();
    expect(inCsv.split("\r\n")[0]).toContain("Qty received");
    expect(inCsv).toContain("R-77");
    const outCsv = await (await sales.fetch("/api/shipping/export?kind=out")).text();
    expect(outCsv.split("\r\n")[0]).toContain("Tracking");
    expect(outCsv.split("\r\n")[0]).not.toMatch(/price|cost|value|charge/i);
  });
});

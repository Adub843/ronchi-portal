import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Browser, person } from "./helpers";
import { connectPartsSite } from "./parts-site";

const LINES = [
  { part_code: "R10-2231", description: "O-ring kit, filling valve", qty: 12, unit_price: 18.5, unit_cost: 9, supplier: "Ronchi Mario (Italy)", supplier_po: "RA-PO-771", eta: "2026-12-04" },
  { part_code: "R44-0910", description: "Capping clutch", qty: 2, unit_price: 640, unit_cost: 410, supplier: "Our stock" },
];
const ORDER = { customer: "Acme Labs", machine: "4222tp", customer_po: "PO-5531", priority: "machine_down", promised: "2026-12-10", discount_pct: 10, freight: 85, lines: LINES };

async function adminWith(sections: Record<string, boolean>) {
  const admin = await person("admin");
  const cur = await admin.json("/api/settings");
  const r = await admin.json("/api/settings", { method: "PUT", body: { ...cur.data.settings, sections: { ...cur.data.settings.sections, ...sections } } });
  expect(r.status).toBe(200);
  return admin;
}

describe("parts orders", () => {
  it("sales, managers, scheduling and billing work with orders; field service engineers and engineering can't reach them", async () => {
    const sales = await person("sales");
    const r = await sales.json("/api/parts-orders", { body: ORDER });
    expect(r.status).toBe(200);
    expect(r.data.number).toMatch(/^P-\d{4,}$/);
    for (const role of ["manager", "scheduling", "billing", "admin"]) {
      expect((await (await person(role)).fetch(`/api/parts-orders/${r.data.id}`)).status, role).toBe(200);
    }
    for (const role of ["tech", "engineering", "service"]) {
      const p = await person(role);
      expect((await p.fetch("/api/parts-orders")).status, role).toBe(403);
      expect((await p.fetch(`/api/parts-orders/${r.data.id}`)).status, role).toBe(403);
      expect((await p.fetch("/api/parts-orders", { body: ORDER })).status, role).toBe(403);
    }
    expect((await new Browser().fetch("/api/parts-orders")).status).toBe(401);
  });

  it("numbers orders in turn, keeps the lines in order and works out the totals", async () => {
    const sales = await person("sales");
    const a = await sales.json("/api/parts-orders", { body: ORDER });
    const b = await sales.json("/api/parts-orders", { body: { customer: "Beta Foods" } });
    expect(Number(b.data.number.slice(2))).toBe(Number(a.data.number.slice(2)) + 1);
    const { data } = await sales.json(`/api/parts-orders/${a.data.id}`);
    expect(data.order).toMatchObject({ customer: "Acme Labs", machine: "4222TP", status: "inquiry", priority: "machine_down", open: true });
    expect(data.lines.map((l: any) => l.part_code)).toEqual(["R10-2231", "R44-0910"]);
    // 12 x 18.50 + 2 x 640 = 1502; less 10% = 1351.80; plus 85 freight.
    expect(data.totals).toMatchObject({ parts: 1502, discount: 150.2, total: 1436.8, margin: 423.8 }); // 1351.80 less cost 12 x 9 + 2 x 410
    const list = await sales.json("/api/parts-orders");
    const row = list.data.orders.find((o: any) => o.id === a.data.id);
    expect(row).toMatchObject({ lines: 2, total: 1436.8, received: 1 }); // the stock line counts as here
  });

  it("checks what is typed", async () => {
    const sales = await person("sales");
    expect((await sales.fetch("/api/parts-orders", { body: { machine: "4222TP" } })).status).toBe(400);
    expect((await sales.fetch("/api/parts-orders", { body: { customer: "A", status: "maybe" } })).status).toBe(400);
    expect((await sales.fetch("/api/parts-orders", { body: { customer: "A", promised: "next week" } })).status).toBe(400);
    expect((await sales.fetch("/api/parts-orders", { body: { customer: "A", lines: [{ part_code: "X", qty: 0 }] } })).status).toBe(400);
    expect((await sales.fetch("/api/parts-orders", { body: { customer: "A", lines: [{ qty: 1 }] } })).status).toBe(400);
    expect((await sales.fetch("/api/parts-orders", { body: { customer: "A", lines: [{ part_code: "X", qty: 1, unit_price: -4 }] } })).status).toBe(400);
    expect((await sales.fetch("/api/parts-orders", { body: { customer: "A", notes: 5 } })).status).toBe(400);
  });

  it("hides prices from people who may not see them, and keeps the prices when they change the lines", async () => {
    const sales = await person("sales");
    const meagan = await person("scheduling");
    const { data: made } = await sales.json("/api/parts-orders", { body: ORDER });
    const seen = (await meagan.json(`/api/parts-orders/${made.id}`)).data;
    expect(seen.lines[0].unit_price).toBeUndefined();
    expect(seen.lines[0].unit_cost).toBeUndefined();
    expect(seen.totals).toBeNull();
    expect(seen.order.freight).toBeUndefined();
    expect((await meagan.json("/api/parts-orders")).data.orders.find((o: any) => o.id === made.id).total).toBeUndefined();
    // Meagan marks the Italian parts as arrived and adds a line; the prices stay as sales set them.
    const lines = seen.lines.map((l: any, i: number) => (i === 0 ? { ...l, qty_received: 12, unit_price: 0.01 } : l));
    const r = await meagan.json(`/api/parts-orders/${made.id}`, { method: "PATCH", body: { revision: seen.order.revision, lines: [...lines, { part_code: "R10-0001", qty: 1 }] } });
    expect(r.status).toBe(200);
    const after = (await sales.json(`/api/parts-orders/${made.id}`)).data;
    expect(after.lines.map((l: any) => [l.qty_received, l.unit_price])).toEqual([[12, 18.5], [0, 640], [0, null]]);
  });

  it("stamps each step for the reports, keeps a history and refuses a stale save", async () => {
    const andrew = await person("sales", { name: "Andrew" });
    const michele = await person("sales", { name: "Michele" });
    const { data } = await andrew.json("/api/parts-orders", { body: ORDER });
    const first = (await andrew.json(`/api/parts-orders/${data.id}`)).data.order;
    const ok = await michele.json(`/api/parts-orders/${data.id}`, { method: "PATCH", body: { revision: first.revision, status: "shipped", tracking: "1Z999" } });
    expect(ok.status).toBe(200);
    const stale = await andrew.fetch(`/api/parts-orders/${data.id}`, { method: "PATCH", body: { revision: first.revision, status: "lost" } });
    expect(stale.status).toBe(409);
    const page = (await andrew.json(`/api/parts-orders/${data.id}`)).data;
    expect(page.order).toMatchObject({ status: "shipped", updated_by_name: "Michele" });
    expect(page.order.quoted_at).toBeTruthy();
    expect(page.order.won_at).toBeTruthy();
    expect(page.order.shipped_at).toBeTruthy();
    expect(page.order.invoiced_at).toBeNull();
    expect(page.history[0]).toMatchObject({ action: "parts_order.update", who: "Michele", changes: { status: ["inquiry", "shipped"] } });
    expect(page.history.at(-1).action).toBe("parts_order.create");
  });

  it("repeats an order as a new inquiry with the same lines", async () => {
    const sales = await person("sales");
    const { data } = await sales.json("/api/parts-orders", { body: { ...ORDER, status: "closed" } });
    const copy = await sales.json(`/api/parts-orders/${data.id}/copy`, { body: {} });
    expect(copy.status).toBe(200);
    const page = (await sales.json(`/api/parts-orders/${copy.data.id}`)).data;
    expect(page.order).toMatchObject({ customer: "Acme Labs", status: "inquiry", customer_po: null, won_at: null });
    expect(page.lines.map((l: any) => [l.part_code, l.qty, l.qty_received, l.unit_price])).toEqual([["R10-2231", 12, 0, 18.5], ["R44-0910", 2, 0, 640]]);
  });

  it("removing an order hides it but keeps the record", async () => {
    const sales = await person("sales");
    const { data } = await sales.json("/api/parts-orders", { body: ORDER });
    expect((await (await person("scheduling")).fetch(`/api/parts-orders/${data.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await sales.fetch(`/api/parts-orders/${data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await sales.fetch(`/api/parts-orders/${data.id}`)).status).toBe(404);
  });

  it("shows on the machine's page", async () => {
    const admin = await person("admin");
    const m = await admin.json("/api/machines", { body: { serial: "4999TP", customer: "Acme Labs" } });
    await admin.json("/api/parts-orders", { body: { customer: "Acme Labs", machine: "4999tp" } });
    const page = await admin.json(`/api/machines/${m.data.id}`);
    expect(page.data.partsOrders).toHaveLength(1);
    expect((await (await person("tech")).json(`/api/machines/${m.data.id}`)).data.partsOrders).toBeUndefined();
  });

  it("reports sales by month, customer and part, and how long orders take", async () => {
    const sales = await person("sales");
    const { data } = await sales.json("/api/parts-orders", { body: { ...ORDER, customer: "Report Co", status: "ordered" } });
    const rep = await sales.json("/api/parts-orders/reports");
    expect(rep.status).toBe(200);
    const month = new Date().toISOString().slice(0, 7);
    expect(rep.data.byMonth.find((r: any) => r.month === month).total).toBeGreaterThanOrEqual(1436.8);
    expect(rep.data.byCustomer.find((r: any) => r.customer === "Report Co")).toMatchObject({ orders: 1, total: 1436.8 });
    expect(rep.data.topParts.some((p: any) => p.part_code === "R44-0910")).toBe(true);
    expect(rep.data.open).toBeGreaterThanOrEqual(1);
    expect((await (await person("scheduling")).fetch("/api/parts-orders/reports")).status).toBe(403);
    expect(data.id).toBeTruthy();
  });

  it("goes away completely when Aaron switches the section off, and comes back when on", async () => {
    const sales = await person("sales");
    const admin = await adminWith({ partsOrders: false });
    expect((await sales.fetch("/api/parts-orders")).status).toBe(403);
    expect((await admin.fetch("/api/parts-orders")).status).toBe(200);
    await adminWith({ partsOrders: true });
    expect((await sales.fetch("/api/parts-orders")).status).toBe(200);
  });

  it("makes an order from a customer's quote request, once", async () => {
    connectPartsSite();
    try {
      const db = env.TEST_PARTS_DB;
      const t = new Date().toISOString();
      const co = crypto.randomUUID(), us = crypto.randomUUID(), q = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, 'Quote Co', ?, ?)").bind(co, t, t),
        db.prepare("INSERT INTO users (id, company_id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, 'Pat Buyer', 'buyer', ?, ?)").bind(us, co, `pat-${us}@example.com`, t, t),
        db.prepare("INSERT INTO quotes (id, number, company_id, user_id, email, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pat@example.com', 'Line 2 is down', 'sent', ?, ?)").bind(q, `RQ-${q.slice(0, 8)}`, co, us, t, t),
        db.prepare("INSERT INTO lines (id, quote_id, code, description, qty, serial, note, created_at) VALUES (?, ?, 'R10-2231', '', 4, '4222TP', '', ?)").bind(crypto.randomUUID(), q, t),
        db.prepare("INSERT INTO lines (id, quote_id, code, description, qty, serial, note, created_at) VALUES (?, ?, NULL, 'Guide rail, left', 1, NULL, 'blue one', ?)").bind(crypto.randomUUID(), q, t),
      ]);
      const sales = await person("sales");
      const r = await sales.json(`/api/parts-orders/from-quote/${q}`, { body: {} });
      expect(r.status).toBe(200);
      const page = (await sales.json(`/api/parts-orders/${r.data.id}`)).data;
      expect(page.order).toMatchObject({ customer: "Quote Co", contact: "Pat Buyer", contact_email: "pat@example.com", machine: "4222TP", source: "parts_site", quote_request_no: `RQ-${q.slice(0, 8)}`, status: "inquiry" });
      expect(page.lines.map((l: any) => [l.part_code, l.description, l.qty])).toEqual([["R10-2231", null, 4], [null, "Guide rail, left", 1]]);
      const again = await sales.json(`/api/parts-orders/from-quote/${q}`, { body: {} });
      expect(again.data).toMatchObject({ id: r.data.id, existing: true });
      const quote = await db.prepare("SELECT status FROM quotes WHERE id = ?").bind(q).first<{ status: string }>();
      expect(quote!.status).toBe("received");
      // Scheduling can make orders but doesn't read quote requests.
      expect((await (await person("scheduling")).fetch(`/api/parts-orders/from-quote/${q}`, { body: {} })).status).toBe(403);
    } finally {
      connectPartsSite(false);
    }
  });

  it("counts what Shipping has shipped and received for each line, once that section exists", async () => {
    const sales = await person("sales");
    const { data } = await sales.json("/api/parts-orders", { body: ORDER });
    const page = (await sales.json(`/api/parts-orders/${data.id}`)).data;
    expect(page.shipments).toEqual([]);
    const [l1, l2] = page.lines;
    // The shipping tables (built in the Shipping work); made here in their shape if they aren't there yet.
    const db = env.DB;
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS shipments (id TEXT PRIMARY KEY, number TEXT, direction TEXT, status TEXT, carrier TEXT, tracking TEXT, source_type TEXT, source_id TEXT, removed_at TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS shipment_lines (id TEXT PRIMARY KEY, shipment_id TEXT, source_type TEXT, source_id TEXT, part_code TEXT, description TEXT, qty REAL, qty_received REAL)"),
    ]);
    const cols = async (t: string) => (await db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all<{ name: string }>()).results.map((r) => r.name);
    const put = async (t: string, row: Record<string, unknown>) => {
      const have = await cols(t);
      const keys = Object.keys(row).filter((k) => have.includes(k));
      await db.prepare(`INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...keys.map((k) => row[k])).run();
    };
    const t = new Date().toISOString();
    const base = { created_at: t, updated_at: t, revision: 1, customer: "Acme Labs", party: "Acme Labs" };
    await put("shipments", { ...base, id: "s-in", number: "R-1", direction: "in", status: "received", source_type: "parts_order", source_id: data.id });
    await put("shipment_lines", { id: "sl-1", shipment_id: "s-in", source_type: "parts_order_line", source_id: l1.id, part_code: l1.part_code, qty: 12, qty_received: 8, line_no: 1 });
    await put("shipments", { ...base, id: "s-out", number: "S-1", direction: "out", status: "shipped", carrier: "UPS", tracking: "1ZABC", source_type: "parts_order", source_id: data.id });
    await put("shipment_lines", { id: "sl-2", shipment_id: "s-out", source_type: "parts_order_line", source_id: l2.id, part_code: l2.part_code, qty: 2, qty_received: 0, line_no: 1 });
    const after = (await sales.json(`/api/parts-orders/${data.id}`)).data;
    expect(after.lines.map((l: any) => [l.qty_received, l.qty_shipped])).toEqual([[8, 0], [0, 2]]);
    expect(after.shipments.map((s: any) => s.number).sort()).toEqual(["R-1", "S-1"]);
  });
  it("moves the status on by itself as parts are ordered, arrive and ship, and never backwards", async () => {
    const sales = await person("sales");
    const { data } = await sales.json("/api/parts-orders", { body: { ...ORDER, status: "ordered" } });
    const get = async () => (await sales.json(`/api/parts-orders/${data.id}`)).data;
    const save = async (lines: any[]) => {
      const p = await get();
      const r = await sales.json(`/api/parts-orders/${data.id}`, { method: "PATCH", body: { revision: p.order.revision, lines } });
      expect(r.status).toBe(200);
      return get();
    };
    let p = await get();
    // The Italian line already has a supplier PO: the parts are ordered from the supplier.
    p = await save(p.lines);
    expect(p.order.status).toBe("sourcing");
    p = await save(p.lines.map((l: any) => ({ ...l, qty_received: l.qty })));
    expect(p.order.status).toBe("ready");
    p = await save(p.lines.map((l: any) => ({ ...l, qty_shipped: l.qty })));
    expect(p.order.status).toBe("shipped");
    expect(p.order.shipped_at).toBeTruthy();
    expect(p.history[0].changes.status).toEqual(["ready", "shipped"]);
    p = await save(p.lines.map((l: any) => ({ ...l, qty_shipped: 0 })));
    expect(p.order.status).toBe("shipped");
    // A quote never moves on by itself: the customer has to say yes first.
    const q = await sales.json("/api/parts-orders", { body: { ...ORDER, status: "quoted" } });
    const qp = (await sales.json(`/api/parts-orders/${q.data.id}`)).data;
    await sales.json(`/api/parts-orders/${q.data.id}`, { method: "PATCH", body: { revision: qp.order.revision, lines: qp.lines.map((l: any) => ({ ...l, qty_received: l.qty })) } });
    expect((await sales.json(`/api/parts-orders/${q.data.id}`)).data.order.status).toBe("quoted");
  });

  it("lists the parts still to order from each supplier", async () => {
    const sales = await person("sales");
    const { data } = await sales.json("/api/parts-orders", { body: { customer: "ToOrder Co", status: "ordered", lines: [
      { part_code: "R77-1", qty: 3, supplier: "Ronchi Mario (Italy)" },
      { part_code: "R77-2", qty: 1, supplier: "Ronchi Mario (Italy)", supplier_po: "RA-9" },
      { part_code: "R77-3", qty: 1, supplier: "Our stock" },
      { part_code: "R77-4", qty: 2, supplier: "Bearings Inc", drop_ship: true },
    ] } });
    await sales.json("/api/parts-orders", { body: { customer: "Still quoting", status: "quoted", lines: [{ part_code: "R77-9", qty: 1, supplier: "Ronchi Mario (Italy)" }] } });
    const r = await sales.json("/api/parts-orders/to-order");
    expect(r.status).toBe(200);
    const mine = r.data.lines.filter((l: any) => l.order_id === data.id);
    expect(mine.map((l: any) => [l.supplier, l.part_code, l.drop_ship])).toEqual([["Bearings Inc", "R77-4", 1], ["Ronchi Mario (Italy)", "R77-1", 0]]);
    expect(r.data.lines.some((l: any) => l.part_code === "R77-9")).toBe(false);
  });
});

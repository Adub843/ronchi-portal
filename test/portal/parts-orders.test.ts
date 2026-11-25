import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { forgetSettings } from "../../src/portal/lib/settings-store";
import { person } from "./helpers";
import { connectPartsSite } from "./parts-site";

const QUOTE = {
  customer: "Example Foods Inc.", contact: "Dana Smith", machine: "4222tp", follow_up: "2026-12-02",
  lines: [
    { part_code: "r-10442", description: "Star wheel, 500 ml", qty: 2 },
    { part_code: "R-20871", description: "Gripper pad kit", qty: 10 },
  ],
};

async function newQuote(p: Awaited<ReturnType<typeof person>>, extra: Record<string, unknown> = {}) {
  const r = await p.json("/api/parts-orders", { body: { ...QUOTE, ...extra } });
  expect(r.status, JSON.stringify(r.data)).toBe(200);
  return r.data.id as string;
}
const get = async (p: Awaited<ReturnType<typeof person>>, id: string) => (await p.json(`/api/parts-orders/${id}`)).data;
async function move(p: Awaited<ReturnType<typeof person>>, id: string, to: string, extra: Record<string, unknown> = {}) {
  const o = (await get(p, id)).order;
  return p.json(`/api/parts-orders/${id}/status`, { body: { revision: o.revision, to, ...extra } });
}

afterEach(async () => {
  await env.DB.prepare("DELETE FROM settings").run();
  forgetSettings();
});

describe("parts orders: quote to order", () => {
  it("a salesperson starts a quote with lines; it gets a quote number, revision A and their name", async () => {
    const andrew = await person("sales", { name: "Andrew Yang" });
    const id = await newQuote(andrew);
    const { order, lines } = await get(andrew, id);
    expect(order).toMatchObject({ status: "quote", shown: "Quote", rev: "A", customer: "Example Foods Inc.", machine: "4222TP", salesperson: "Andrew Yang", order_number: null, lines: 2, qty: 12 });
    expect(order.quote_number).toMatch(/^Q-\d{4}-\d{4}$/);
    expect(lines.map((l: any) => [l.part_code, l.qty, l.shipped])).toEqual([["R-10442", 2, 0], ["R-20871", 10, 0]]);
  });

  it("sent, revised (old revision kept), then booked only with the customer's PO", async () => {
    const michele = await person("manager");
    const id = await newQuote(michele);
    expect((await move(michele, id, "sent")).status).toBe(200);
    expect((await get(michele, id)).order.shown).toBe("Quote sent");
    const before = (await get(michele, id)).order;
    const rev = await michele.json(`/api/parts-orders/${id}/revise`, { body: { revision: before.revision } });
    expect(rev.data.rev).toBe("B");
    const after = await get(michele, id);
    expect(after.order).toMatchObject({ rev: "B", status: "quote" });
    expect(after.revisions).toHaveLength(1);
    expect(after.revisions[0]).toMatchObject({ rev: "A", lines: [{ part_code: "R-10442", qty: 2 }, { part_code: "R-20871", qty: 10 }] });
    expect((await move(michele, id, "booked")).status).toBe(400); // no PO yet
    const booked = await move(michele, id, "booked", { customer_po: "PO-7781", promised_date: "2026-12-15" });
    expect(booked.status).toBe(200);
    const o = (await get(michele, id)).order;
    expect(o).toMatchObject({ status: "booked", shown: "Booked", customer_po: "PO-7781", promised_date: "2026-12-15", follow_up: null });
    expect(o.order_number).toMatch(/^SO-\d{4}-\d{4}$/);
    expect(o.booked_at).toBeTruthy();
    expect((await michele.json(`/api/parts-orders/${id}/revise`, { body: { revision: o.revision } })).status).toBe(409); // orders aren't revised
    const history = (await get(michele, id)).history.map((h: any) => h.action);
    expect(history).toEqual(["po.status", "po.revise", "po.status", "po.create"]);
  });

  it("lost needs a reason; a lost quote can be picked up again", async () => {
    const andrew = await person("sales");
    const id = await newQuote(andrew);
    expect((await move(andrew, id, "lost")).status).toBe(400);
    expect((await move(andrew, id, "lost", { reason: "Lead time" })).status).toBe(200);
    expect((await get(andrew, id)).order).toMatchObject({ status: "lost", shown: "Lost", reason: "Lead time" });
    expect((await move(andrew, id, "booked", { customer_po: "X" })).status).toBe(409); // not from lost
    expect((await move(andrew, id, "quote")).status).toBe(200);
    expect((await get(andrew, id)).order).toMatchObject({ status: "quote", reason: null });
  });

  it("a stale save is refused, so two people can't overwrite each other", async () => {
    const a = await person("sales");
    const id = await newQuote(a);
    const o = (await get(a, id)).order;
    expect((await a.json(`/api/parts-orders/${id}`, { method: "PATCH", body: { revision: o.revision, contact: "Lee" } })).status).toBe(200);
    expect((await a.fetch(`/api/parts-orders/${id}`, { method: "PATCH", body: { revision: o.revision, contact: "Pat" } })).status).toBe(409);
  });

  it("checks and limits what is typed", async () => {
    const a = await person("sales");
    for (const bad of [
      { customer: "" },
      { customer: "X".repeat(201) },
      { customer: "A", follow_up: "next week" },
      { customer: "A", machine: "<b>" },
      { customer: "A", lines: [{ part_code: "R-1", qty: 0 }] },
      { customer: "A", lines: [{ part_code: "R-1", qty: 1.5 }] },
      { customer: "A", lines: [{ qty: 1 }] },
      { customer: "A", lines: Array.from({ length: 201 }, () => ({ part_code: "R-1", qty: 1 })) },
    ]) expect((await a.fetch("/api/parts-orders", { body: bad })).status, JSON.stringify(bad).slice(0, 80)).toBe(400);
  });

  it("notes save on their own without the revision check, and go in the history", async () => {
    const a = await person("sales");
    const id = await newQuote(a);
    expect((await a.json(`/api/parts-orders/${id}/notes`, { method: "PUT", body: { notes: "Called Dana.\nShe wants it before the shutdown." } })).status).toBe(200);
    const d = await get(a, id);
    expect(d.order.notes).toBe("Called Dana.\nShe wants it before the shutdown.");
    expect(d.history[0].action).toBe("po.notes");
    // Lines still save with the revision from before the notes.
    expect((await a.json(`/api/parts-orders/${id}/lines`, { method: "PUT", body: { revision: d.order.revision, lines: [...d.lines.map((l: any) => ({ id: l.id, part_code: l.part_code, description: l.description, qty: l.qty })), { part_code: "R-3", qty: 1, backorder: true }] } })).status).toBe(200);
    expect((await get(a, id)).lines).toHaveLength(3);
  });
});

describe("starting a quote from a customer's quote request", () => {
  it("copies the company, who sent it, the machine and every line; asking twice opens the same quote", async () => {
    connectPartsSite();
    try {
      const pdb = env.TEST_PARTS_DB;
      const t = new Date().toISOString();
      const rid = `rq${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await pdb.batch([
        pdb.prepare("INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, 'Example Beverage Co.', ?, ?)").bind(`co-${rid}`, t, t),
        pdb.prepare("INSERT INTO users (id, company_id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, 'Jo Buyer', 'buyer', ?, ?)").bind(`u-${rid}`, `co-${rid}`, `${rid}@example.com`, t, t),
        pdb.prepare("INSERT INTO quotes (id, number, company_id, user_id, email, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'jo@example.com', 'Needed for the January shutdown', ?, ?)").bind(rid, `RQ-${rid.slice(2, 10)}`, `co-${rid}`, `u-${rid}`, t, t),
        pdb.prepare("INSERT INTO lines (id, quote_id, code, description, qty, serial, created_at) VALUES (?, ?, 'R-555', 'Cam follower', 4, '3069MB', ?)").bind(`l1-${rid}`, rid, t),
        pdb.prepare("INSERT INTO lines (id, quote_id, code, description, qty, serial, created_at) VALUES (?, ?, NULL, 'Guide rail, left', 1.5, '3069MB', ?)").bind(`l2-${rid}`, rid, t),
      ]);
      const tech = await person("tech");
      expect((await tech.fetch("/api/parts-orders/from-request", { body: { requestId: rid } })).status).toBe(403);
      const andrew = await person("sales", { name: "Andrew Yang" });
      const r = await andrew.json("/api/parts-orders/from-request", { body: { requestId: rid } });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      const d = await get(andrew, r.data.id);
      expect(d.order).toMatchObject({ customer: "Example Beverage Co.", contact: "Jo Buyer (jo@example.com)", machine: "3069MB", salesperson: "Andrew Yang", request_id: rid, notes: "Needed for the January shutdown" });
      expect(d.lines.map((l: any) => [l.part_code, l.qty])).toEqual([["R-555", 4], [null, 2]]);
      expect((await andrew.json("/api/parts-orders/from-request", { body: { requestId: rid } })).data).toEqual({ id: r.data.id, existing: true });
    } finally {
      connectPartsSite(false);
    }
  });
});

describe("parts orders: who can do what", () => {
  it("a field service engineer can't see or change parts orders; billing and service can only look", async () => {
    const sales = await person("sales");
    const id = await newQuote(sales);
    const tech = await person("tech");
    expect((await tech.fetch("/api/parts-orders")).status).toBe(403);
    expect((await tech.fetch(`/api/parts-orders/${id}`)).status).toBe(403);
    expect((await tech.fetch("/api/parts-orders", { body: QUOTE })).status).toBe(403);
    for (const role of ["billing", "service"]) {
      const p = await person(role);
      expect((await p.fetch("/api/parts-orders")).status, role).toBe(200);
      expect((await p.fetch("/api/parts-orders", { body: QUOTE })).status, role).toBe(403);
      expect((await p.fetch(`/api/parts-orders/${id}/notes`, { method: "PUT", body: { notes: "x" } })).status, role).toBe(403);
      expect((await p.fetch(`/api/parts-orders/${id}/status`, { body: { revision: 1, to: "sent" } })).status, role).toBe(403);
    }
  });

  it("switching Parts orders off in the command center closes it to everyone but admins", async () => {
    const admin = await person("admin");
    const sales = await person("sales");
    expect((await sales.fetch("/api/parts-orders")).status).toBe(200);
    await admin.json("/api/settings", { method: "PUT", body: { sections: { partsSales: false } } });
    expect((await sales.fetch("/api/parts-orders")).status).toBe(403);
    expect((await sales.fetch("/api/parts-orders", { body: QUOTE })).status).toBe(403);
    expect((await admin.fetch("/api/parts-orders")).status).toBe(200);
  });
});

describe("parts orders: the tracker", () => {
  it("counts open quotes and orders, late orders and conversion, with no money anywhere", async () => {
    const a = await person("manager");
    const before = (await a.json("/api/parts-orders")).data.kpis;
    const q = await newQuote(a);
    const late = await newQuote(a);
    await move(a, late, "booked", { customer_po: "PO-1", promised_date: "2020-01-01" });
    const lost = await newQuote(a);
    await move(a, lost, "lost", { reason: "Price" });
    const { data } = await a.json("/api/parts-orders");
    expect(data.kpis.openQuotes - before.openQuotes).toBe(1);
    expect(data.kpis.openOrders - before.openOrders).toBe(1);
    expect(data.kpis.late - before.late).toBe(1);
    expect(data.kpis.conversion).toBeGreaterThan(0);
    expect(data.kpis.bookings).toHaveLength(12);
    expect(data.orders.find((o: any) => o.id === late)).toMatchObject({ late: true, shown: "Booked" });
    expect(data.orders.find((o: any) => o.id === q).shown).toBe("Quote");
    expect(JSON.stringify(data)).not.toMatch(/"(price|cost|amount|total|value|margin|revenue)\w*"/i);
  });

  it("exports a CSV with one row per line, safe from spreadsheet formulas, and logs the export", async () => {
    const a = await person("sales");
    await newQuote(a, { customer: "=HYPERLINK(\"x\")" });
    const res = await a.fetch("/api/parts-orders/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const csv = await res.text();
    const head = csv.split("\r\n")[0]!;
    expect(head).toContain("Part code");
    expect(head).toContain("Qty shipped");
    expect(head).not.toMatch(/price|cost|amount|total|value/i);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("R-20871");
    expect((await (await person("tech")).fetch("/api/parts-orders/export")).status).toBe(403);
  });

  it("a machine's page lists its parts orders for people who can see them", async () => {
    const admin = await person("admin");
    const m = await admin.json("/api/machines", { body: { serial: "4555TP", customer: "Example Foods Inc." } });
    await newQuote(admin, { machine: "4555TP" });
    expect((await admin.json(`/api/machines/${m.data.id}`)).data.partsOrders).toHaveLength(1);
    const tech = await person("tech");
    expect((await tech.json(`/api/machines/${m.data.id}`)).data.partsOrders).toBeNull();
  });
});

describe("no money in the portal", () => {
  it("no parts order or shipping table has a price, cost, amount, total, value or margin column", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'po\\_%' ESCAPE '\\' OR name LIKE 'sh\\_%' ESCAPE '\\' OR name IN ('carriers','doc_numbers'))").all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual(["carriers", "doc_numbers", "po_files", "po_lines", "po_orders", "po_revisions", "sh_files", "sh_in_lines", "sh_inbound", "sh_issues", "sh_out_lines", "sh_outbound", "sh_receipts"]);
    for (const { name } of results) {
      const { results: cols } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${name}')`).all<{ name: string }>();
      expect(cols.length, name).toBeGreaterThan(1);
      for (const c of cols) expect(c.name, `${name}.${c.name}`).not.toMatch(/price|cost|amount|total|value|margin|revenue|currency|dollar|cents|discount|charge|duty|invoice/i);
    }
  });
});

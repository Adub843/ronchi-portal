import { describe, expect, it } from "vitest";
import { person } from "./helpers";

const deal = async (p: any, id: string) => (await p.json(`/api/machine-sales/${id}`)).data;

describe("machine quotes", () => {
  it("builds a quote in revisions; sending one sets the deal's value and stage and replaces the one before", async () => {
    const andrew = await person("sales");
    const made = await andrew.json("/api/machine-sales", { body: { customer: "Quote Test Foods", title: "Filler" } });
    const id = made.data.id;
    const q1 = await andrew.json(`/api/machine-sales/${id}/quotes`, { body: {} });
    expect(q1.status).toBe(200);
    expect(q1.data.number).toBe(`${made.data.number}-Q1`);
    const url = `/api/machine-sales/${id}/quotes/${q1.data.id}`;
    let q = (await andrew.json(url)).data.quote;
    expect(q).toMatchObject({ status: "draft", kind: "budget", lines: [] });
    // Nothing to send yet.
    expect((await andrew.json(`${url}/status`, { body: { status: "sent", revision: q.revision } })).status).toBe(400);
    const lines = [
      { description: "EXACTA filler, 16 heads", origin: "italy", qty: 1, unit_price: 800000 },
      { description: "Installation and start-up", origin: "us", qty: 1, unit_price: 40000 },
      { description: "Third format change parts", origin: "italy", qty: 1, unit_price: 25000, optional: true },
    ];
    expect((await andrew.fetch(url, { method: "PATCH", body: { revision: q.revision, kind: "firm", lead_time: "26 weeks from order", discount_pct: 5, lines } })).status).toBe(200);
    expect((await andrew.fetch(url, { method: "PATCH", body: { revision: q.revision, lead_time: "stale" } })).status).toBe(409);
    q = (await andrew.json(url)).data.quote;
    expect(q.totals).toMatchObject({ subtotal: 840000, discount: 42000, total: 798000, options: 25000 });
    expect((await andrew.json(`${url}/status`, { body: { status: "sent", revision: q.revision } })).status).toBe(200);
    let d = await deal(andrew, id);
    expect(d.deal).toMatchObject({ value: 798000, stage: "firm_quote" });
    expect(d.quotes[0]).toMatchObject({ status: "sent", number: `${made.data.number}-Q1` });
    expect(d.history.some((h: any) => h.action === "machine_deal.quote" && h.status === "sent")).toBe(true);
    // A sent quote is not edited.
    q = (await andrew.json(url)).data.quote;
    expect((await andrew.fetch(url, { method: "PATCH", body: { revision: q.revision, lead_time: "20 weeks" } })).status).toBe(400);
    expect((await andrew.fetch(url, { method: "DELETE" })).status).toBe(400);
    // A new revision copies it; sending it replaces the first.
    const q2 = await andrew.json(`/api/machine-sales/${id}/quotes`, { body: { copy_from: q1.data.id } });
    expect(q2.data.number).toBe(`${made.data.number}-Q2`);
    const url2 = `/api/machine-sales/${id}/quotes/${q2.data.id}`;
    let r2 = (await andrew.json(url2)).data.quote;
    expect(r2).toMatchObject({ status: "draft", kind: "firm", lead_time: "26 weeks from order" });
    expect(r2.lines).toHaveLength(3);
    await andrew.fetch(url2, { method: "PATCH", body: { revision: r2.revision, discount_pct: 10 } });
    r2 = (await andrew.json(url2)).data.quote;
    await andrew.json(`${url2}/status`, { body: { status: "sent", revision: r2.revision } });
    d = await deal(andrew, id);
    expect(d.deal.value).toBe(756000);
    expect(d.quotes.map((x: any) => [x.rev, x.status])).toEqual([[2, "sent"], [1, "superseded"]]);
    r2 = (await andrew.json(url2)).data.quote;
    expect((await andrew.json(`${url2}/status`, { body: { status: "accepted", revision: r2.revision } })).status).toBe(200);
    expect((await deal(andrew, id)).deal.stage).toBe("firm_quote"); // accepted is not won: that takes the customer's PO
  });

  it("only people who may see deal values can open or build quotes", async () => {
    const andrew = await person("sales");
    const made = await andrew.json("/api/machine-sales", { body: { customer: "Quote Access Co" } });
    const id = made.data.id;
    const q1 = await andrew.json(`/api/machine-sales/${id}/quotes`, { body: { kind: "budget" } });
    const url = `/api/machine-sales/${id}/quotes/${q1.data.id}`;
    const q = (await andrew.json(url)).data.quote;
    await andrew.fetch(url, { method: "PATCH", body: { revision: q.revision, lines: [{ description: "Capper", unit_price: 300000 }] } });
    for (const role of ["tech", "service", "scheduling", "engineering"]) {
      const p = await person(role);
      expect((await p.fetch(url)).status, role).toBe(403);
      expect((await p.fetch(`/api/machine-sales/${id}/quotes`, { body: {} })).status, role).toBe(403);
      const seen = (await deal(p, id)).quotes[0];
      expect(seen).toMatchObject({ status: "draft" });
      expect(JSON.stringify(seen)).not.toContain("300000");
      expect(seen.lines).toBeUndefined();
      expect(seen.totals).toBeUndefined();
    }
    const billing = await person("billing"); // sees values, does not change deals
    expect((await billing.fetch(url)).status).toBe(200);
    expect((await billing.fetch(`/api/machine-sales/${id}/quotes`, { body: {} })).status).toBe(403);
    // A draft can be thrown away.
    expect((await andrew.fetch(url, { method: "DELETE" })).status).toBe(200);
    expect((await deal(andrew, id)).quotes).toEqual([]);
  });
});

describe("machine orders", () => {
  it("keeps order dates and payments on a sold deal, flags what is late, and hides amounts", async () => {
    const andrew = await person("sales");
    const made = await andrew.json("/api/machine-sales", { body: { customer: "Order Test Pharma", site: "Raleigh, NC", machine_type: "EXACTA filler", value: 1000000, customer_po: "PO-9", stage: "won", machine: "4999zz" } });
    const id = made.data.id;
    let d = await deal(andrew, id);
    expect(d.dates).toEqual([]);
    const put = (p: any, body: Record<string, unknown>) => p.fetch(`/api/machine-sales/${id}/milestones`, { method: "PUT", body });
    expect((await put(andrew, { revision: d.deal.revision, dates: [{ label: "FAT", due: "2020-01-10" }, { label: "Shipped", due: "2099-01-01" }], payments: [{ label: "Deposit", pct: 40, due: "2020-01-01", done: "2020-01-03", invoice_no: "INV-1" }, { label: "Before shipment", pct: 50, due: "2020-02-01" }, { label: "After start-up", amount: 100000 }] })).status).toBe(200);
    expect((await put(andrew, { revision: d.deal.revision, dates: [] })).status).toBe(409);
    d = await deal(andrew, id);
    expect(d.dates.map((m: any) => m.label)).toEqual(["FAT", "Shipped"]);
    expect(d.payments).toHaveLength(3);
    expect(d.payments[0]).toMatchObject({ label: "Deposit", pct: 40, done: "2020-01-03", invoice_no: "INV-1" });
    expect(d.deal.next_milestone).toBe("2020-01-10");
    const listed = (await andrew.json("/api/machine-sales")).data.deals.find((x: any) => x.id === id);
    expect(listed.next_milestone).toBe("2020-01-10");
    expect((await put(andrew, { revision: d.deal.revision, payments: [{ label: "", pct: 10 }] })).status).toBe(400);
    expect((await put(andrew, { revision: d.deal.revision, payments: [{ label: "X", pct: 140 }] })).status).toBe(400);
    expect((await put(andrew, { revision: d.deal.revision, dates: [{ label: "X", due: "soon" }] })).status).toBe(400);
    // Someone without deal values sees names and days only, and can't change anything.
    const tech = await person("tech");
    const seen = await deal(tech, id);
    expect(seen.payments[0]).toEqual({ id: seen.payments[0].id, label: "Deposit", due: "2020-01-01", done: "2020-01-03" });
    expect(JSON.stringify(seen.payments)).not.toMatch(/pct|amount|INV-1/);
    expect((await put(tech, { revision: d.deal.revision, dates: [] })).status).toBe(403);
    expect(JSON.stringify(seen.history)).not.toMatch(/100000|1000000/);
  });

  it("adds the machine to Machines when the final payment arrives", async () => {
    const andrew = await person("sales");
    const made = await andrew.json("/api/machine-sales", { body: { customer: "Final Payment Foods", site: "Atlanta, GA", machine_type: "SIRIO capper", customer_po: "PO-77", stage: "install", machine: "4998zy" } });
    const d = await deal(andrew, made.data.id);
    const r = await andrew.fetch(`/api/machine-sales/${made.data.id}`, { method: "PATCH", body: { revision: d.deal.revision, stage: "paid" } });
    expect(r.status).toBe(200);
    expect((await r.json() as any).machine_added).toBe("4998ZY");
    const machines = (await andrew.json("/api/machines")).data.machines ?? (await andrew.json("/api/machines")).data;
    const m = (Array.isArray(machines) ? machines : []).find((x: any) => x.serial === "4998ZY");
    expect(m).toMatchObject({ customer: "Final Payment Foods", site: "Atlanta, GA", model: "SIRIO capper" });
    expect((await deal(andrew, made.data.id)).machines.some((x: any) => x.serial === "4998ZY")).toBe(true);
  });
});

describe("machine forecast and import", () => {
  it("imports a sales list as new deals and says which line is wrong", async () => {
    const andrew = await person("sales");
    const before = (await andrew.json("/api/machine-sales")).data.deals.length;
    const bad = await andrew.json("/api/machine-sales/import", { body: { rows: [{ customer: "Import One", value: "$400,000", stage: "firm_quote", expected_po: "2027-03" }, { customer: "Import Two", stage: "won" }] } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toMatch(/^Line 3: .*PO/);
    expect((await andrew.json("/api/machine-sales")).data.deals.length).toBe(before); // nothing half-imported
    const ok = await andrew.json("/api/machine-sales/import", { body: { rows: [{ customer: "Import One", title: "Filler", value: "$400,000", stage: "firm_quote", expected_po: "2027-03", owner: "Andrew" }, { customer: "Import Two", stage: "won", customer_po: "PO-1" }, { customer: "Import Three" }] } });
    expect(ok.data).toEqual({ ok: true, deals: 3 });
    const deals = (await andrew.json("/api/machine-sales")).data.deals;
    expect(deals.find((d: any) => d.customer === "Import One")).toMatchObject({ value: 400000, stage: "firm_quote", expected_po: "2027-03", title: "Filler" });
    expect(deals.find((d: any) => d.customer === "Import Two").won_at).toBeTruthy();
    expect(deals.find((d: any) => d.customer === "Import Three").stage).toBe("lead");
    expect(new Set(deals.map((d: any) => d.number)).size).toBe(deals.length);
    expect((await (await person("tech")).fetch("/api/machine-sales/import", { body: { rows: [{ customer: "X" }] } })).status).toBe(403);
  });

  it("lists the payments still to come, only for people who may see deal values", async () => {
    const andrew = await person("sales");
    const made = await andrew.json("/api/machine-sales", { body: { customer: "Forecast Pay Co", value: 200000, customer_po: "PO-5", stage: "build" } });
    const d = (await andrew.json(`/api/machine-sales/${made.data.id}`)).data;
    await andrew.fetch(`/api/machine-sales/${made.data.id}/milestones`, { method: "PUT", body: { revision: d.deal.revision, payments: [{ label: "Deposit", pct: 40, done: "2026-01-05" }, { label: "Before shipment", pct: 50, due: "2027-02-01" }] } });
    const f = await andrew.json("/api/machine-sales/forecast");
    expect(f.status).toBe(200);
    const mine = f.data.payments.filter((p: any) => p.deal_id === made.data.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ label: "Before shipment", due: "2027-02-01", amount: 100000, customer: "Forecast Pay Co" });
    expect((await (await person("billing")).fetch("/api/machine-sales/forecast")).status).toBe(200);
    for (const role of ["tech", "service", "scheduling"]) expect((await (await person(role)).fetch("/api/machine-sales/forecast")).status, role).toBe(403);
  });
});

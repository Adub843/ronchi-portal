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

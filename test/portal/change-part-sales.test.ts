import { describe, expect, it } from "vitest";
import { person } from "./helpers";

const SALE = { customer: "Sale Co", machine: "4196mb", part: "18 oz bottle set", salesperson: "Andrew Yang", contact: "Pat at Sale Co", follow_up: "12/02/2026" };

describe("change-part sales", () => {
  it("a salesperson starts a sale; it shows under Sales, not under Orders", async () => {
    const andrew = await person("sales", { name: "Andrew Yang" });
    const r = await andrew.json("/api/change-parts/sales", { body: SALE });
    expect(r.status).toBe(200);
    const sales = await andrew.json("/api/change-parts/sales");
    expect(sales.data.sales.find((s: any) => s.id === r.data.id)).toMatchObject({ customer: "Sale Co", machine: "4196MB", status: "New request", salesperson: "Andrew Yang", contact: "Pat at Sale Co", open: true });
    expect((await andrew.json("/api/change-parts")).data.orders.some((o: any) => o.id === r.data.id)).toBe(false);
  });
});

describe("selling a change part", () => {
  it("marking a sale sold makes it an order that keeps its history", async () => {
    const michele = await person("manager", { name: "Michele Falsini" });
    const { data } = await michele.json("/api/change-parts/sales", { body: SALE });
    const sale = (await michele.json(`/api/change-parts/${data.id}`)).data.order;
    const quoted = await michele.json(`/api/change-parts/${data.id}`, { method: "PATCH", body: { revision: sale.revision, status: "Quote sent", quote: "AY0099" } });
    expect(quoted.status).toBe(200);
    expect((await michele.fetch(`/api/change-parts/${data.id}/sold`, { body: { revision: quoted.data.revision } })).status).toBe(400); // no PO yet
    const sold = await michele.json(`/api/change-parts/${data.id}/sold`, { body: { revision: quoted.data.revision, customer_po: "PO-555", aa: "5200AA" } });
    expect(sold.status).toBe(200);
    const order = (await michele.json("/api/change-parts")).data.orders.find((o: any) => o.id === data.id);
    expect(order).toMatchObject({ phase: "order", status: "Open", customer_po: "PO-555", aa: "5200AA", quote: "AY0099", salesperson: "Andrew Yang", follow_up: null, open: true });
    expect(order.sold_at).toBeTruthy();
    expect((await michele.json("/api/change-parts/sales")).data.sales.some((s: any) => s.id === data.id)).toBe(false);
    const page = await michele.json(`/api/change-parts/${data.id}`);
    expect(page.data.history.map((h: any) => h.action)).toEqual(["cp_sale.sold", "cp_sale.update", "cp_sale.create"]);
    expect((await michele.fetch(`/api/change-parts/${data.id}/sold`, { body: { revision: page.data.order.revision, customer_po: "x" } })).status).toBe(409);
  });

  it("a lost sale stays under Sales, closed", async () => {
    const andrew = await person("sales");
    const { data } = await andrew.json("/api/change-parts/sales", { body: SALE });
    const s = (await andrew.json(`/api/change-parts/${data.id}`)).data.order;
    await andrew.json(`/api/change-parts/${data.id}`, { method: "PATCH", body: { revision: s.revision, status: "Lost" } });
    expect((await andrew.json("/api/change-parts/sales")).data.sales.find((x: any) => x.id === data.id).open).toBe(false);
  });

  it("people who only see orders can't see or reach sales; sales start with the person's own name", async () => {
    const andrew = await person("sales", { name: "Andrew Yang" });
    const { data } = await andrew.json("/api/change-parts/sales", { body: { customer: "No Name Co" } });
    expect((await andrew.json("/api/change-parts/sales")).data.sales.find((x: any) => x.id === data.id).salesperson).toBe("Andrew Yang");
    for (const role of ["tech", "billing", "scheduling", "engineering", "service"]) {
      const p = await person(role);
      expect((await p.fetch("/api/change-parts/sales")).status, role).toBe(403);
      expect((await p.fetch("/api/change-parts/sales", { body: SALE })).status, role).toBe(403);
      expect([403, 404], role).toContain((await p.fetch(`/api/change-parts/${data.id}`)).status);
      expect([403, 404], role).toContain((await p.fetch(`/api/change-parts/${data.id}/sold`, { body: { revision: 1, customer_po: "x" } })).status);
    }
  });

  it("a machine page lists orders, not sales still being worked", async () => {
    const admin = await person("admin");
    const m = await admin.json("/api/machines", { body: { serial: "3998MB", customer: "Acme" } });
    await admin.json("/api/change-parts/sales", { body: { ...SALE, machine: "3998MB" } });
    expect((await admin.json(`/api/machines/${m.data.id}`)).data.orders).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { Browser, person } from "./helpers";

const ORDER = { customer: "Acme Labs", machine: "3069mb", part: "500 ml round bottle set", status: "In design", customer_po: "PO-1188", ship_date: "12/15/2026" };

describe("change-part orders", () => {
  it("sales and admins can see and add orders; other staff can't reach them at all", async () => {
    const sales = await person("sales");
    const admin = await person("admin");
    const r = await sales.json("/api/change-parts", { body: ORDER });
    expect(r.status).toBe(200);
    const list = await admin.json("/api/change-parts");
    const o = list.data.orders.find((x: any) => x.id === r.data.id);
    expect(o).toMatchObject({ customer: "Acme Labs", machine: "3069MB", ship_date: "2026-12-15", open: true });
    for (const role of ["tech", "service", "engineering", "billing", "scheduling"]) {
      const p = await person(role);
      expect((await p.fetch("/api/change-parts")).status, role).toBe(403);
      expect((await p.fetch(`/api/change-parts/${r.data.id}`)).status, role).toBe(403);
      expect((await p.fetch("/api/change-parts", { body: ORDER })).status, role).toBe(403);
    }
    expect((await new Browser().fetch("/api/change-parts")).status).toBe(401);
  });

  it("checks what is typed", async () => {
    const sales = await person("sales");
    expect((await sales.fetch("/api/change-parts", { body: { part: "x" } })).status).toBe(400);
    expect((await sales.fetch("/api/change-parts", { body: { customer: "A", ship_date: "next week" } })).status).toBe(400);
    expect((await sales.fetch("/api/change-parts", { body: { customer: "A", folder_url: "https://evil.example.com/x" } })).status).toBe(400);
    expect((await sales.fetch("/api/change-parts", { body: { customer: "A", notes: 5 } })).status).toBe(400);
  });

  it("keeps a history of every change and refuses a stale save", async () => {
    const andrew = await person("sales", { name: "Andrew" });
    const michele = await person("sales", { name: "Michele" });
    const { data } = await andrew.json("/api/change-parts", { body: ORDER });
    const first = (await andrew.json(`/api/change-parts/${data.id}`)).data.order;
    const ok = await michele.json(`/api/change-parts/${data.id}`, { method: "PATCH", body: { revision: first.revision, status: "Shipped", samples_shipped: "2026-11-20" } });
    expect(ok.status).toBe(200);
    const stale = await andrew.fetch(`/api/change-parts/${data.id}`, { method: "PATCH", body: { revision: first.revision, status: "On hold" } });
    expect(stale.status).toBe(409);
    const page = await andrew.json(`/api/change-parts/${data.id}`);
    expect(page.data.order).toMatchObject({ status: "Shipped", open: false, updated_by_name: "Michele" });
    expect(page.data.history[0]).toMatchObject({ action: "cp_order.update", who: "Michele", changes: { status: ["In design", "Shipped"] } });
    expect(page.data.history.at(-1).action).toBe("cp_order.create");
  });

  it("removing an order hides it but keeps the record", async () => {
    const sales = await person("sales");
    const { data } = await sales.json("/api/change-parts", { body: ORDER });
    expect((await sales.fetch(`/api/change-parts/${data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await sales.fetch(`/api/change-parts/${data.id}`)).status).toBe(404);
    expect((await sales.json("/api/change-parts")).data.orders.some((o: any) => o.id === data.id)).toBe(false);
  });

  it("imports the old console's CSV: preview first, then adds, and never twice", async () => {
    const admin = await person("admin");
    const csv = [
      "Customer,Machine,Status,Part,Customer PO,RA PO,AA,Samples Received,Samples Shipped,Fill Test,Ship Date,Folder Link,Notes,Salesperson",
      `Import Co,4222tp,Waiting on samples,"Pump set, 1 L",PO-77,RA-5,AA-9,11/02/2026,,,soon,,"Line 1\nLine 2",Andrew`,
      "Import Co,4212MB,Shipped,Star wheel,PO-78,,,,,Passed,2026-10-01,https://ronchi.sharepoint.com/sites/x,,",
      ",,,,,,,,,,,,,",
    ].join("\r\n");
    const preview = await admin.json("/api/change-parts/import", { body: { csv } });
    expect(preview.data).toMatchObject({ found: 2, adding: 2, skipped: 0, extra: ["Salesperson"] });
    expect((await admin.json("/api/change-parts")).data.orders.filter((o: any) => o.customer === "Import Co")).toHaveLength(0);
    const done = await admin.json("/api/change-parts/import", { body: { csv, confirm: true } });
    expect(done.data.imported).toBe(2);
    const rows = (await admin.json("/api/change-parts")).data.orders.filter((o: any) => o.customer === "Import Co");
    const pump = rows.find((o: any) => o.part === "Pump set, 1 L");
    expect(pump).toMatchObject({ machine: "4222TP", samples_received: "2026-11-02", ship_date: null, open: true });
    expect(pump.notes).toBe("Line 1\nLine 2\nShip date: soon\nSalesperson: Andrew");
    const again = await admin.json("/api/change-parts/import", { body: { csv, confirm: true } });
    expect(again.data).toMatchObject({ imported: 0, duplicates: 2 });
    expect((await (await person("tech")).fetch("/api/change-parts/import", { body: { csv } })).status).toBe(403);
  });

  it("a machine page lists its change-part orders, only for people who may see orders", async () => {
    const admin = await person("admin");
    const m = await admin.json("/api/machines", { body: { serial: "3999MB", customer: "Acme" } });
    await admin.json("/api/change-parts", { body: { ...ORDER, machine: "3999mb" } });
    expect((await admin.json(`/api/machines/${m.data.id}`)).data.orders).toHaveLength(1);
    expect((await (await person("tech")).json(`/api/machines/${m.data.id}`)).data.orders).toBeNull();
    const list = await admin.json("/api/change-parts");
    expect(list.data.orders.find((o: any) => o.machine === "3999MB").machine_id).toBe(m.data.id);
  });
});

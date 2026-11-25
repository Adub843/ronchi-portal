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
    expect(o).toMatchObject({ customer: "Acme Labs", machine: "3069MB", ship_date: "12/15/2026", open: true });
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
    expect((await sales.fetch("/api/change-parts", { body: { customer: "A", ship_date: "x".repeat(201) } })).status).toBe(400);
    expect((await sales.fetch("/api/change-parts", { body: { customer: "A", ship_date: "Mid Nov 2026", samples_received: "Yes" } })).status).toBe(200);
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
    // Shipped is not finished: it stays open until someone marks it Completed after the customer approves.
    expect(page.data.order).toMatchObject({ status: "Shipped", open: true, updated_by_name: "Michele" });
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
      "Customer,Machine,Status,Part,Customer PO,RA PO,AA,Samples Received,Samples Shipped,Fill Test,Ship Date,Folder Link,Notes,QuickBooks #",
      `Import Co,4222tp,Waiting on samples,"Pump set, 1 L",PO-77,RA-5,AA-9,11/02/2026,,,soon,,"Line 1\nLine 2",QB-1`,
      "Import Co,4212MB,Shipped,Star wheel,PO-78,,,,,Passed,2026-10-01,https://ronchi.sharepoint.com/sites/x,,",
      ",,,,,,,,,,,,,",
    ].join("\r\n");
    const preview = await admin.json("/api/change-parts/import", { body: { csv } });
    expect(preview.data).toMatchObject({ found: 2, adding: 2, skipped: 0, extra: ["QuickBooks #"] });
    expect((await admin.json("/api/change-parts")).data.orders.filter((o: any) => o.customer === "Import Co")).toHaveLength(0);
    const done = await admin.json("/api/change-parts/import", { body: { csv, confirm: true } });
    expect(done.data.imported).toBe(2);
    const rows = (await admin.json("/api/change-parts")).data.orders.filter((o: any) => o.customer === "Import Co");
    const pump = rows.find((o: any) => o.part === "Pump set, 1 L");
    expect(pump).toMatchObject({ machine: "4222TP", samples_received: "11/02/2026", ship_date: "soon", open: true });
    expect(pump.notes).toBe("Line 1\nLine 2\nQuickBooks #: QB-1");
    const again = await admin.json("/api/change-parts/import", { body: { csv, confirm: true } });
    expect(again.data).toMatchObject({ imported: 0, duplicates: 2 });
    expect((await (await person("tech")).fetch("/api/change-parts/import", { body: { csv } })).status).toBe(403);
  });

  it("imports separate jobs on the same machine (different AA, RA PO or quote) instead of dropping them as copies", async () => {
    // The real master sheet has several "Change parts" folders for one machine with no customer PO,
    // each its own project with its own AA number (e.g. 4636AA, 4722AA, 4731AA on 3973MB).
    const admin = await person("admin");
    const csv = [
      "Customer,Machine,Part,Status,Quote #,Customer PO,RA PO,AA",
      "Same Machine Co,3973MB,Change parts,Folder only,,,,4636AA",
      "Same Machine Co,3973MB,Change parts,Folder only,,,,4722AA",
      "Same Machine Co,3973MB,Change parts,Folder only,,,MOR PO 27756,",
      "Same Machine Co,3973MB,Change parts,Folder only,Q-12,,,",
      "Same Machine Co,3973MB,Change parts,Folder only,,,,4636AA",
    ].join("\r\n");
    const preview = await admin.json("/api/change-parts/import", { body: { csv } });
    expect(preview.data).toMatchObject({ found: 5, adding: 4, duplicates: 1 });
    expect((await admin.json("/api/change-parts/import", { body: { csv, confirm: true } })).data.imported).toBe(4);
    expect((await admin.json("/api/change-parts/import", { body: { csv, confirm: true } })).data).toMatchObject({ imported: 0, duplicates: 5 });
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

  it("reads Karston's and Andrew's tabs of the master sheet as saved from Excel", async () => {
    const admin = await person("admin");
    const karston = [
      "Machine,Customer ,Project Name,Part Description ,Quote#,PO Received,Project#/AA#,Link,QuickBooks #,MOR PO#,Samples Requested,Samples Recived ,Samples Shipped,Fill Test Needed,In Production,Ship Date,Parts Shippped ,Received by Customer,Notes,Active",
      "4025MB,Sheet Co,60oz Sanitizer,\"Bottle, Sorter, Cap\",KS015_REV1,4500602771,4849AA,,,28485,Y,Y,Y,N,Y,3/3/2026,N,N,Cap infeed starwheel needs modification.,Y",
    ].join("\n");
    const k = await admin.json("/api/change-parts/import", { body: { csv: karston, confirm: true } });
    expect(k.data.imported).toBe(1);
    const andrew = [
      "Customer ,Machine,Open or Completed,Part Description ,Customer PO,RA PO#,AA,Samples Received ,Samples Shipped ,Fill Test Needed,Estimated Ship Date,Link to Folder",
      "Sheet Co,4196MB,Open,4CC APG Pump Changes,PA-136594,RM PO 30187,5077AA,y,y,n,Early Nov 2026,",
    ].join("\n");
    expect((await admin.json("/api/change-parts/import", { body: { csv: andrew, confirm: true } })).data.imported).toBe(1);
    const rows = (await admin.json("/api/change-parts")).data.orders.filter((o: any) => o.customer === "Sheet Co");
    expect(rows.find((o: any) => o.machine === "4025MB")).toMatchObject({ part: "60oz Sanitizer: Bottle, Sorter, Cap", quote: "KS015_REV1", customer_po: "4500602771", ra_po: "28485", aa: "4849AA", ship_date: "3/3/2026" });
    expect(rows.find((o: any) => o.machine === "4196MB")).toMatchObject({ status: "Open", ra_po: "RM PO 30187", ship_date: "Early Nov 2026", open: true });
  });
});

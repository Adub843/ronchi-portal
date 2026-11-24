import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../../src/portal/index";
import { person } from "./helpers";
import { connectPartsSite, partsEnv } from "./parts-site";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

let serialN = 0;
async function machine(admin: Awaited<ReturnType<typeof person>>, fields: Record<string, string> = {}) {
  const serial = `${4100 + ++serialN}MB`;
  const r = await admin.json("/api/machines", { body: { serial, model: "ROTOCAP", ...fields } });
  if (r.status !== 200) throw new Error(JSON.stringify(r.data));
  return { id: r.data.id as string, serial };
}

const SHEETS = [
  { key: "p3", page: 3, title: "Capping head", titleIt: "Testata", code: "MB000100", rows: [
    { pos: "1", code: "MB000200", qty: 1, nameEn: "Clutch", nameIt: "Frizione", hotspots: [{ x: 0.2, y: 0.3, w: 0.04, h: 0.04 }] },
    { pos: "2", code: "gf010526", qty: 4, nameEn: "Screw", nameIt: "Vite" },
  ] },
  { key: "p4", parentKey: "p3", page: 4, title: "Clutch", code: "MB000200", rows: [
    { pos: "1", code: "MB000300", qty: 2, nameEn: "O-ring", nameIt: "Anello OR" },
  ] },
];

describe("parts catalog (staff)", () => {
  beforeAll(() => connectPartsSite());

  it("imports a manual, links sub-assemblies, and finds where a part is used", async () => {
    const svc = await person("service");
    const m = await machine(await person("admin"));
    const imp = await svc.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "x_11-15.pdf", pages: 40, sheets: SHEETS, warnings: ["Page 9: balloon 4 not found"] } });
    expect(imp.status).toBe(200);
    const [top, sub] = imp.data.sheets.map((s: any) => s.id);
    const tree = await svc.json(`/api/catalog/machines/${m.id}`);
    expect(tree.data.sheets.find((s: any) => s.id === sub).parent_id).toBe(top);
    expect(tree.data.imports[0].warnings).toHaveLength(1);
    const sheet = await svc.json(`/api/catalog/sheets/${top}`);
    expect(sheet.data.rows.map((r: any) => r.code)).toEqual(["MB000200", "GF010526"]);
    expect(sheet.data.rows[0].sub_sheet).toBe(sub);
    const part = await svc.json("/api/catalog/parts/GF010526");
    expect(part.data.part.name_en).toBe("Screw");
    expect(part.data.usedOn[0].serial).toBe(m.serial);
  });

  it("imports machines from a CSV, never overwriting, and a machine number search finds a machine with no catalog yet", async () => {
    const admin = await person("admin");
    const svc = await person("service");
    const known = await machine(admin, { customer: "Kept Co" });
    const csv = [
      "Machine,Model,Customer,Site,SharePoint,Notes",
      "RA1018,F,Sanofi,Chattanooga TN,https://example.sharepoint.com/sites/x,SharePoint has: CAD files",
      "3426,,Clorox,Pleasanton,,",
      `${known.serial},,Other Co,Line 9,,`,
      "Not a machine,,,,,",
    ].join("\n");
    const preview = await admin.json("/api/machines/import", { body: { csv } });
    expect(preview.data).toMatchObject({ found: 3, adding: 2, updating: 1, notMachines: ["NOT A MACHINE"] });
    expect((await (await person("billing")).json("/api/machines/import", { body: { csv, confirm: true } })).status).toBe(403);
    expect((await admin.json("/api/machines/import", { body: { csv, confirm: true } })).data.imported).toBe(2);
    const kept = await admin.json(`/api/machines/${known.id}`);
    expect(kept.data.machine.customer).toBe("Kept Co");
    expect(kept.data.machine.site).toBe("Line 9");
    const found = await svc.json("/api/catalog/search?q=RA1018");
    expect(found.data.machines.map((m: any) => [m.serial, m.customer, m.sheets])).toEqual([["RA1018", "Sanofi", 0]]);
    expect((await admin.json("/api/machines", { body: { serial: "RA1042F" } })).status).toBe(200);
    expect((await admin.json("/api/machines", { body: { serial: "0012" } })).status).toBe(400);
  });

  it("re-importing replaces the manual's sheets but keeps hand-made ones", async () => {
    const svc = await person("service");
    const m = await machine(await person("admin"));
    await svc.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "a.pdf", pages: 2, sheets: SHEETS } });
    const hand = await svc.json(`/api/catalog/machines/${m.id}/sheets`, { body: { title: "Guard kit", section: "kit" } });
    await svc.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "b.pdf", pages: 2, sheets: SHEETS.slice(0, 1) } });
    const tree = await svc.json(`/api/catalog/machines/${m.id}`);
    expect(tree.data.sheets.map((s: any) => s.title).sort()).toEqual(["Capping head", "Guard kit"]);
    expect(tree.data.sheets.some((s: any) => s.id === hand.data.id)).toBe(true);
  });

  it("only catalog editors change the catalog; every staff role can read it and add notes", async () => {
    const tech = await person("tech");
    const m = await machine(await person("admin"));
    expect((await tech.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "a.pdf", sheets: SHEETS } })).status).toBe(403);
    expect((await tech.json("/api/catalog/parts/MB000300", { method: "PATCH", body: { wear: true } })).status).toBe(403);
    expect((await tech.json(`/api/catalog/machines/${m.id}/publish`, { body: {} })).status).toBe(403);
    expect((await tech.json(`/api/catalog/machines/${m.id}`)).status).toBe(200);
    const note = await tech.json("/api/catalog/parts/MB000300/notes", { body: { body: "Grease before fitting." } });
    expect(note.status).toBe(200);
    expect((await (await person("sales")).fetch(`/api/catalog/notes/${note.data.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await tech.fetch(`/api/catalog/notes/${note.data.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("rejects bad part codes and files that aren't what they claim", async () => {
    const svc = await person("service");
    const m = await machine(await person("admin"));
    expect((await svc.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "a.pdf", sheets: [{ rows: [{ code: "<b>hi</b>" }] }] } })).status).toBe(400);
    const imp = await svc.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "a.pdf", sheets: SHEETS } });
    const top = imp.data.sheets[0].id;
    const put = (bytes: Uint8Array, type: string) => app.request(`${env.ORIGIN}/api/catalog/sheets/${top}/drawing?w=100&h=80`, {
      method: "PUT", body: bytes, headers: { cookie: svc.cookie, origin: env.ORIGIN, "x-ronchi": "1", "content-type": type, "cf-connecting-ip": svc.ip },
    }, env);
    // An HTML page labelled as a PNG is refused; so is an SVG; a real PNG is kept.
    expect((await put(new TextEncoder().encode("<html><script>alert(1)</script>"), "image/png")).status).toBe(400);
    expect((await put(new TextEncoder().encode("<svg/>"), "image/svg+xml")).status).toBe(400);
    expect((await put(PNG, "image/png")).status).toBe(200);
    const got = await svc.fetch(`/api/catalog/sheets/${top}/drawing`);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("publishes to the customer parts site, without customer names, and customers then see it", async () => {
    const svc = await person("service");
    const m = await machine(await person("admin"), { customer: "Acme Bottling", site: "Springfield plant" });
    const imp = await svc.json(`/api/catalog/machines/${m.id}/import`, { body: { fileName: "a.pdf", pages: 2, sheets: SHEETS } });
    const top = imp.data.sheets[0].id;
    // Upload a drawing (raw bytes, with its size).
    const up = await env.FILES.put(`catalog/${top}/drawing`, PNG, { httpMetadata: { contentType: "image/png" } });
    expect(up).toBeTruthy();
    await env.DB.prepare("UPDATE catalog_sheets SET image_w = 100, image_h = 80 WHERE id = ?").bind(top).run();

    // A customer name in a part name blocks publishing.
    await svc.json("/api/catalog/parts/MB000300", { method: "PATCH", body: { nameEn: "O-ring for Acme Bottling" } });
    const blocked = await svc.json(`/api/catalog/machines/${m.id}/publish`, { body: {} });
    expect(blocked.status).toBe(400);
    expect(blocked.data.error).toContain("Acme Bottling");
    await svc.json("/api/catalog/parts/MB000300", { method: "PATCH", body: { nameEn: "O-ring", wear: true } });

    const pub = await svc.json(`/api/catalog/machines/${m.id}/publish`, { body: {} });
    expect(pub.status).toBe(200);
    expect(pub.data.files).toEqual([top]);
    expect((await svc.json(`/api/catalog/machines/${m.id}/publish/files`, { body: { sheets: pub.data.files } })).data.copied).toBe(1);
    expect(await partsEnv.PARTS_FILES.get(`sheets/${top}/drawing`)).not.toBeNull();

    // What reached the parts site: the catalog, and nothing from the business store.
    const dump = JSON.stringify([
      (await partsEnv.PARTS_DB.prepare("SELECT * FROM machines").all()).results,
      (await partsEnv.PARTS_DB.prepare("SELECT * FROM sheets").all()).results,
      (await partsEnv.PARTS_DB.prepare("SELECT * FROM parts").all()).results,
    ]);
    expect(dump).toContain(m.serial);
    expect(dump).not.toMatch(/Acme|Springfield/);

    // Staff set up the customer: a company, its machine and a sign-up link.
    const co = await svc.json("/api/customers", { body: { name: "Customer Co" } });
    expect(co.status).toBe(200);
    expect((await svc.json(`/api/customers/${co.data.id}/machines`, { method: "PUT", body: { machines: [{ serial: "9999ZZ" }] } })).status).toBe(400);
    expect((await svc.json(`/api/customers/${co.data.id}/machines`, { method: "PUT", body: { machines: [{ serial: m.serial }] } })).status).toBe(200);
    const inv = await svc.json(`/api/customers/${co.data.id}/invites`, { body: { email: "buyer@customer.example", name: "Buyer", role: "buyer" } });
    expect(inv.data.link).toMatch(/\/welcome#/);
    const list = await svc.json("/api/customers");
    const company = list.data.companies.find((c: any) => c.id === co.data.id);
    expect(company.machines.map((x: any) => x.serial)).toEqual([m.serial]);
    expect(company.invites).toHaveLength(1);
  });

  it("customer and quote management is for sales, service, billing and admin only", async () => {
    const tech = await person("tech");
    const eng = await person("engineering");
    expect((await tech.fetch("/api/customers")).status).toBe(403);
    expect((await eng.fetch("/api/customers")).status).toBe(403);
    expect((await tech.fetch("/api/quotes")).status).toBe(403);
    expect((await (await person("sales")).fetch("/api/customers")).status).toBe(200);
    expect((await (await person("billing")).fetch("/api/quotes")).status).toBe(200);
  });

  it("says plainly when the parts site isn't connected", async () => {
    connectPartsSite(false);
    try {
      const r = await (await person("admin")).json("/api/customers");
      expect(r.status).toBe(503);
      expect(r.data.error).toMatch(/isn't connected/);
    } finally {
      connectPartsSite();
    }
  });
});

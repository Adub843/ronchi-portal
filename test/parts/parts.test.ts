// The customer parts site. The most important tests here are the wall between companies:
// a customer only ever reaches the machines Ronchi America linked to their company.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { adminCall, Browser, company, customer, publish } from "./helpers";

describe("publish door (/admin)", () => {
  it("is invisible without the key, with a wrong key, and to a signed-in customer", async () => {
    expect((await adminCall("/companies", { key: null })).status).toBe(404);
    expect((await adminCall("/companies", { key: "x".repeat(40) })).status).toBe(404);
    expect((await adminCall("/companies", { key: env.TEST_ADMIN_KEY + "x" })).status).toBe(404);
    const co = await company(["1001AA"]);
    const c = await customer(co, "buyer");
    expect((await c.fetch("/admin/companies")).status).toBe(404);
    expect((await adminCall("/companies")).status).toBe(200);
  });

  it("logs refused calls", async () => {
    await adminCall("/quotes", { key: null });
    const row = await env.PARTS_DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.refused'").first<{ n: number }>();
    expect(row!.n).toBeGreaterThan(0);
  });

  it("rejects bad machine numbers, sheet ids and part codes", async () => {
    expect((await adminCall("/publish", { body: { machine: { serial: "../x" }, sheets: [], parts: [] } })).status).toBe(400);
    expect((await adminCall("/publish", { body: { machine: { serial: "1002AA" }, sheets: [{ id: "<script>" }], parts: [] } })).status).toBe(400);
    expect((await adminCall("/publish", { body: { machine: { serial: "1002AA" }, sheets: [{ id: "sheet-ok-123", rows: [{ code: "DROP TABLE" }] }], parts: [] } })).status).toBe(400);
  });
});

describe("the wall between companies", () => {
  it("each customer sees only their own machines, sheets, files, parts and search results", async () => {
    const a = await company(["2001AA"]);
    const b = await company(["2002BB"]);
    const sa = await publish("2001AA");
    const sb = await publish("2002BB");
    await env.PARTS_FILES.put(`sheets/${sb.top}/drawing`, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/webp" } });
    const alice = await customer(a);

    const machines = await alice.json("/api/machines");
    expect(machines.data.machines.map((m: any) => m.serial)).toEqual(["2001AA"]);

    expect((await alice.json("/api/machines/2001AA")).status).toBe(200);
    expect((await alice.json("/api/machines/2002BB")).status).toBe(404);
    expect((await alice.json(`/api/sheets/${sa.top}`)).status).toBe(200);
    expect((await alice.json(`/api/sheets/${sb.top}`)).status).toBe(404);
    expect((await alice.fetch(`/api/sheets/${sb.top}/drawing`)).status).toBe(404);
    expect((await alice.json("/api/machines/2002BB/spares")).status).toBe(404);

    // A part only on company B's machine: not found for A.
    expect((await alice.json("/api/parts/MB200201")).status).toBe(404);
    expect((await alice.json("/api/parts/MB200101")).status).toBe(200);
    // A shared part shows where-used on A's machines only.
    const shared = await alice.json("/api/parts/MB000200");
    expect(shared.data.usedOn.map((u: any) => u.serial)).toEqual(["2001AA"]);

    const search = await alice.json("/api/search?q=Bolt");
    expect(search.data.results.map((r: any) => r.serial)).toEqual(["2001AA"]);
    // Wildcards are text, not patterns.
    expect((await alice.json("/api/search?q=%25%25")).data.results).toEqual([]);
  });

  it("can't put another company's part or machine in a cart", async () => {
    const a = await company(["2101AA"]);
    await company(["2102BB"]);
    await publish("2101AA");
    await publish("2102BB");
    const alice = await customer(a);
    expect((await alice.json("/api/carts/active/lines", { body: { code: "MB210201", qty: 1 } })).status).toBe(400);
    expect((await alice.json("/api/carts/active/lines", { body: { code: "MB000300", qty: 1, serial: "2102BB" } })).status).toBe(400);
    expect((await alice.json("/api/carts/active/lines", { body: { code: "MB000300", qty: 1, serial: "2101AA" } })).status).toBe(200);
  });

  it("carts are personal, lists and quotes are shared within the company only", async () => {
    const a = await company(["2201AA"]);
    const b = await company(["2202BB"]);
    await publish("2201AA");
    await publish("2202BB");
    const alice = await customer(a, "buyer");
    const andy = await customer(a);
    const bob = await customer(b, "buyer");

    const add = await alice.json("/api/carts/active/lines", { body: { code: "MB220101", qty: 2, serial: "2201AA" } });
    const cartId = add.data.cartId;
    expect((await andy.json(`/api/carts/${cartId}`)).status).toBe(404);
    expect((await bob.json(`/api/carts/${cartId}`)).status).toBe(404);
    expect((await bob.json(`/api/carts/${cartId}/lines`, { body: { code: "MB000300", qty: 1 } })).status).toBe(404);

    const list = await alice.json("/api/lists", { body: { name: "Shutdown spares", fromCart: cartId } });
    expect(list.status).toBe(200);
    expect((await andy.json(`/api/lists/${list.data.id}`)).status).toBe(200);
    expect((await bob.json(`/api/lists/${list.data.id}`)).status).toBe(404);
    expect((await bob.fetch(`/api/lists/${list.data.id}/csv`)).status).toBe(404);

    const quote = await alice.json(`/api/carts/${cartId}/quote`, { body: { email: "buyer@example.com" } });
    expect(quote.status).toBe(200);
    expect(quote.data.number).toMatch(/^RQ-\d{6}-[0-9A-F]{5}$/);
    expect((await andy.json("/api/quotes")).data.quotes.map((q: any) => q.id)).toContain(quote.data.id);
    expect((await bob.json("/api/quotes")).data.quotes.map((q: any) => q.id)).not.toContain(quote.data.id);
    expect((await bob.json(`/api/quotes/${quote.data.id}`)).status).toBe(404);
  });

  it("favorites only point at the company's own machines and sheets", async () => {
    const a = await company(["2301AA"]);
    await company(["2302BB"]);
    const sa = await publish("2301AA");
    const sb = await publish("2302BB");
    const alice = await customer(a);
    expect((await alice.fetch("/api/favorites/machine/2302BB", { method: "PUT" })).status).toBe(404);
    expect((await alice.fetch(`/api/favorites/sheet/${sb.top}`, { method: "PUT" })).status).toBe(404);
    expect((await alice.fetch(`/api/favorites/sheet/${sa.top}`, { method: "PUT" })).status).toBe(200);
  });
});

describe("sign-in and roles", () => {
  it("nothing in the catalog without signing in", async () => {
    const anon = new Browser();
    for (const p of ["/api/machines", "/api/machines/2001AA", "/api/search?q=MB", "/api/carts", "/api/quotes", "/api/favorites"]) {
      expect((await anon.fetch(p)).status, p).toBe(401);
    }
  });

  it("a returning customer signs in with their passkey", async () => {
    const co = await company(["2401AA"]);
    const c = await customer(co);
    await c.fetch("/api/auth/logout", { method: "POST" });
    expect((await c.json("/api/auth/me")).data.user).toBeNull();
    expect((await c.signIn()).status).toBe(200);
    expect((await c.json("/api/auth/me")).data.user.email).toBe(c.email);
  });

  it("only a buyer can send a quote request", async () => {
    const co = await company(["2501AA"]);
    await publish("2501AA");
    const std = await customer(co);
    const add = await std.json("/api/carts/active/lines", { body: { code: "MB250101", qty: 1 } });
    expect((await std.json(`/api/carts/${add.data.cartId}/quote`, { body: { email: "x@example.com" } })).status).toBe(403);
  });

  it("an invite link works once", async () => {
    const co = await company(["2601AA"]);
    const inv = await adminCall(`/companies/${co}/invites`, { body: { email: "once@example.com", name: "Once" } });
    await new Browser().acceptInvite(inv.data.link);
    await expect(new Browser().acceptInvite(inv.data.link)).rejects.toThrow(/410/);
  });

  it("disabling a company ends its sessions and blocks sign-in", async () => {
    const co = await company(["2701AA"]);
    const c = await customer(co);
    expect((await c.fetch("/api/machines")).status).toBe(200);
    await adminCall(`/companies/${co}`, { method: "PATCH", body: { status: "disabled" } });
    expect((await c.fetch("/api/machines")).status).toBe(401);
    expect((await c.signIn()).status).toBe(401);
  });

  it("a machine shows before its catalog is published, but still only to its own company", async () => {
    const a = await company(["2901AA", "2902AA"]);
    const b = await company(["2903BB"]);
    await publish("2901AA");
    const alice = await customer(a);
    const list = (await alice.json("/api/machines")).data.machines;
    expect(list.map((m: any) => [m.serial, m.sheets])).toEqual([["2901AA", 2], ["2902AA", 0]]);
    const bare = await alice.json("/api/machines/2902AA");
    expect(bare.status).toBe(200);
    expect(bare.data.sheets).toEqual([]);
    expect((await alice.json("/api/machines/2902AA/spares")).status).toBe(200);
    // Unpublished machines of another company stay "not found".
    expect((await alice.json("/api/machines/2903BB")).status).toBe(404);
    const bob = await customer(b);
    expect((await bob.json("/api/machines")).data.machines.map((m: any) => m.serial)).toEqual(["2903BB"]);
    expect((await bob.json("/api/machines/2902AA")).status).toBe(404);
    // A machine-number search finds the company's own machines only, catalog or not.
    expect((await alice.json("/api/search?q=290")).data.machines.map((m: any) => m.serial)).toEqual(["2901AA", "2902AA"]);
    expect((await bob.json("/api/search?q=2902")).data.machines).toEqual([]);
  });

  it("Ronchi America machine numbers (RA1018) work for companies", async () => {
    const co = await company(["RA1018"]);
    const c = await customer(co);
    expect((await c.json("/api/machines")).data.machines.map((m: any) => m.serial)).toEqual(["RA1018"]);
  });

  it("removing a machine from a company takes it away at once", async () => {
    const co = await company(["2801AA", "2802AA"]);
    await publish("2801AA");
    await publish("2802AA");
    const c = await customer(co);
    expect((await c.fetch("/api/machines/2802AA")).status).toBe(200);
    await adminCall(`/companies/${co}/machines`, { method: "PUT", body: { machines: [{ serial: "2801AA" }] } });
    expect((await c.fetch("/api/machines/2802AA")).status).toBe(404);
  });

  it("blocks changes from other sites", async () => {
    const co = await company(["2901AA"]);
    const c = await customer(co);
    expect((await c.fetch("/api/carts", { method: "POST", body: {}, headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await c.fetch("/api/carts", { method: "POST", body: {}, headers: { "x-ronchi": "0" } })).status).toBe(403);
  });
});

describe("catalog", () => {
  it("a sheet links to its sub-assembly and back", async () => {
    const co = await company(["3001AA"]);
    const s = await publish("3001AA");
    const c = await customer(co);
    const top = await c.json(`/api/sheets/${s.top}`);
    const clutch = top.data.rows.find((r: any) => r.code === "MB000200");
    expect(clutch.sub_sheet).toBe(s.sub);
    expect(clutch.hotspots).toHaveLength(1);
    const sub = await c.json(`/api/sheets/${s.sub}`);
    expect(sub.data.sheet.path.map((p: any) => p.id)).toEqual([s.top]);
    const spares = await c.json("/api/machines/3001AA/spares");
    expect(spares.data.spares.map((p: any) => p.code)).toEqual(["MB000300"]);
  });

  it("republishing replaces the catalog and deletes the files of sheets that are gone", async () => {
    const co = await company(["3101AA"]);
    const first = await publish("3101AA");
    await env.PARTS_FILES.put(`sheets/${first.sub}/drawing`, new Uint8Array([1]));
    await publish("3101AA", "-v2");
    expect(await env.PARTS_FILES.get(`sheets/${first.sub}/drawing`)).toBeNull();
    const c = await customer(co);
    expect((await c.json(`/api/sheets/${first.top}`)).status).toBe(404);
  });

  it("drawings are served sandboxed and only with the right type", async () => {
    const co = await company(["3201AA"]);
    const s = await publish("3201AA");
    expect((await adminCall(`/files/sheets/${s.top}/drawing`, { method: "PUT", raw: "<svg onload=alert(1)>", type: "image/svg+xml" })).status).toBe(400);
    expect((await adminCall(`/files/sheets/${s.top}/drawing`, { method: "PUT", raw: new Uint8Array([1, 2, 3]), type: "image/webp" })).status).toBe(200);
    const c = await customer(co);
    const res = await c.fetch(`/api/sheets/${s.top}/drawing`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

// Quick links on Home (Aaron, 2026-11-25: "the ability to ad links with buttons to peoples home page
// for quick links to their websites that i eneter, the ability to name the button as well").
import { describe, expect, it } from "vitest";
import { cleanUrl } from "../../src/portal/routes/links";
import { person } from "./helpers";

const labels = async (p: Awaited<ReturnType<typeof person>>) => ((await p.json("/api/links")).data.links as { label: string }[]).map((l) => l.label);

describe("quick links", () => {
  it("an admin adds a named button for everyone, some roles, or some people", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const sales = await person("sales");
    const tag = crypto.randomUUID().slice(0, 4);
    const everyone = await admin.json("/api/links", { body: { label: `SharePoint ${tag}`, url: "ronchiam.sharepoint.com" } });
    expect(everyone.status).toBe(200);
    await admin.json("/api/links", { body: { label: `Service ${tag}`, url: "https://service.ronchi.it", audience: { roles: ["tech"], people: [] } } });
    await admin.json("/api/links", { body: { label: `Andrew ${tag}`, url: "https://www.ronchi.it", audience: { roles: [], people: [sales.id] } } });
    const all = (await admin.json("/api/links?all=1")).data.links;
    expect(all.find((l: any) => l.label === `SharePoint ${tag}`).url).toBe("https://ronchiam.sharepoint.com/");
    expect(await labels(tech)).toEqual(expect.arrayContaining([`SharePoint ${tag}`, `Service ${tag}`]));
    expect(await labels(tech)).not.toContain(`Andrew ${tag}`);
    expect(await labels(sales)).toEqual(expect.arrayContaining([`SharePoint ${tag}`, `Andrew ${tag}`]));
    expect(await labels(sales)).not.toContain(`Service ${tag}`);
    // ?all=1 only widens the list for admins.
    expect((await tech.json("/api/links?all=1")).data.links.map((l: any) => l.label)).not.toContain(`Andrew ${tag}`);
  });

  it("renames, re-points, reorders and removes", async () => {
    const admin = await person("admin");
    const tag = crypto.randomUUID().slice(0, 4);
    const a = (await admin.json("/api/links", { body: { label: `A ${tag}`, url: "https://a.example.com" } })).data.id;
    const b = (await admin.json("/api/links", { body: { label: `B ${tag}`, url: "https://b.example.com" } })).data.id;
    expect((await admin.json(`/api/links/${a}`, { method: "PATCH", body: { label: `A2 ${tag}`, url: "https://a2.example.com" } })).status).toBe(200);
    await admin.json("/api/links/order", { body: { ids: [b, a] } });
    const mine = (await admin.json("/api/links?all=1")).data.links.filter((l: any) => l.label.endsWith(tag));
    expect(mine.map((l: any) => l.label)).toEqual([`B ${tag}`, `A2 ${tag}`]);
    expect((await admin.fetch(`/api/links/${b}`, { method: "DELETE" })).status).toBe(200);
    expect(await labels(admin)).not.toContain(`B ${tag}`);
  });

  it("only admins change links, and only real web addresses are allowed", async () => {
    const admin = await person("admin");
    const manager = await person("manager");
    expect((await manager.json("/api/links", { body: { label: "Mine", url: "https://example.com" } })).status).toBe(403);
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "https://user:pass@example.com", "nothing"]) {
      expect((await admin.json("/api/links", { body: { label: "Bad", url: bad } })).status, bad).toBe(400);
    }
    expect((await admin.json("/api/links", { body: { label: "", url: "https://example.com" } })).status).toBe(400);
    expect((await admin.json("/api/links", { body: { label: "Bad role", url: "https://example.com", audience: { roles: ["nope"] } } })).status).toBe(400);
    expect(cleanUrl("www.ronchi.it")).toBe("https://www.ronchi.it/");
  });
});

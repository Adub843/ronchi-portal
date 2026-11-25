// Live updates (Aaron, 2026-11-25: the portal "updates every time a user presses enter or changes anything
// or uploads a file"): every change bumps its area's number so open pages reload (src/portal/lib/live.ts).
// Also: the new parts of the portal each have their own Command center switch.
import { describe, expect, it } from "vitest";
import { topicFor } from "../../src/portal/lib/live";
import { SECTIONS } from "../../src/portal/lib/settings";
import { person } from "./helpers";

describe("live updates", () => {
  it("knows which area each API path belongs to", () => {
    expect(topicFor("/api/jobs/abc")).toBe("jobs");
    expect(topicFor("/api/files/x")).toBe("boards");
    expect(topicFor("/api/quotes/1")).toBe("customers");
    expect(topicFor("/api/switches/workbook")).toBe("settings");
    expect(topicFor("/api/parts-orders/1")).toBe("parts-orders");
    expect(topicFor("/api/shipping/in")).toBe("shipping");
    expect(topicFor("/api/auth/logout")).toBeNull();
    expect(topicFor("/api/prefs")).toBeNull();
  });

  it("a change anyone makes moves its area's number, so other open pages reload", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const before = (await tech.json("/api/live")).data.revs.links ?? 0;
    await admin.json("/api/links", { body: { label: `Live ${crypto.randomUUID().slice(0, 4)}`, url: "https://www.ronchi.it" } });
    const after = (await tech.json("/api/live")).data.revs.links;
    expect(after).toBe(before + 1);
    // The alerts check carries the same numbers, so people with chats don't make a second request.
    expect((await tech.json("/api/boards/updates")).data.revs.links).toBe(after);
  });

  it("a refused change moves nothing", async () => {
    const tech = await person("tech");
    const before = (await tech.json("/api/live")).data.revs.links ?? 0;
    expect((await tech.fetch("/api/links", { method: "POST", body: { label: "x", url: "https://x.com" } })).status).toBe(403);
    expect((await tech.json("/api/live")).data.revs.links ?? 0).toBe(before);
  });
});

describe("new parts of the portal in the Command center", () => {
  it("parts orders, shipping and receiving, and time sheets and reports each have a switch", () => {
    expect(SECTIONS.partsSales.perms).toEqual(["psales.view", "psales.edit"]);
    expect(SECTIONS.shipping.perms).toEqual(["ship.view", "ship.edit"]);
    expect(SECTIONS.reports.perms).toEqual(["reports.write", "reports.review"]);
  });

  it("who gets them by role", async () => {
    const tech = (await (await person("tech")).json("/api/auth/me")).data.user.permissions as string[];
    expect(tech).toEqual(expect.arrayContaining(["reports.write", "ship.view"]));
    expect(tech).not.toContain("psales.view");
    const sales = (await (await person("sales")).json("/api/auth/me")).data.user.permissions as string[];
    expect(sales).toEqual(expect.arrayContaining(["psales.view", "psales.edit", "ship.edit"]));
  });
});

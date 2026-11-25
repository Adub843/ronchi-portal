import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { forgetSettings } from "../../src/portal/lib/settings-store";
import { person } from "./helpers";

// Portal command center (Settings > Command center): one owner (Aaron) sees it and flips every switch.
afterEach(async () => {
  await env.DB.prepare("DELETE FROM settings").run();
  await env.DB.prepare("DELETE FROM feature_switches").run();
  await env.DB.prepare("UPDATE users SET is_owner = 0").run();
  forgetSettings();
});

/** An admin who becomes the owner (allowed while nobody owns the portal yet). */
async function owner() {
  const a = await person("admin", { name: "Aaron" });
  const r = await a.json("/api/settings/owner", { body: { userId: a.id, confirm: "OWNER" } });
  expect(r.status).toBe(200);
  return a;
}

describe("Portal command center", () => {
  it("only the owner sees it once there is an owner; other admins don't", async () => {
    const aaron = await owner();
    const other = await person("admin");
    expect((await aaron.json("/api/auth/me")).data.user).toMatchObject({ owner: true });
    expect((await other.json("/api/auth/me")).data.user.permissions).not.toContain("settings.manage");
    expect((await other.fetch("/api/settings")).status).toBe(403);
    expect((await other.fetch("/api/switches/workbook", { method: "PUT", body: { on: false } })).status).toBe(403);
    expect((await other.fetch("/api/settings/owner", { body: { userId: other.id, confirm: "OWNER" } })).status).toBe(403);
    expect((await aaron.fetch("/api/settings")).status).toBe(200);
    expect((await aaron.fetch("/api/switches/workbook", { method: "PUT", body: { on: false } })).status).toBe(200);
  });

  it("other admins can't lock the owner out", async () => {
    const aaron = await owner();
    const other = await person("admin");
    expect((await other.fetch(`/api/users/${aaron.id}`, { method: "PATCH", body: { status: "disabled" } })).status).toBe(403);
    expect((await other.fetch(`/api/users/${aaron.id}`, { method: "PATCH", body: { role: "tech" } })).status).toBe(403);
    expect((await other.fetch(`/api/users/${aaron.id}/sign-out-everywhere`, { body: {} })).status).toBe(403);
    expect((await aaron.json("/api/auth/me")).data.user).not.toBeNull();
  });

  it("the owner can hand the command center to another admin, and only to an admin", async () => {
    const aaron = await owner();
    const next = await person("admin");
    const tech = await person("tech");
    expect((await aaron.fetch("/api/settings/owner", { body: { userId: tech.id, confirm: "OWNER" } })).status).toBe(400);
    expect((await aaron.fetch("/api/settings/owner", { body: { userId: next.id } })).status).toBe(400);
    expect((await aaron.json("/api/settings/owner", { body: { userId: next.id, confirm: "OWNER" } })).status).toBe(200);
    expect((await next.fetch("/api/settings")).status).toBe(200);
    expect((await aaron.fetch("/api/settings")).status).toBe(403);
  });

  it("has a switch for every part of the portal, and a switched-off part is closed to everyone else", async () => {
    const aaron = await owner();
    const r = await aaron.json("/api/settings");
    for (const s of ["chats", "jobs", "machines", "catalog", "customers", "changeParts", "knowledge", "software"]) expect(r.data.sections, s).toHaveProperty(s);
    expect(r.data.switches).toHaveProperty("workbook");
    const tech = await person("tech");
    expect((await tech.fetch("/api/jobs")).status).toBe(200);
    await aaron.json("/api/settings", { method: "PUT", body: { sections: { jobs: false } } });
    expect((await tech.fetch("/api/jobs")).status).toBe(403);
    expect((await aaron.fetch("/api/jobs")).status).toBe(200);
  });
});

describe("Command center: each person's access", () => {
  it("a change can last until a date, then the person goes back to what their role gives", async () => {
    const aaron = await owner();
    const tech = await person("tech");
    const soon = new Date(Date.now() + 3600_000).toISOString();
    expect((await aaron.fetch(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "orders.view": true }, until: soon } })).status).toBe(200);
    expect((await tech.fetch("/api/change-parts")).status).toBe(200);
    const list = await aaron.json("/api/users");
    expect(list.data.users.find((u: any) => u.id === tech.id).until).toEqual({ "orders.view": soon });
    // Time passes: the change has run out.
    await env.DB.prepare("UPDATE user_access SET expires_at = ? WHERE user_id = ?").bind(new Date(Date.now() - 1000).toISOString(), tech.id).run();
    expect((await tech.fetch("/api/change-parts")).status).toBe(403);
    expect((await aaron.fetch(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "orders.view": true }, until: "2000-01-01T00:00:00Z" } })).status).toBe(400);
  });

  it("copies another person's role and access in one step", async () => {
    const aaron = await owner();
    const model = await person("sales");
    const tech = await person("tech");
    await aaron.json(`/api/users/${model.id}/access`, { method: "PUT", body: { changes: { "files.send": false } } });
    const r = await aaron.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { copyFrom: model.id } });
    expect(r.status).toBe(200);
    const me = (await tech.json("/api/auth/me")).data.user;
    expect(me.role).toBe("sales");
    expect(me.permissions).toContain("orders.view");
    expect(me.permissions).not.toContain("files.send");
  });
});

// Fixes from the 2026-11-25 portal audit (owner protection, admin role, live-update noise, machine edits,
// job files with chats off). Each test is the failing scenario the audit found.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { topicFor } from "../../src/portal/lib/live";
import { forgetSettings } from "../../src/portal/lib/settings-store";
import { person } from "./helpers";

afterEach(async () => {
  await env.DB.prepare("DELETE FROM settings").run();
  await env.DB.prepare("UPDATE users SET is_owner = 0").run();
  forgetSettings();
});

describe("people: restore and the admin role", () => {
  it("restore can't be used to demote the owner (or anyone who wasn't removed)", async () => {
    const aaron = await person("admin", { name: "Aaron" });
    expect((await aaron.json("/api/settings/owner", { body: { userId: aaron.id, confirm: "OWNER" } })).status).toBe(200);
    const other = await person("admin");
    const r = await other.fetch(`/api/users/${aaron.id}/restore`, { body: { role: "tech" } });
    expect([403, 409]).toContain(r.status);
    expect((await aaron.json("/api/auth/me")).data.user.role).toBe("admin");
    const tech = await person("tech");
    expect((await other.fetch(`/api/users/${tech.id}/restore`, { body: { role: "sales" } })).status).toBe(409);
  });

  it("restore still brings back someone who was removed", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    expect((await admin.fetch(`/api/users/${tech.id}/remove`, { body: {} })).status).toBe(200);
    expect((await admin.fetch(`/api/users/${tech.id}/restore`, { body: { role: "service" } })).status).toBe(200);
  });

  it("nobody can be invited as, or made, an admin through the API", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    expect((await admin.fetch("/api/users/invite", { body: { name: "X", email: `x${crypto.randomUUID().slice(0, 6)}@ronchi.test`, role: "admin" } })).status).toBe(400);
    expect((await admin.fetch(`/api/users/${tech.id}`, { method: "PATCH", body: { role: "admin" } })).status).toBe(400);
  });
});

describe("live updates skip changes nobody else needs to see", () => {
  it("reading or muting a chat, scans and upload pieces don't reload other pages", () => {
    expect(topicFor("/api/boards/abc/read")).toBeNull();
    expect(topicFor("/api/boards/read-all")).toBeNull();
    expect(topicFor("/api/boards/abc/mute")).toBeNull();
    expect(topicFor("/api/kb/abc/scan")).toBeNull();
    expect(topicFor("/api/software/files/abc/parts/3")).toBeNull();
    expect(topicFor("/api/boards/abc/posts")).toBe("boards");
    expect(topicFor("/api/change-parts/import", true)).toBeNull();
  });

  it("a CSV import preview moves nothing; the real import does", async () => {
    const sales = await person("sales");
    const before = (await sales.json("/api/live")).data.revs["change-parts"] ?? 0;
    const csv = "Customer,Part,Status\nAcme Test,Star wheel,Open\n";
    expect((await sales.json("/api/change-parts/import", { body: { csv } })).status).toBe(200);
    expect((await sales.json("/api/live")).data.revs["change-parts"] ?? 0).toBe(before);
    expect((await sales.json("/api/change-parts/import", { body: { csv, confirm: true } })).status).toBe(200);
    expect((await sales.json("/api/live")).data.revs["change-parts"]).toBe(before + 1);
  });
});

describe("machines", () => {
  it("a field left out of a save keeps its value, and a stale save is refused", async () => {
    const svc = await person("service");
    const serial = `${1000 + Math.floor(Math.random() * 8999)}MB`;
    const { data } = await svc.json("/api/machines", { body: { serial, model: "Monoblock", customer: "Acme Test", site: "Plant 1", notes: "keep me" } });
    const m1 = (await svc.json(`/api/machines/${data.id}`)).data.machine;
    expect((await svc.fetch(`/api/machines/${data.id}`, { method: "PATCH", body: { site: "Plant 2", updated_at: m1.updated_at } })).status).toBe(200);
    const m2 = (await svc.json(`/api/machines/${data.id}`)).data.machine;
    expect(m2).toMatchObject({ site: "Plant 2", notes: "keep me", model: "Monoblock" });
    expect((await svc.fetch(`/api/machines/${data.id}`, { method: "PATCH", body: { site: "Plant 3", updated_at: "2000-01-01T00:00:00.000Z" } })).status).toBe(409);
  });
});

describe("job files when chats are switched off", () => {
  it("field service engineers can still add files to a job", async () => {
    const admin = await person("admin");
    await admin.json("/api/settings", { method: "PUT", body: { sections: { chats: false } } });
    const tech = await person("tech");
    const perms: string[] = (await tech.json("/api/auth/me")).data.user.permissions;
    expect(perms).not.toContain("files.send");
    expect(perms).toContain("jobs.view");
  });
});

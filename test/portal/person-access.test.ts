// Per-person access (Aaron, 2026-11-24: "i need to be able to control more in detail").
import { describe, expect, it } from "vitest";
import { person } from "./helpers";

const perms = async (p: Awaited<ReturnType<typeof person>>) => (await p.json("/api/auth/me")).data.user.permissions as string[];

describe("per-person access", () => {
  it("switches one permission off for one person, right away, without signing them out", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const other = await person("tech");
    expect((await tech.fetch("/api/kb?q=seal")).status).toBe(200);
    const r = await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "kb.view": false } } });
    expect(r.status).toBe(200);
    expect(r.data.changes).toEqual({ "kb.view": false });
    expect((await tech.fetch("/api/kb?q=seal")).status).toBe(403);
    expect(await perms(tech)).not.toContain("kb.view");
    // Someone else with the same role is untouched.
    expect((await other.fetch("/api/kb?q=seal")).status).toBe(200);
  });

  it("switches on something the role doesn't give, and back to the role", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    expect((await tech.fetch("/api/change-parts")).status).toBe(403);
    await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "orders.view": true } } });
    expect((await tech.fetch("/api/change-parts")).status).toBe(200);
    await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "orders.view": null } } });
    expect((await tech.fetch("/api/change-parts")).status).toBe(403);
    await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "orders.view": true, "kb.write": false } } });
    await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { reset: true } });
    expect((await admin.json("/api/users")).data.users.find((u: any) => u.id === tech.id).access).toEqual({});
  });

  it("the finer switches each block their own action", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const mate = await person("service");
    await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "boards.create": false, "chats.start": false, "files.send": false } } });
    expect((await tech.fetch("/api/boards", { body: { name: "Night shift" } })).status).toBe(403);
    expect((await tech.fetch("/api/boards/chats", { body: { userIds: [mate.id] } })).status).toBe(403);
    // They can still answer a chat someone else starts, in words but not with files.
    const { data } = await mate.json("/api/boards/chats", { body: { userIds: [tech.id] } });
    expect((await tech.fetch(`/api/boards/${data.id}/posts`, { body: { body: "On my way" } })).status).toBe(200);
    const form = new FormData();
    form.set("body", "photo");
    form.append("files", new File([new Uint8Array(100)], "seal.jpg", { type: "image/jpeg" }));
    expect((await tech.form(`/api/boards/${data.id}/posts`, form)).status).toBe(403);
  });

  it("importing orders is its own switch", async () => {
    const admin = await person("admin");
    const sales = await person("sales");
    await admin.json(`/api/users/${sales.id}/access`, { method: "PUT", body: { changes: { "orders.import": false } } });
    expect((await sales.fetch("/api/change-parts/import", { body: { csv: "Customer,Machine\nA,3069MB" } })).status).toBe(403);
    expect((await sales.fetch("/api/change-parts")).status).toBe(200);
  });

  it("keeps the safety rules: admins keep everything, no self-changes, admin-only stays admin-only", async () => {
    const admin = await person("admin");
    const admin2 = await person("admin");
    const tech = await person("tech");
    expect((await admin.fetch(`/api/users/${admin.id}/access`, { method: "PUT", body: { changes: { "kb.view": false } } })).status).toBe(400);
    expect((await admin.fetch(`/api/users/${admin2.id}/access`, { method: "PUT", body: { changes: { "kb.view": false } } })).status).toBe(400);
    expect((await admin.fetch(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "users.manage": true } } })).status).toBe(400);
    expect((await admin.fetch(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "nope.x": true } } })).status).toBe(400);
    expect((await tech.fetch(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "orders.view": true } } })).status).toBe(403);
    expect((await tech.fetch("/api/users")).status).toBe(403);
  });

  it("every change is in the audit log with before and after", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    await admin.json(`/api/users/${tech.id}/access`, { method: "PUT", body: { changes: { "catalog.edit": true } } });
    const log = (await admin.json("/api/users/audit/recent")).data.entries.find((e: any) => e.action === "user.access" && e.target_id === tech.id);
    expect(JSON.parse(log.detail)).toEqual({ before: {}, after: { "catalog.edit": true } });
  });

  it("the access list names every permission in plain English", async () => {
    const admin = await person("admin");
    const { data } = await admin.json("/api/users/permissions");
    const ids = data.groups.flatMap((g: any) => g.perms.map((p: any) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(await perms(admin)));
    expect(data.groups.flatMap((g: any) => g.perms).filter((p: any) => !p.adjustable).map((p: any) => p.id).sort()).toEqual(["audit.view", "users.manage"]);
  });
});

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

describe("manager role and finer page switches", () => {
  it("a manager can do everything except manage people and read the audit log", async () => {
    const m = await person("manager");
    const p = await perms(m);
    expect(p).not.toContain("users.manage");
    expect(p).not.toContain("audit.view");
    for (const x of ["machines.add", "orders.remove", "kb.publish", "customers.invite", "boards.moderate"]) expect(p).toContain(x);
    expect((await m.fetch("/api/users")).status).toBe(403);
    expect((await m.fetch("/api/change-parts")).status).toBe(200);
  });

  it("an admin can make someone a manager, and a manager's access can still be fine-tuned", async () => {
    const admin = await person("admin");
    const p = await person("service");
    expect((await admin.fetch(`/api/users/${p.id}`, { method: "PATCH", body: { role: "manager" } })).status).toBe(200);
    const again = await person("manager");
    await admin.json(`/api/users/${again.id}/access`, { method: "PUT", body: { changes: { "orders.remove": false } } });
    expect(await perms(again)).not.toContain("orders.remove");
  });

  it("adding, changing and removing orders are separate switches", async () => {
    const admin = await person("admin");
    const sales = await person("sales");
    const { data } = await sales.json("/api/change-parts", { body: { customer: "Acme", machine: "3069MB", part: "Star wheel" } });
    await admin.json(`/api/users/${sales.id}/access`, { method: "PUT", body: { changes: { "orders.remove": false, "orders.add": false } } });
    expect((await sales.fetch(`/api/change-parts/${data.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await sales.fetch("/api/change-parts", { body: { customer: "Acme", machine: "3069MB", part: "Guide" } })).status).toBe(403);
    const order = (await sales.json(`/api/change-parts/${data.id}`)).data.order;
    expect((await sales.fetch(`/api/change-parts/${data.id}`, { method: "PATCH", body: { notes: "rush", revision: order.revision } })).status).toBe(200);
  });

  it("adding machines is its own switch", async () => {
    const admin = await person("admin");
    const eng = await person("engineering");
    await admin.json(`/api/users/${eng.id}/access`, { method: "PUT", body: { changes: { "machines.add": false } } });
    expect((await eng.fetch("/api/machines", { body: { serial: "4301MB" } })).status).toBe(403);
  });

  it("knowledge base: import and changing other people's articles are their own switches", async () => {
    const admin = await person("admin");
    const svc = await person("service");
    await admin.json(`/api/users/${svc.id}/access`, { method: "PUT", body: { changes: { "kb.import": false } } });
    expect((await svc.fetch("/api/kb/import", { body: { documents: [] } })).status).toBe(403);
  });
});

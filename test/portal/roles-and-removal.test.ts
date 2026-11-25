// Roles an admin makes, and removing employees (Aaron, 2026-11-25: "i need to be able to add and
// remove employees" and "i also need to able to add and create rolls").
import { describe, expect, it } from "vitest";
import { person } from "./helpers";

const perms = async (p: Awaited<ReturnType<typeof person>>) => (await p.json("/api/auth/me")).data.user.permissions as string[];

describe("roles an admin makes", () => {
  it("makes a role, gives it to someone through an invite, and its switches apply", async () => {
    const admin = await person("admin");
    const made = await admin.json("/api/users/roles", { body: { name: `Shipping ${crypto.randomUUID().slice(0, 4)}`, copyFrom: "tech" } });
    expect(made.status).toBe(200);
    const id = made.data.id as string;
    // Change its switches: catalog and orders to look at, no knowledge base writing.
    const r = await admin.json(`/api/users/roles/${id}`, { method: "PATCH", body: { perms: ["boards.use", "catalog.view", "orders.view", "kb.view"] } });
    expect(r.status).toBe(200);
    const inv = await admin.json("/api/users/invite", { body: { name: "Olivia", email: `olivia-${crypto.randomUUID().slice(0, 6)}@example.com`, role: id } });
    expect(inv.status).toBe(200);
    const olivia = await person(id);
    expect((await perms(olivia)).sort()).toEqual(["boards.use", "catalog.view", "kb.view", "orders.view"]);
    expect((await olivia.fetch("/api/change-parts")).status).toBe(200);
    expect((await olivia.fetch("/api/change-parts", { body: { customer: "X" } })).status).toBe(403);
    // A change to the role reaches people who already have it, on their next click.
    await admin.json(`/api/users/roles/${id}`, { method: "PATCH", body: { perms: ["boards.use"] } });
    expect((await olivia.fetch("/api/change-parts")).status).toBe(403);
    // The role shows up in the list, with its people count, and its name in the pickers.
    const list = await admin.json("/api/users/roles");
    expect(list.data.list.find((x: any) => x.id === id)).toMatchObject({ builtIn: false, people: 1, perms: ["boards.use"] });
    expect(list.data.named[id]).toMatch(/^Shipping/);
    // Boards can be shared with it.
    expect((await admin.fetch("/api/boards", { body: { name: "Dock", audience: [id] } })).status).toBe(200);
  });

  it("can't delete a role while people have it; can once they don't", async () => {
    const admin = await person("admin");
    const { data } = await admin.json("/api/users/roles", { body: { name: `Shop ${crypto.randomUUID().slice(0, 4)}` } });
    const someone = await person(data.id);
    expect((await admin.fetch(`/api/users/roles/${data.id}`, { method: "DELETE" })).status).toBe(409);
    await admin.json(`/api/users/${someone.id}`, { method: "PATCH", body: { role: "service" } });
    expect((await admin.fetch(`/api/users/roles/${data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await admin.json("/api/users/invite", { body: { name: "X", email: `x-${crypto.randomUUID().slice(0, 6)}@example.com`, role: data.id } })).status).toBe(400);
  });

  it("changes a built-in role and puts it back", async () => {
    const admin = await person("admin");
    const eng = await person("engineering");
    expect(await perms(eng)).toContain("kb.write");
    await admin.json("/api/users/roles/engineering", { method: "PATCH", body: { name: "Engineering", perms: ["boards.use", "kb.view"] } });
    expect(await perms(eng)).not.toContain("kb.write");
    await admin.json("/api/users/roles/engineering/reset", { body: {} });
    expect(await perms(eng)).toContain("kb.write");
  });

  it("keeps the rules: names are unique, admin can't change, admin-only switches stay out, managers can't make roles", async () => {
    const admin = await person("admin");
    const manager = await person("manager");
    expect((await admin.json("/api/users/roles", { body: { name: "sales" } })).status).toBe(409);
    expect((await admin.json("/api/users/roles/admin", { method: "PATCH", body: { perms: [] } })).status).toBe(400);
    expect((await admin.json("/api/users/roles", { body: { name: `Boss ${crypto.randomUUID().slice(0, 4)}`, perms: ["users.manage"] } })).status).toBe(400);
    expect((await manager.json("/api/users/roles", { body: { name: "Mine" } })).status).toBe(403);
    expect((await admin.fetch("/api/users/roles/sales", { method: "DELETE" })).status).toBe(400);
  });
});

describe("removing employees", () => {
  it("removes someone: signed out, can't come back, kept on a removed list; restore brings them back", async () => {
    const admin = await person("admin");
    const joe = await person("service", { name: "Joe" });
    expect((await joe.fetch("/api/auth/me")).status).toBe(200);
    expect((await admin.json(`/api/users/${joe.id}/remove`, { body: {} })).status).toBe(200);
    expect((await joe.json("/api/auth/me")).data.user).toBeNull();
    const row = (await admin.json("/api/users")).data.users.find((u: any) => u.id === joe.id);
    expect(row.removed_at).toBeTruthy();
    expect(row.status).toBe("disabled");
    // Inviting the same address again points to Restore instead of making a second login.
    const again = await admin.json("/api/users/invite", { body: { name: "Joe", email: joe.email, role: "service" } });
    expect(again.status).toBe(409);
    expect(again.data.error).toMatch(/Restore/);
    expect((await admin.json(`/api/users/${joe.id}/restore`, { body: {} })).status).toBe(200);
    const back = (await admin.json("/api/users")).data.users.find((u: any) => u.id === joe.id);
    expect(back).toMatchObject({ status: "active", removed_at: null });
  });

  it("a removed person only comes back through Restore, not by switching them on or changing their role", async () => {
    const admin = await person("admin");
    const ann = await person("sales", { name: "Ann" });
    expect((await admin.json(`/api/users/${ann.id}/remove`, { body: {} })).status).toBe(200);
    expect((await admin.json(`/api/users/${ann.id}`, { method: "PATCH", body: { status: "active" } })).status).toBe(409);
    expect((await admin.json(`/api/users/${ann.id}`, { method: "PATCH", body: { role: "tech" } })).status).toBe(409);
    const row = (await admin.json("/api/users")).data.users.find((u: any) => u.id === ann.id);
    expect(row).toMatchObject({ status: "disabled", role: "sales" });
    expect(row.removed_at).toBeTruthy();
  });

  it("restores into a new role when the old one was deleted", async () => {
    const admin = await person("admin");
    const { data } = await admin.json("/api/users/roles", { body: { name: `Temp ${crypto.randomUUID().slice(0, 4)}` } });
    const p = await person(data.id);
    await admin.json(`/api/users/${p.id}/remove`, { body: {} });
    expect((await admin.fetch(`/api/users/roles/${data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await admin.json(`/api/users/${p.id}/restore`, { body: {} })).status).toBe(409);
    expect((await admin.json(`/api/users/${p.id}/restore`, { body: { role: "admin" } })).status).toBe(400);
    expect((await admin.json(`/api/users/${p.id}/restore`, { body: { role: "sales" } })).status).toBe(200);
    expect((await p.json("/api/auth/me")).data.user).toBeNull(); // their old devices stay signed out
  });

  it("can't remove yourself or an admin, and only admins can remove", async () => {
    const admin = await person("admin");
    const other = await person("admin");
    const manager = await person("manager");
    const tech = await person("tech");
    expect((await admin.json(`/api/users/${admin.id}/remove`, { body: {} })).status).toBe(400);
    expect((await admin.json(`/api/users/${other.id}/remove`, { body: {} })).status).toBe(400);
    expect((await manager.json(`/api/users/${tech.id}/remove`, { body: {} })).status).toBe(403);
  });
});

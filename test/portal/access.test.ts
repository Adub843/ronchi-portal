import { describe, expect, it } from "vitest";
import { person } from "./helpers";

describe("deny by default: each role sees only its part", () => {
  it("only admins manage people", async () => {
    for (const role of ["tech", "sales", "billing", "scheduling", "service", "engineering"]) {
      const p = await person(role);
      expect((await p.fetch("/api/users")).status, role).toBe(403);
      expect((await p.fetch("/api/users/invite", { body: { email: "a@b.co", name: "A", role: "admin" } })).status, role).toBe(403);
    }
    const admin = await person("admin");
    expect((await admin.fetch("/api/users")).status).toBe(200);
  });

  it("only billing and admin see everyone's hours and approve edits; scheduling can view", async () => {
    expect((await (await person("tech")).fetch("/api/clock/hours")).status).toBe(403);
    expect((await (await person("sales")).fetch("/api/clock/hours")).status).toBe(403);
    expect((await (await person("scheduling")).fetch("/api/clock/hours")).status).toBe(200);
    expect((await (await person("scheduling")).fetch("/api/clock/edits")).status).toBe(403);
    expect((await (await person("billing")).fetch("/api/clock/edits")).status).toBe(200);
    expect((await (await person("billing")).fetch("/api/clock/hours/export")).status).toBe(200);
  });

  it("sales can view machines but not change them", async () => {
    const sales = await person("sales");
    expect((await sales.fetch("/api/machines")).status).toBe(200);
    expect((await sales.fetch("/api/machines", { body: { serial: "3069MB" } })).status).toBe(403);
  });

  it("an admin can't lock themselves out", async () => {
    const admin = await person("admin");
    const r = await admin.json(`/api/users/${admin.id}`, { method: "PATCH", body: { role: "tech" } });
    expect(r.status).toBe(400);
  });

  it("changing someone's role signs them out so the new rules apply at once", async () => {
    const admin = await person("admin");
    const p = await person("billing");
    await admin.json(`/api/users/${p.id}`, { method: "PATCH", body: { role: "tech" } });
    expect((await p.json("/api/auth/me")).data.user).toBeNull();
  });

  it("an admin invite returns a one-time link and records it in the audit log", async () => {
    const admin = await person("admin");
    const r = await admin.json("/api/users/invite", { body: { email: "lola@example.com", name: "Lola Parker", role: "billing" } });
    expect(r.data.link).toMatch(/\/welcome#[A-Za-z0-9_-]{40,}$/);
    const log = await admin.json("/api/users/audit/recent");
    expect(log.data.entries.some((e: any) => e.action === "invite.create")).toBe(true);
  });
});

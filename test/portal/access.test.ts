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

  it("the portal has no time clock (removed 2026-11-24 at Aaron's request)", async () => {
    const admin = await person("admin");
    for (const path of ["/api/clock/status", "/api/clock/hours", "/api/time/now"]) expect((await admin.fetch(path)).status, path).toBe(404);
    expect((await admin.json("/api/auth/me")).data.user.permissions.some((p: string) => /clock|hours/.test(p))).toBe(false);
    // The clock was the only thing that read the phone's location, so browsers are told no page may ask for it.
    expect((await admin.fetch("/api/auth/me")).headers.get("permissions-policy")).toContain("geolocation=()");
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

  it("adding an employee makes their login at once (no link) and records it in the audit log", async () => {
    const admin = await person("admin");
    const r = await admin.json("/api/users/invite", { body: { email: "lola@example.com", name: "Lola Parker", role: "billing" } });
    expect(r.data).toMatchObject({ ok: true, login: "lola@example.com" });
    expect(r.data.link).toBeUndefined();
    const log = await admin.json("/api/users/audit/recent");
    expect(log.data.entries.some((e: any) => e.action === "user.add")).toBe(true);
  });

  it("a login can be a plain username instead of an email", async () => {
    const admin = await person("admin");
    const ok = await admin.fetch("/api/users/invite", { body: { email: "SteveW", name: "Steve Williams", role: "service" } });
    expect(ok.status).toBe(200);
    expect((await admin.json("/api/users")).data.users.some((u: any) => u.email === "SteveW" && !u.has_password)).toBe(true);
    for (const bad of ["ab", "steve w", "steve@", "<script>"]) {
      expect((await admin.fetch("/api/users/invite", { body: { email: bad, name: "X", role: "tech" } })).status, bad).toBe(400);
    }
  });
});

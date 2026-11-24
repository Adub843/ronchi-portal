import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createInvite } from "../../src/portal/lib/invites";
import { Browser, person } from "./helpers";

describe("passkey sign-in", () => {
  it("an invite creates a login, and the passkey signs in again later", async () => {
    const b = new Browser();
    const link = await createInvite(env, { email: "paolo@example.com", name: "Paolo Ferla", role: "admin", canTypeAddress: false, createdBy: null });
    expect(link).toMatch(/\/welcome#/);
    const check = await b.json("/api/auth/invite/check", { body: { token: link.split("#")[1] } });
    expect(check.data).toMatchObject({ name: "Paolo Ferla", role: "admin" });
    await b.acceptInvite(link);
    expect((await b.json("/api/auth/me")).data.user).toMatchObject({ name: "Paolo Ferla", role: "admin" });

    await b.fetch("/api/auth/logout", { body: {} });
    expect((await b.json("/api/auth/me")).data.user).toBeNull();

    const login = await b.signIn();
    expect(login.status).toBe(200);
    expect((await b.json("/api/auth/me")).data.user.name).toBe("Paolo Ferla");
  });

  it("an invite link works only once", async () => {
    const link = await createInvite(env, { email: "once@example.com", name: "Once", role: "tech", canTypeAddress: false, createdBy: null });
    await new Browser().acceptInvite(link);
    const again = await new Browser().json("/api/auth/register/options", { body: { token: link.split("#")[1] } });
    expect(again.status).toBe(410);
  });

  it("stores only hashes of session and invite tokens", async () => {
    const b = await person("tech");
    const token = b.cookie.split("=")[1]!;
    const raw = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id_hash = ?").bind(token).first<{ n: number }>();
    expect(raw?.n).toBe(0);
  });

  it("refuses a passkey signature made for another website", async () => {
    const b = await person("tech");
    await b.fetch("/api/auth/logout", { body: {} });
    const res = await b.signIn({ origin: "https://evil.example" });
    expect(res.status).toBe(401);
  });

  it("requires Face ID / fingerprint / PIN (user verification)", async () => {
    const b = await person("tech");
    await b.fetch("/api/auth/logout", { body: {} });
    expect((await b.signIn({ userVerified: false })).status).toBe(401);
  });

  it("a disabled person can't sign in and is signed out everywhere", async () => {
    const admin = await person("admin");
    const tech = await person("tech");
    const r = await admin.json(`/api/users/${tech.id}`, { method: "PATCH", body: { status: "disabled" } });
    expect(r.status).toBe(200);
    expect((await tech.json("/api/auth/me")).data.user).toBeNull();
    expect((await tech.signIn()).status).toBe(401);
  });

  it("blocks changes that don't come from the portal's own pages", async () => {
    const b = await person("tech");
    const res = await b.fetch("/api/boards", { body: { name: "x" }, headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    const noHeader = await b.fetch("/api/boards", { body: { name: "x" }, headers: { "x-ronchi": "0" } });
    expect(noHeader.status).toBe(403);
  });

  it("every response carries the security headers", async () => {
    const res = await new Browser().fetch("/api/auth/me");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("signed-out requests are refused", async () => {
    const b = new Browser();
    for (const path of ["/api/boards", "/api/machines", "/api/clock/status", "/api/users", "/api/prefs"]) {
      expect((await b.fetch(path)).status, path).toBe(401);
    }
  });
});

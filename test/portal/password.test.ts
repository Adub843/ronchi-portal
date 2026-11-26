import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createInvite } from "../../src/portal/lib/invites";
import { hashPassword, verifyPassword } from "../../src/shared/password";
import { Browser, person } from "./helpers";

const me = async (b: Browser) => (await b.json("/api/auth/me")).data.user;

async function addEmployee(admin: Browser, login: string, name = "Luca Rossi") {
  const r = await admin.json("/api/users/invite", { body: { name, email: login, role: "tech" } });
  expect(r.status).toBe(200);
  return r.data;
}

describe("username and password sign-in", () => {
  it("an admin adds a person; they make their own password at first sign-in, then sign in with it", async () => {
    const admin = await person("admin");
    expect(await addEmployee(admin, "LucaR")).toMatchObject({ login: "LucaR" });

    const b = new Browser();
    const first = await b.json("/api/auth/password/login", { body: { login: "LucaR", password: "" } });
    expect(first.data).toMatchObject({ firstTime: true, name: "Luca Rossi" });
    expect(await me(b)).toBeNull();

    expect((await b.json("/api/auth/password/first", { body: { login: "LucaR", password: "short" } })).status).toBe(400);
    expect((await b.json("/api/auth/password/first", { body: { login: "LucaR", password: "brescia-2026" } })).status).toBe(200);
    expect((await me(b)).name).toBe("Luca Rossi");

    await b.fetch("/api/auth/logout", { body: {} });
    expect(await me(b)).toBeNull();
    expect((await b.json("/api/auth/password/login", { body: { login: "LucaR", password: "brescia-2026" } })).status).toBe(200);
    expect((await me(b)).name).toBe("Luca Rossi");
  });

  it("finds the username whatever its case", async () => {
    const admin = await person("admin");
    await addEmployee(admin, "MarcoB", "Marco Bianchi");
    const b = new Browser();
    await b.json("/api/auth/password/first", { body: { login: "marcob", password: "brescia-2026" } });
    expect((await me(b)).name).toBe("Marco Bianchi");
  });

  it("refuses a wrong password, an unknown username, and a second 'first' password", async () => {
    const admin = await person("admin");
    await addEmployee(admin, "GiuliaV", "Giulia Verdi");
    const b = new Browser();
    await b.json("/api/auth/password/first", { body: { login: "GiuliaV", password: "brescia-2026" } });
    await b.fetch("/api/auth/logout", { body: {} });

    const wrong = await b.json("/api/auth/password/login", { body: { login: "GiuliaV", password: "nope-nope-nope" } });
    expect(wrong.status).toBe(401);
    expect(wrong.data.error).toBe("Wrong username or password.");
    expect((await b.json("/api/auth/password/login", { body: { login: "Nobody", password: "brescia-2026" } })).status).toBe(401);
    // Someone else can't take over a login that already has a password.
    expect((await new Browser().json("/api/auth/password/first", { body: { login: "GiuliaV", password: "attacker-pass" } })).status).toBe(409);
    expect(await me(b)).toBeNull();
  });

  it("stores only a salted hash, never the password", async () => {
    const admin = await person("admin");
    await addEmployee(admin, "AnnaN", "Anna Neri");
    await new Browser().json("/api/auth/password/first", { body: { login: "AnnaN", password: "brescia-2026" } });
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE email = 'AnnaN'").first<{ password_hash: string }>();
    expect(row?.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(row?.password_hash).not.toContain("brescia-2026");
    const again = await hashPassword("brescia-2026");
    expect(again).not.toBe(row?.password_hash); // a new salt every time
    expect(await verifyPassword("brescia-2026", again)).toBe(true);
    expect(await verifyPassword("brescia-2027", again)).toBe(false);
  });

  it("a disabled person can't sign in with their password", async () => {
    const admin = await person("admin");
    const { id } = await addEmployee(admin, "PieroD", "Piero Dalla");
    const b = new Browser();
    await b.json("/api/auth/password/first", { body: { login: "PieroD", password: "brescia-2026" } });
    await admin.json(`/api/users/${id}`, { method: "PATCH", body: { status: "disabled" } });
    expect(await me(b)).toBeNull();
    expect((await b.json("/api/auth/password/login", { body: { login: "PieroD", password: "brescia-2026" } })).status).toBe(401);
    expect((await b.json("/api/auth/password/first", { body: { login: "PieroD", password: "brescia-2027" } })).status).toBe(401);
  });

  it("an admin's Reset password signs them out and their next sign-in asks for a new one", async () => {
    const admin = await person("admin");
    const { id } = await addEmployee(admin, "SaraM", "Sara Moro");
    const b = new Browser();
    await b.json("/api/auth/password/first", { body: { login: "SaraM", password: "brescia-2026" } });
    expect((await admin.json(`/api/users/${id}/reset-password`, { body: {} })).status).toBe(200);
    expect(await me(b)).toBeNull();
    expect((await b.json("/api/auth/password/login", { body: { login: "SaraM", password: "brescia-2026" } })).data).toMatchObject({ firstTime: true });
    await b.json("/api/auth/password/first", { body: { login: "SaraM", password: "verona-2027" } });
    expect((await me(b)).name).toBe("Sara Moro");
    // Only people who manage users can reset.
    const tech = await person("tech");
    expect((await tech.json(`/api/users/${id}/reset-password`, { body: {} })).status).toBe(403);
  });

  it("a signed-in person can change their own password", async () => {
    const admin = await person("admin");
    await addEmployee(admin, "EliaC", "Elia Conti");
    const b = new Browser();
    await b.json("/api/auth/password/first", { body: { login: "EliaC", password: "brescia-2026" } });
    expect((await b.json("/api/auth/password/change", { body: { current: "wrong-one-x", password: "verona-2027" } })).status).toBe(401);
    expect((await b.json("/api/auth/password/change", { body: { current: "brescia-2026", password: "verona-2027" } })).status).toBe(200);
    await b.fetch("/api/auth/logout", { body: {} });
    expect((await b.json("/api/auth/password/login", { body: { login: "EliaC", password: "verona-2027" } })).status).toBe(200);
  });

  it("an older invite link still works: the person makes a password with it", async () => {
    const link = await createInvite(env, { email: "old-invite@example.com", name: "Old Invite", role: "tech", createdBy: null });
    const b = new Browser();
    const r = await b.json("/api/auth/invite/password", { body: { token: link.split("#")[1], password: "brescia-2026" } });
    expect(r.status).toBe(200);
    expect((await me(b)).name).toBe("Old Invite");
    await b.fetch("/api/auth/logout", { body: {} });
    expect((await b.json("/api/auth/password/login", { body: { login: "old-invite@example.com", password: "brescia-2026" } })).status).toBe(200);
  });
});

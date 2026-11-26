// Username and password sign-in (Aaron, 2026-11-26): a person chooses their own password the
// first time they sign in; an admin can reset it; nobody else ever sets or sees it.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Browser, person } from "./helpers";

let n = 0;
const name = () => `pwuser${++n}${crypto.randomUUID().slice(0, 4)}`;

/** An admin adds a person the way the People page does. */
async function added(role = "tech") {
  const admin = await person("admin");
  const login = name();
  const r = await admin.json("/api/users/invite", { body: { name: "New Person", email: login, role } });
  expect(r.status).toBe(200);
  expect(r.data.login).toBe(login);
  return { admin, login };
}

describe("username and password sign-in", () => {
  it("a new person chooses their password at first sign-in, then signs in with it", async () => {
    const { login } = await added();
    const b = new Browser();
    const first = await b.json("/api/auth/login", { body: { login, password: "" } });
    expect(first.status).toBe(409);
    expect(first.data.firstTime).toBe(true);

    expect((await b.json("/api/auth/password/first", { body: { login, password: "short" } })).status).toBe(400);
    expect((await b.json("/api/auth/password/first", { body: { login, password: login } })).status).toBe(400);
    expect((await b.json("/api/auth/password/first", { body: { login, password: "correct horse 9" } })).status).toBe(200);
    expect((await b.json("/api/auth/me")).data.user).toMatchObject({ name: "New Person", role: "tech" });

    await b.fetch("/api/auth/logout", { body: {} });
    expect((await b.json("/api/auth/login", { body: { login, password: "wrong password" } })).status).toBe(401);
    expect((await b.json("/api/auth/me")).data.user).toBeNull();
    // Usernames don't care about capitals.
    expect((await b.json("/api/auth/login", { body: { login: login.toUpperCase(), password: "correct horse 9" } })).status).toBe(200);
    expect((await b.json("/api/auth/me")).data.user.name).toBe("New Person");
  });

  it("the first sign-in works once: nobody can choose the password again", async () => {
    const { login } = await added();
    expect((await new Browser().json("/api/auth/password/first", { body: { login, password: "correct horse 9" } })).status).toBe(200);
    expect((await new Browser().json("/api/auth/password/first", { body: { login, password: "someone else 99" } })).status).toBe(400);
    expect((await new Browser().json("/api/auth/login", { body: { login, password: "someone else 99" } })).status).toBe(401);
  });

  it("an unknown username gets the same answer as a wrong password", async () => {
    const r = await new Browser().json("/api/auth/login", { body: { login: "nobody-here", password: "whatever 123" } });
    expect(r.status).toBe(401);
    expect(r.data.firstTime).toBeUndefined();
    expect((await new Browser().json("/api/auth/password/first", { body: { login: "nobody-here", password: "whatever 123" } })).status).toBe(400);
  });

  it("stores only a salted hash of the password", async () => {
    const { login } = await added();
    await new Browser().json("/api/auth/password/first", { body: { login, password: "correct horse 9" } });
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE email = ?").bind(login).first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^pbkdf2\$100000\$/);
    expect(row!.password_hash).not.toContain("correct horse");
  });

  it("locks the login for a while after 8 wrong passwords", async () => {
    const { login } = await added();
    await new Browser().json("/api/auth/password/first", { body: { login, password: "correct horse 9" } });
    // Each try from a new address, so this is the per-login lock and not the per-address limit.
    for (let i = 0; i < 8; i++) expect((await new Browser().json("/api/auth/login", { body: { login, password: `guess number ${i}` } })).status).toBe(401);
    expect((await new Browser().json("/api/auth/login", { body: { login, password: "correct horse 9" } })).status).toBe(429);
  });

  it("an admin resets a password: the old one stops, the person is signed out and chooses a new one", async () => {
    const { admin, login } = await added();
    const b = new Browser();
    await b.json("/api/auth/password/first", { body: { login, password: "correct horse 9" } });
    const id = (await b.json("/api/auth/me")).data.user.id as string;

    const tech = await person("tech");
    expect((await tech.json(`/api/users/${id}/reset-password`, { body: {} })).status).toBe(403);
    const reset = await admin.json(`/api/users/${id}/reset-password`, { body: {} });
    expect(reset.status).toBe(200);
    expect(Date.parse(reset.data.until)).toBeGreaterThan(Date.now());

    expect((await b.json("/api/auth/me")).data.user).toBeNull();
    const again = await b.json("/api/auth/login", { body: { login, password: "correct horse 9" } });
    expect(again.status).toBe(409);
    expect(again.data.firstTime).toBe(true);
    expect((await b.json("/api/auth/password/first", { body: { login, password: "a brand new one 7" } })).status).toBe(200);
    const list = await admin.json("/api/users");
    expect(list.data.users.find((u: any) => u.id === id).has_password).toBeTruthy();
  });

  it("a first sign-in that has run out needs a reset", async () => {
    const { admin, login } = await added();
    const b = new Browser();
    await b.json("/api/auth/password/first", { body: { login, password: "correct horse 9" } });
    const id = (await b.json("/api/auth/me")).data.user.id as string;
    await admin.json(`/api/users/${id}/reset-password`, { body: {} });
    await env.DB.prepare("UPDATE users SET password_setup_until = ? WHERE id = ?").bind(new Date(Date.now() - 1000).toISOString(), id).run();
    expect((await b.json("/api/auth/login", { body: { login, password: "" } })).status).toBe(401);
    expect((await b.json("/api/auth/password/first", { body: { login, password: "a brand new one 7" } })).status).toBe(400);
  });

  it("a signed-in person changes their own password, which signs out their other devices", async () => {
    const { login } = await added();
    const phone = new Browser();
    await phone.json("/api/auth/password/first", { body: { login, password: "correct horse 9" } });
    const pc = new Browser();
    await pc.json("/api/auth/login", { body: { login, password: "correct horse 9" } });

    expect((await pc.json("/api/auth/password/change", { body: { current: "not it", password: "second password 2" } })).status).toBe(400);
    expect((await pc.json("/api/auth/password/change", { body: { current: "correct horse 9", password: "second password 2" } })).status).toBe(200);
    expect((await pc.json("/api/auth/me")).data.user).not.toBeNull();
    expect((await phone.json("/api/auth/me")).data.user).toBeNull();
    expect((await phone.json("/api/auth/login", { body: { login, password: "second password 2" } })).status).toBe(200);
    expect((await new Browser().json("/api/auth/password/change", { body: { current: "x", password: "second password 3" } })).status).toBe(401);
  });

  it("a disabled or removed person can't sign in or choose a password", async () => {
    const { admin, login } = await added();
    const b = new Browser();
    await b.json("/api/auth/password/first", { body: { login, password: "correct horse 9" } });
    const id = (await b.json("/api/auth/me")).data.user.id as string;
    await admin.json(`/api/users/${id}/remove`, { body: {} });
    expect((await new Browser().json("/api/auth/login", { body: { login, password: "correct horse 9" } })).status).toBe(401);
    expect((await admin.json(`/api/users/${id}/reset-password`, { body: {} })).status).toBe(409);
  });
});

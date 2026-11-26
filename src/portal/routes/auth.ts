// Sign-in with a username and password (since 2026-11-26).
//
// New person:   admin adds them on People -> they sign in with their username -> make their own password.
// Returning:    username + password.
// Forgot it:    an admin presses "Reset password"; the next sign-in asks for a new one.
// The passkey routes below still work for anyone who made a passkey before, but the pages no longer offer them.
import { Hono, type Context } from "hono";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { fromBase64Url, randomId, sha256Hex, toBase64Url } from "../../shared/crypto";
import { hashPassword, passwordProblem, verifyPassword } from "../../shared/password";
import type { AppEnv } from "../env";
import { addSeconds, audit, now } from "../lib/db";
import { body, fail, requireUser } from "../lib/http";
import { createInvite } from "../lib/invites";
import { getSettings } from "../lib/settings-store";
import { publicPart } from "../lib/settings";
import { endSession, startSession } from "../lib/session";

const CHALLENGE_SECONDS = 300;

interface InviteRow {
  id: string; email: string; name: string; role: string;
  expires_at: string; used_at: string | null; user_id: string | null;
}

async function findInvite(db: D1Database, token: unknown): Promise<InviteRow> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) fail(400, "This invite link isn't valid.");
  const row = await db
    .prepare("SELECT id, email, name, role, expires_at, used_at, user_id FROM invites WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<InviteRow>();
  if (!row) fail(404, "This invite link isn't valid.");
  if (row.used_at) fail(410, "This invite link has already been used. Ask your admin for a new one.");
  if (row.expires_at < now()) fail(410, "This invite link has expired. Ask your admin for a new one.");
  return row;
}

async function takeChallenge(db: D1Database, id: unknown, purpose: "register" | "login") {
  if (typeof id !== "string" || id.length > 40) fail(400, "Sign-in expired. Please try again.");
  // Read and delete in one go so a challenge can only be used once.
  const row = await db
    .prepare("DELETE FROM auth_challenges WHERE id = ? AND purpose = ? RETURNING challenge, invite_id, expires_at")
    .bind(id, purpose)
    .first<{ challenge: string; invite_id: string | null; expires_at: string }>();
  if (!row || row.expires_at < now()) fail(400, "Sign-in expired. Please try again.");
  return row;
}

async function rateLimit(c: Context<AppEnv>) {
  if (!c.env.AUTH_LIMIT) return;
  const { success } = await c.env.AUTH_LIMIT.limit({ key: c.get("ip") });
  if (!success) fail(429, "Too many tries. Wait a minute and try again.");
}

export const auth = new Hono<AppEnv>();

/** Who am I? (null when signed out) */
auth.get("/me", (c) => {
  const u = c.get("user");
  return c.json({
    user: u ? { id: u.id, name: u.name, email: u.email, role: u.role, permissions: [...u.perms], owner: u.owner } : null,
    settings: u ? publicPart(getSettings()) : null,
  });
});

/** Show who an invite is for, before they create a passkey. */
auth.post("/invite/check", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const inv = await findInvite(c.env.DB, b.token);
  return c.json({ name: inv.name, email: inv.email, role: inv.role, addingDevice: !!inv.user_id });
});

/** Step 1 of creating a passkey from an invite. */
auth.post("/register/options", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const inv = await findInvite(c.env.DB, b.token);
  let userId = inv.user_id;
  const existing = userId
    ? (await c.env.DB.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").bind(userId).all<{ id: string; transports: string | null }>()).results
    : [];
  if (!userId) {
    const taken = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(inv.email).first();
    if (taken) fail(409, "Someone with this email or username already has a login.");
    userId = randomId();
  }
  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userName: inv.email,
    userDisplayName: inv.name,
    userID: fromBase64Url(toBase64Url(new TextEncoder().encode(userId))),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeId = randomId();
  await c.env.DB.prepare("INSERT INTO auth_challenges (id, challenge, purpose, invite_id, expires_at) VALUES (?,?,?,?,?)")
    .bind(challengeId, options.challenge, "register", inv.id, addSeconds(now(), CHALLENGE_SECONDS))
    .run();
  return c.json({ challengeId, userId, options });
});

/** Step 2 of creating a passkey: check it, create the login (or add the device), sign in. */
auth.post("/register/verify", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const ch = await takeChallenge(c.env.DB, b.challengeId, "register");
  const inv = await findInvite(c.env.DB, b.token);
  if (inv.id !== ch.invite_id) fail(400, "Sign-in expired. Please try again.");
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: b.response as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: c.env.ORIGIN,
      expectedRPID: c.env.RP_ID,
      requireUserVerification: true,
    });
  } catch {
    fail(400, "That passkey couldn't be checked. Please try again.");
  }
  if (!result.verified) fail(400, "That passkey couldn't be checked. Please try again.");
  const cred = result.registrationInfo.credential;
  const t = now();
  const newUser = !inv.user_id;
  const userId = inv.user_id ?? (typeof b.userId === "string" && b.userId.length <= 40 ? b.userId : randomId());
  const stmts: D1PreparedStatement[] = [];
  if (newUser) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO users (id, email, name, role, status, created_at, updated_at) VALUES (?,?,?,?, 'active', ?,?)")
        .bind(userId, inv.email, inv.name, inv.role, t, t),
    );
  }
  stmts.push(
    c.env.DB.prepare("INSERT INTO passkeys (id, user_id, public_key, counter, transports, nickname, created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(cred.id, userId, toBase64Url(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []), typeof b.nickname === "string" ? b.nickname.slice(0, 60) : null, t),
    // Mark the invite used only if nobody used it in the meantime.
    c.env.DB.prepare("UPDATE invites SET used_at = ?, user_id = ? WHERE id = ? AND used_at IS NULL").bind(t, userId, inv.id),
  );
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, { userId, action: newUser ? "user.signup" : "passkey.add", targetType: "user", targetId: userId, ip: c.get("ip") });
  await startSession(c, userId);
  return c.json({ ok: true });
});

/** Step 1 of signing in: the browser asks the phone or computer for any Ronchi passkey. */
auth.post("/login/options", async (c) => {
  await rateLimit(c);
  const options = await generateAuthenticationOptions({ rpID: c.env.RP_ID, userVerification: "required" });
  const challengeId = randomId();
  await c.env.DB.prepare("INSERT INTO auth_challenges (id, challenge, purpose, expires_at) VALUES (?,?,?,?)")
    .bind(challengeId, options.challenge, "login", addSeconds(now(), CHALLENGE_SECONDS))
    .run();
  // Housekeeping: clear out old challenges.
  await c.env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(now()).run();
  return c.json({ challengeId, options });
});

/** Step 2 of signing in. */
auth.post("/login/verify", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const ch = await takeChallenge(c.env.DB, b.challengeId, "login");
  const response = b.response as AuthenticationResponseJSON | undefined;
  if (!response || typeof response.id !== "string") fail(400, "That passkey couldn't be checked.");
  const pk = await c.env.DB.prepare(
    "SELECT p.id, p.user_id, p.public_key, p.counter, p.transports, u.status FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.id = ?",
  )
    .bind(response.id)
    .first<{ id: string; user_id: string; public_key: string; counter: number; transports: string | null; status: string }>();
  if (!pk || pk.status !== "active") {
    await audit(c.env.DB, { userId: pk?.user_id ?? null, action: "login.failed", detail: { reason: pk ? "disabled" : "unknown_passkey" }, ip: c.get("ip") });
    fail(401, "This passkey isn't linked to an active Ronchi Portal login.");
  }
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: c.env.ORIGIN,
      expectedRPID: c.env.RP_ID,
      requireUserVerification: true,
      credential: { id: pk.id, publicKey: fromBase64Url(pk.public_key), counter: pk.counter, transports: pk.transports ? JSON.parse(pk.transports) : undefined },
    });
  } catch {
    result = null;
  }
  if (!result?.verified) {
    await audit(c.env.DB, { userId: pk.user_id, action: "login.failed", detail: { reason: "bad_signature" }, ip: c.get("ip") });
    fail(401, "That passkey couldn't be checked.");
  }
  await c.env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").bind(result.authenticationInfo.newCounter, now(), pk.id).run();
  await audit(c.env.DB, { userId: pk.user_id, action: "login", ip: c.get("ip") });
  await startSession(c, pk.user_id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------------------------
// Username and password (Aaron, 2026-11-26: "this should just be a user name and password log in",
// "each user to create their own password on their first login"). An admin adds the person; the
// first time they sign in with their username, they make their own password.

const WRONG = "Wrong username or password.";

interface LoginRow { id: string; name: string; status: string; removed_at: string | null; password_hash: string | null }

async function findLogin(db: D1Database, raw: unknown): Promise<LoginRow | null> {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 200) return null;
  const v = raw.trim();
  const cols = "id, name, status, removed_at, password_hash";
  // Exact first (usernames keep their case), then ignoring case so "aaronl" finds "AaronL".
  return (
    (await db.prepare(`SELECT ${cols} FROM users WHERE email = ?`).bind(v).first<LoginRow>()) ??
    (await db.prepare(`SELECT ${cols} FROM users WHERE lower(email) = lower(?) ORDER BY created_at LIMIT 1`).bind(v).first<LoginRow>())
  );
}

const usable = (u: LoginRow | null): boolean => !!u && u.status === "active" && !u.removed_at;

/** Sign in with a username (or work email) and password. A person with no password yet is told to make one. */
auth.post("/password/login", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const u = await findLogin(c.env.DB, b.login);
  if (!u || !usable(u)) {
    await audit(c.env.DB, { userId: u?.id ?? null, action: "login.failed", detail: { reason: u ? "disabled" : "unknown_login", how: "password" }, ip: c.get("ip") });
    fail(401, WRONG);
  }
  if (!u.password_hash) return c.json({ firstTime: true, name: u.name });
  if (typeof b.password !== "string" || !(await verifyPassword(b.password, u.password_hash))) {
    await audit(c.env.DB, { userId: u.id, action: "login.failed", detail: { reason: "wrong_password" }, ip: c.get("ip") });
    fail(401, WRONG);
  }
  await audit(c.env.DB, { userId: u.id, action: "login", detail: { how: "password" }, ip: c.get("ip") });
  await startSession(c, u.id);
  return c.json({ ok: true });
});

/** First sign-in: the person makes their own password, then is signed in. Only while they have none. */
auth.post("/password/first", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const u = await findLogin(c.env.DB, b.login);
  if (!u || !usable(u)) fail(401, WRONG);
  if (u.password_hash) fail(409, "This login already has a password. Sign in with it, or ask an admin to reset it.");
  const problem = passwordProblem(b.password);
  if (problem) fail(400, problem);
  const t = now();
  // Only if nobody set one in the meantime.
  const r = await c.env.DB.prepare("UPDATE users SET password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ? AND password_hash IS NULL")
    .bind(await hashPassword(b.password as string), t, t, u.id)
    .run();
  if (!r.meta.changes) fail(409, "This login already has a password. Sign in with it, or ask an admin to reset it.");
  await audit(c.env.DB, { userId: u.id, action: "password.first", targetType: "user", targetId: u.id, ip: c.get("ip") });
  await startSession(c, u.id);
  return c.json({ ok: true });
});

/** A signed-in person changes their own password. Their other devices are signed out. */
auth.post("/password/change", async (c) => {
  const me = requireUser(c);
  await rateLimit(c);
  const b = await body(c);
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(me.id).first<{ password_hash: string | null }>();
  if (row?.password_hash && (typeof b.current !== "string" || !(await verifyPassword(b.current, row.password_hash)))) fail(401, "Your current password isn't right.");
  const problem = passwordProblem(b.password);
  if (problem) fail(400, problem);
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(b.password as string), t, t, me.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?").bind(me.id, me.sessionHash),
  ]);
  await audit(c.env.DB, { userId: me.id, action: "password.change", targetType: "user", targetId: me.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

/** An invite link made before passwords: the person makes their password with it and is signed in. */
auth.post("/invite/password", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const inv = await findInvite(c.env.DB, b.token);
  const problem = passwordProblem(b.password);
  if (problem) fail(400, problem);
  const t = now();
  const hash = await hashPassword(b.password as string);
  let userId = inv.user_id;
  const stmts: D1PreparedStatement[] = [];
  if (userId) {
    stmts.push(c.env.DB.prepare("UPDATE users SET password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?").bind(hash, t, t, userId));
  } else {
    if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(inv.email).first()) fail(409, "Someone with this email or username already has a login.");
    userId = randomId();
    stmts.push(
      c.env.DB.prepare("INSERT INTO users (id, email, name, role, status, created_at, updated_at, password_hash, password_set_at) VALUES (?,?,?,?, 'active', ?,?,?,?)")
        .bind(userId, inv.email, inv.name, inv.role, t, t, hash, t),
    );
  }
  stmts.push(c.env.DB.prepare("UPDATE invites SET used_at = ?, user_id = ? WHERE id = ? AND used_at IS NULL").bind(t, userId, inv.id));
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, { userId, action: inv.user_id ? "password.change" : "user.signup", targetType: "user", targetId: userId, ip: c.get("ip") });
  await startSession(c, userId);
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  const u = c.get("user");
  await endSession(c);
  if (u) await audit(c.env.DB, { userId: u.id, action: "logout", ip: c.get("ip") });
  return c.json({ ok: true });
});

/** Make a one-time link to add a passkey on another device (for example a new phone). */
auth.post("/add-device", async (c) => {
  const u = requireUser(c);
  const link = await createInvite(c.env, { email: u.email, name: u.name, role: u.role, createdBy: u.id, userId: u.id, hours: 1 });
  await audit(c.env.DB, { userId: u.id, action: "passkey.add_link", targetType: "user", targetId: u.id, ip: c.get("ip") });
  return c.json({ link });
});

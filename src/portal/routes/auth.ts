// Sign-in with a username and a password (Aaron, 2026-11-26).
//
// New person:   admin adds them on People -> they type their username on the sign-in page and
//               choose a password (their "first sign-in", open for the invite lifetime).
// Returning:    username + password.
// Forgot it:    an admin presses Reset password on People; the next sign-in is a first sign-in again.
//
// The passkey routes further down are the earlier way in. The sign-in page no longer uses them.
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { fromBase64Url, randomId, sha256Hex, toBase64Url } from "../../shared/crypto";
import type { AppEnv } from "../env";
import { addSeconds, audit, now } from "../lib/db";
import { body, fail, requireUser } from "../lib/http";
import { createInvite } from "../lib/invites";
import { getSettings } from "../lib/settings-store";
import { publicPart } from "../lib/settings";
import { loginId } from "../../shared/login";
import { checkPassword, hashPassword, passwordProblem } from "../lib/password";
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

// ---------- Username and password ----------

const WRONG = "That username or password isn't right.";
const MAX_FAILS = 8;
const LOCK_SECONDS = 15 * 60;

interface PwUser {
  id: string; status: string; password_hash: string | null; password_setup_until: string | null;
  failed_logins: number; locked_until: string | null;
}
const pwUser = (db: D1Database, login: string) =>
  db.prepare("SELECT id, status, password_hash, password_setup_until, failed_logins, locked_until FROM users WHERE email = ?").bind(login).first<PwUser>();

/** Someone an admin added who hasn't signed in yet. */
const pendingInvite = (db: D1Database, login: string) =>
  db.prepare("SELECT id, email, name, role FROM invites WHERE email = ? AND user_id IS NULL AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(login, now()).first<{ id: string; email: string; name: string; role: string }>();

/** Stop with "choose your password first": the sign-in page then shows the two new-password boxes. */
function firstTime(): never {
  throw new HTTPException(409, { res: Response.json({ error: "This is your first sign-in. Choose a password.", firstTime: true }, { status: 409 }) });
}

/** Sign in with a username and password. */
auth.post("/login", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const login = loginId(b.login);
  const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
  if (!login) fail(401, WRONG);
  const u = await pwUser(c.env.DB, login);
  if (!u) {
    if (await pendingInvite(c.env.DB, login)) firstTime();
    await checkPassword(password, null);
    await audit(c.env.DB, { userId: null, action: "login.failed", detail: { reason: "unknown_login" }, ip: c.get("ip") });
    fail(401, WRONG);
  }
  if (u.status !== "active") {
    await audit(c.env.DB, { userId: u.id, action: "login.failed", detail: { reason: "disabled" }, ip: c.get("ip") });
    fail(401, WRONG);
  }
  if (!u.password_hash) {
    if (u.password_setup_until && u.password_setup_until > now()) firstTime();
    fail(401, "This login has no password yet and its first sign-in has run out. Ask your admin to press Reset password.");
  }
  if (u.locked_until && u.locked_until > now()) fail(429, "Too many wrong passwords. Wait 15 minutes, or ask your admin to press Reset password.");
  if (!(await checkPassword(password, u.password_hash))) {
    const fails = u.failed_logins + 1;
    await c.env.DB.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?")
      .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? addSeconds(now(), LOCK_SECONDS) : null, u.id).run();
    await audit(c.env.DB, { userId: u.id, action: "login.failed", detail: { reason: "bad_password", locked: fails >= MAX_FAILS }, ip: c.get("ip") });
    fail(401, WRONG);
  }
  if (u.failed_logins || u.locked_until) await c.env.DB.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").bind(u.id).run();
  await audit(c.env.DB, { userId: u.id, action: "login", ip: c.get("ip") });
  await startSession(c, u.id);
  return c.json({ ok: true });
});

/** First sign-in: choose a password. Works once per person, while their first sign-in is open. */
auth.post("/password/first", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const login = loginId(b.login);
  const closed = "This login isn't waiting for a first sign-in. Sign in with your password, or ask your admin to press Reset password.";
  if (!login) fail(400, closed);
  const problem = passwordProblem(b.password, login);
  if (problem) fail(400, problem);
  const hash = await hashPassword(b.password as string);
  const t = now();
  const u = await pwUser(c.env.DB, login);
  if (u) {
    if (u.status !== "active" || u.password_hash || !u.password_setup_until || u.password_setup_until <= t) fail(400, closed);
    // Only if nobody set it in the meantime.
    const r = await c.env.DB.prepare("UPDATE users SET password_hash = ?, password_set_at = ?, password_setup_until = NULL, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ? AND password_hash IS NULL")
      .bind(hash, t, t, u.id).run();
    if (!r.meta.changes) fail(400, closed);
    await audit(c.env.DB, { userId: u.id, action: "password.create", targetType: "user", targetId: u.id, ip: c.get("ip") });
    await startSession(c, u.id);
    return c.json({ ok: true });
  }
  const inv = await pendingInvite(c.env.DB, login);
  if (!inv) fail(400, closed);
  const userId = randomId();
  // Mark the invite used first, and only go on if this request was the one that used it.
  const used = await c.env.DB.prepare("UPDATE invites SET used_at = ?, user_id = ? WHERE id = ? AND used_at IS NULL").bind(t, userId, inv.id).run();
  if (!used.meta.changes) fail(400, closed);
  await c.env.DB.prepare("INSERT INTO users (id, email, name, role, status, created_at, updated_at, password_hash, password_set_at) VALUES (?,?,?,?, 'active', ?,?,?,?)")
    .bind(userId, inv.email, inv.name, inv.role, t, t, hash, t).run();
  await audit(c.env.DB, { userId, action: "user.signup", targetType: "user", targetId: userId, ip: c.get("ip") });
  await startSession(c, userId);
  return c.json({ ok: true });
});

/** Change my own password. Other devices are signed out. */
auth.post("/password/change", async (c) => {
  const me = requireUser(c);
  await rateLimit(c);
  const b = await body(c);
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(me.id).first<{ password_hash: string | null }>();
  if (row?.password_hash && !(await checkPassword(typeof b.current === "string" ? b.current.slice(0, 200) : "", row.password_hash))) fail(400, "Your current password isn't right.");
  const problem = passwordProblem(b.password, me.email);
  if (problem) fail(400, problem);
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, password_set_at = ?, password_setup_until = NULL, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?").bind(await hashPassword(b.password as string), t, t, me.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?").bind(me.id, me.sessionHash),
  ]);
  await audit(c.env.DB, { userId: me.id, action: "password.change", targetType: "user", targetId: me.id, ip: c.get("ip") });
  return c.json({ ok: true });
});

// ---------- Passkeys (the earlier way in) ----------

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

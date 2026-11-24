// Customer sign-in: passkeys only, the same way staff sign in.
// Ronchi America staff make an invite in the portal -> the customer opens the link -> creates a
// passkey (Face ID, fingerprint, Windows Hello or a security key) -> signed in. No passwords to steal.
// Lost phone: staff send a new link; "Add another device" makes one for the signed-in person.
import { Hono, type Context } from "hono";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { fromBase64Url, randomId, randomToken, sha256Hex, toBase64Url } from "../../shared/crypto";
import type { PartsApp, PartsEnv } from "../env";
import { addSeconds, audit, body, fail, now, requireCustomer } from "../lib/http";
import { endSession, startSession } from "../lib/session";

const CHALLENGE_SECONDS = 300;

interface InviteRow {
  id: string; company_id: string; email: string; name: string; role: string;
  expires_at: string; used_at: string | null; user_id: string | null; company_status: string;
}

/** Make a one-time sign-up link. The token sits after "#" so it never reaches server logs. */
export async function createCustomerInvite(
  env: PartsEnv,
  o: { companyId: string; email: string; name: string; role: string; userId?: string; hours?: number },
): Promise<string> {
  const token = randomToken();
  const t = now();
  await env.PARTS_DB.prepare("INSERT INTO invites (id, company_id, email, name, role, token_hash, created_at, expires_at, user_id) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(randomId(), o.companyId, o.email, o.name, o.role, await sha256Hex(token), t, addSeconds(t, (o.hours ?? 7 * 24) * 3600), o.userId ?? null)
    .run();
  return `${env.ORIGIN}/welcome#${token}`;
}

async function findInvite(db: D1Database, token: unknown): Promise<InviteRow> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) fail(400, "This sign-up link isn't valid.");
  const row = await db.prepare(
    `SELECT i.id, i.company_id, i.email, i.name, i.role, i.expires_at, i.used_at, i.user_id, c.status AS company_status
       FROM invites i JOIN companies c ON c.id = i.company_id WHERE i.token_hash = ?`,
  ).bind(await sha256Hex(token)).first<InviteRow>();
  if (!row || row.company_status !== "active") fail(404, "This sign-up link isn't valid.");
  if (row.used_at) fail(410, "This sign-up link has already been used. Ask Ronchi America for a new one.");
  if (row.expires_at < now()) fail(410, "This sign-up link has expired. Ask Ronchi America for a new one.");
  return row;
}

async function takeChallenge(db: D1Database, id: unknown, purpose: "register" | "login") {
  if (typeof id !== "string" || id.length > 40) fail(400, "Sign-in expired. Please try again.");
  const row = await db.prepare("DELETE FROM auth_challenges WHERE id = ? AND purpose = ? RETURNING challenge, invite_id, expires_at")
    .bind(id, purpose).first<{ challenge: string; invite_id: string | null; expires_at: string }>();
  if (!row || row.expires_at < now()) fail(400, "Sign-in expired. Please try again.");
  return row;
}

async function rateLimit(c: Context<PartsApp>) {
  if (!c.env.AUTH_LIMIT) return;
  const { success } = await c.env.AUTH_LIMIT.limit({ key: c.get("ip") });
  if (!success) fail(429, "Too many tries. Wait a minute and try again.");
}

export const auth = new Hono<PartsApp>();

auth.get("/me", (c) => {
  const u = c.get("user");
  return c.json({ user: u ? { id: u.id, name: u.name, email: u.email, role: u.role, company: u.companyName } : null });
});

auth.post("/invite/check", async (c) => {
  await rateLimit(c);
  const inv = await findInvite(c.env.PARTS_DB, (await body(c)).token);
  return c.json({ name: inv.name, email: inv.email, addingDevice: !!inv.user_id });
});

auth.post("/register/options", async (c) => {
  await rateLimit(c);
  const inv = await findInvite(c.env.PARTS_DB, (await body(c)).token);
  let userId = inv.user_id;
  const existing = userId
    ? (await c.env.PARTS_DB.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").bind(userId).all<{ id: string; transports: string | null }>()).results
    : [];
  if (!userId) {
    if (await c.env.PARTS_DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(inv.email).first()) fail(409, "Someone with this email already has a login.");
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
  await c.env.PARTS_DB.prepare("INSERT INTO auth_challenges (id, challenge, purpose, invite_id, expires_at) VALUES (?,?,?,?,?)")
    .bind(challengeId, options.challenge, "register", inv.id, addSeconds(now(), CHALLENGE_SECONDS)).run();
  return c.json({ challengeId, userId, options });
});

auth.post("/register/verify", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const ch = await takeChallenge(c.env.PARTS_DB, b.challengeId, "register");
  const inv = await findInvite(c.env.PARTS_DB, b.token);
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
  const userId = inv.user_id ?? (typeof b.userId === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(b.userId) ? b.userId : randomId());
  const stmts: D1PreparedStatement[] = [];
  if (newUser) {
    stmts.push(c.env.PARTS_DB.prepare("INSERT INTO users (id, company_id, email, name, role, status, created_at, updated_at) VALUES (?,?,?,?,?, 'active', ?,?)")
      .bind(userId, inv.company_id, inv.email, inv.name, inv.role, t, t));
  }
  stmts.push(
    c.env.PARTS_DB.prepare("INSERT INTO passkeys (id, user_id, public_key, counter, transports, created_at) VALUES (?,?,?,?,?,?)")
      .bind(cred.id, userId, toBase64Url(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []), t),
    c.env.PARTS_DB.prepare("UPDATE invites SET used_at = ?, user_id = ? WHERE id = ? AND used_at IS NULL").bind(t, userId, inv.id),
  );
  await c.env.PARTS_DB.batch(stmts);
  await audit(c.env.PARTS_DB, { userId, companyId: inv.company_id, action: newUser ? "user.signup" : "passkey.add", ip: c.get("ip") });
  await startSession(c, userId);
  return c.json({ ok: true });
});

auth.post("/login/options", async (c) => {
  await rateLimit(c);
  const options = await generateAuthenticationOptions({ rpID: c.env.RP_ID, userVerification: "required" });
  const challengeId = randomId();
  await c.env.PARTS_DB.batch([
    c.env.PARTS_DB.prepare("INSERT INTO auth_challenges (id, challenge, purpose, expires_at) VALUES (?,?,?,?)").bind(challengeId, options.challenge, "login", addSeconds(now(), CHALLENGE_SECONDS)),
    c.env.PARTS_DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(now()),
  ]);
  return c.json({ challengeId, options });
});

auth.post("/login/verify", async (c) => {
  await rateLimit(c);
  const b = await body(c);
  const ch = await takeChallenge(c.env.PARTS_DB, b.challengeId, "login");
  const response = b.response as AuthenticationResponseJSON | undefined;
  if (!response || typeof response.id !== "string") fail(400, "That passkey couldn't be checked.");
  const pk = await c.env.PARTS_DB.prepare(
    `SELECT p.id, p.user_id, p.public_key, p.counter, p.transports, u.status, u.company_id, co.status AS company_status
       FROM passkeys p JOIN users u ON u.id = p.user_id JOIN companies co ON co.id = u.company_id WHERE p.id = ?`,
  ).bind(response.id).first<{ id: string; user_id: string; public_key: string; counter: number; transports: string | null; status: string; company_id: string; company_status: string }>();
  if (!pk || pk.status !== "active" || pk.company_status !== "active") {
    await audit(c.env.PARTS_DB, { userId: pk?.user_id ?? null, companyId: pk?.company_id ?? null, action: "login.failed", detail: { reason: pk ? "disabled" : "unknown_passkey" }, ip: c.get("ip") });
    fail(401, "This passkey isn't linked to an active Ronchi parts login.");
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
    await audit(c.env.PARTS_DB, { userId: pk.user_id, companyId: pk.company_id, action: "login.failed", detail: { reason: "bad_signature" }, ip: c.get("ip") });
    fail(401, "That passkey couldn't be checked.");
  }
  await c.env.PARTS_DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").bind(result.authenticationInfo.newCounter, now(), pk.id).run();
  await audit(c.env.PARTS_DB, { userId: pk.user_id, companyId: pk.company_id, action: "login", ip: c.get("ip") });
  await startSession(c, pk.user_id);
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  const u = c.get("user");
  await endSession(c);
  if (u) await audit(c.env.PARTS_DB, { userId: u.id, companyId: u.companyId, action: "logout", ip: c.get("ip") });
  return c.json({ ok: true });
});

auth.post("/add-device", async (c) => {
  const u = requireCustomer(c);
  const link = await createCustomerInvite(c.env, { companyId: u.companyId, email: u.email, name: u.name, role: u.role, userId: u.id, hours: 1 });
  await audit(c.env.PARTS_DB, { userId: u.id, companyId: u.companyId, action: "passkey.add_link", ip: c.get("ip") });
  return c.json({ link });
});

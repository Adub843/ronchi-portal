// Password hashing with the Web Crypto API (Workers, browsers and Node 22 alike): PBKDF2-SHA256
// with a random 16-byte salt. Cloudflare Workers allow at most 100,000 iterations.
// Stored as "pbkdf2-sha256$<iterations>$<salt>$<hash>" (base64url), so the cost can be raised later.
import { fromBase64Url, sameText, toBase64Url } from "./crypto";

const ITERATIONS = 100_000;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}

/** Why this password can't be used, or null when it's fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  if (!password.trim()) return "The password can't be only spaces.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${toBase64Url(salt)}$${await derive(password, salt, ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iter, salt, hash] = stored.split("$");
  const n = Number(iter);
  if (kind !== "pbkdf2-sha256" || !salt || !hash || !Number.isInteger(n) || n < 1 || n > ITERATIONS) return false;
  return sameText(await derive(password, fromBase64Url(salt), n), hash);
}

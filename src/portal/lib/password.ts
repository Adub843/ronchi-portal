// Passwords: only a salted, deliberately slow hash is ever stored (PBKDF2-SHA256, the standard
// built into Cloudflare Workers). Stored as "pbkdf2$<rounds>$<salt>$<hash>", so the rounds can be
// raised later without breaking old passwords.
import { fromBase64Url, sameText, toBase64Url } from "../../shared/crypto";

const ROUNDS = 100_000; // the most Cloudflare Workers allows
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ROUNDS}$${toBase64Url(salt)}$${await derive(password, salt, ROUNDS)}`;
}

export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  const m = /^pbkdf2\$(\d{1,7})\$([\w-]+)\$([\w-]+)$/.exec(stored ?? "");
  if (!m) {
    // Do the same slow work for an unknown login, so the answer takes as long either way.
    await derive(password, new Uint8Array(16), ROUNDS);
    return false;
  }
  return sameText(await derive(password, fromBase64Url(m[2]!), Number(m[1])), m[3]!);
}

/** Why this password can't be used, or null when it's fine. */
export function passwordProblem(password: unknown, login: string): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return "That password is too long.";
  if (password.toLowerCase() === login.toLowerCase()) return "Your password can't be your username.";
  return null;
}

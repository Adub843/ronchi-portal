#!/usr/bin/env node
// Makes the very first admin invite (only works while the portal has no users).
//
//   npm run invite:first-admin -- --name "Aaron Lewis" --username AaronL   # or --email someone@company.com            (live)
//   npm run invite:first-admin -- --name "Test Admin" --email test@example.com --local             (laptop)
//
// Then open the portal, type that username, press Sign in and choose your password.
// This first sign-in is open for 24 hours.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const local = args.includes("--local");
const name = arg("name");
// --email takes a work email or a plain username such as AaronL (same rule as src/shared/login.ts).
const raw = (arg("email") ?? arg("username"))?.trim();
const email = !raw ? null : raw.includes("@") ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.toLowerCase() : null) : /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/.test(raw) ? raw : null;
if (!name || !email) {
  console.error('Usage: npm run invite:first-admin -- --name "Full Name" --username AaronL   (or --email you@company.com) [--local]');
  process.exit(1);
}

const where = local ? ["--local"] : ["--remote", "--env", "production"];
const d1 = (sql) =>
  // Run wrangler's own JS with node (no shell), so the SQL reaches it as one argument on Windows too.
  JSON.parse(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "portal-db", ...where, "-c", "wrangler.portal.jsonc", "--json", "--command", sql], { encoding: "utf8" }));

const users = d1("SELECT COUNT(*) AS n FROM users")[0].results[0].n;
if (users > 0) {
  console.error("The portal already has users. Ask an existing admin to invite people from the People page.");
  process.exit(1);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const now = new Date();
const expires = new Date(now.getTime() + 24 * 3600 * 1000);
d1(
  `INSERT INTO invites (id, email, name, role, token_hash, created_by, created_at, expires_at) VALUES (` +
    [q(randomUUID()), q(email), q(name), q("admin"), q(hash), "NULL", q(now.toISOString()), q(expires.toISOString())].join(",") +
    `)`,
);

// The live address is the ORIGIN on the production vars line (the last ORIGIN in the file).
// Read with a regex: stripping // comments would also cut the "//" in "https://".
const origins = [...readFileSync("wrangler.portal.jsonc", "utf8").matchAll(/"ORIGIN":\s*"([^"]+)"/g)].map((m) => m[1]);
const origin = local ? "http://localhost:8787" : origins.at(-1);
if (!local && !origin?.startsWith("https://")) {
  console.error("Couldn't find the live ORIGIN in wrangler.portal.jsonc.");
  process.exit(1);
}
console.log(`\nFirst admin added: ${name}. Open ${origin}, type the username ${email}, press Sign in and choose your password. Open for 24 hours.\n`);
// --open: also open the portal in this computer's browser.
if (args.includes("--open")) {
  if (process.platform === "win32") execFileSync("rundll32", ["url.dll,FileProtocolHandler", origin]);
  else execFileSync(process.platform === "darwin" ? "open" : "xdg-open", [origin]);
}

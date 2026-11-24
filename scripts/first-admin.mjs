#!/usr/bin/env node
// Makes the very first admin invite (only works while the portal has no users).
//
//   npm run invite:first-admin -- --name "Paolo Ferla" --email paolo@ronchiamerica.com            (live)
//   npm run invite:first-admin -- --name "Test Admin" --email test@example.com --local             (laptop)
//
// It prints a one-time link. Open it on your phone or computer to create your passkey.
// The link is not saved anywhere; only a hash of it goes into the database.
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
// --username works instead of --email: the login ID only has to be unique (the portal sends no email).
const username = arg("username");
const email = (arg("email") ?? username)?.toLowerCase();
const okId = username ? /^[a-z0-9._-]{3,40}$/.test(email ?? "") : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "");
if (!name || !email || !okId) {
  console.error('Usage: npm run invite:first-admin -- --name "Full Name" (--email you@company.com | --username YourName) [--local]');
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
if (!origin?.startsWith("https://")) {
  console.error("Couldn't find the live ORIGIN in wrangler.portal.jsonc.");
  process.exit(1);
}
console.log(`\nFirst admin invite for ${name} (${email}). Works once, for 24 hours:\n\n  ${origin}/welcome#${token}\n`);
// --open: also open the link in this computer's browser, so nobody has to copy it.
if (args.includes("--open")) {
  const url = `${origin}/welcome#${token}`;
  if (process.platform === "win32") execFileSync("rundll32", ["url.dll,FileProtocolHandler", url]);
  else execFileSync(process.platform === "darwin" ? "open" : "xdg-open", [url]);
}

#!/usr/bin/env node
// Makes one admin the portal owner: the only person who sees Settings > Command center.
// For when the owner's login is lost. Needs the Cloudflare login on the PC that deploys the portal,
// so nobody can do this from inside the portal.
//
//   npm run owner -- AaronL            (live; a username or work email of an active admin)
//   npm run owner -- AaronL --local    (laptop)
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const login = args.find((a) => !a.startsWith("--"))?.trim();
if (!login) {
  console.error("Usage: npm run owner -- <username or email of an admin> [--local]");
  process.exit(1);
}
const where = args.includes("--local") ? ["--local"] : ["--remote", "--env", "production"];
const d1 = (sql) =>
  JSON.parse(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "portal-db", ...where, "-c", "wrangler.portal.jsonc", "--json", "--command", sql], { encoding: "utf8" }));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const found = d1(`SELECT id, name FROM users WHERE lower(email) = lower(${q(login)}) AND role = 'admin' AND status = 'active' AND removed_at IS NULL`)[0].results;
if (found.length !== 1) {
  console.error(`No active admin with the login ${login}.`);
  process.exit(1);
}
const { id, name } = found[0];
d1(`UPDATE users SET is_owner = CASE WHEN id = ${q(id)} THEN 1 ELSE 0 END`);
d1(`INSERT INTO audit_log (id, at, user_id, action, target_type, target_id, detail) VALUES (${q(randomUUID())}, ${q(new Date().toISOString())}, NULL, 'owner.set', 'user', ${q(id)}, '{"by":"command line"}')`);
console.log(`${name} is now the portal owner. They see Settings > Command center on their next click.`);

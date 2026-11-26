// Makes the PC catalog loader's key (scripts/cad-load.ts) and switches the loader on:
// the portal gets only the key's SHA-256 (CATALOG_LOADER_KEY_HASH); the key itself is saved in
// %USERPROFILE%\.ronchi\catalog-loader-key on this PC and never printed. Running it again
// makes a new key, so an old copy stops working. To switch the loader off:
//   npx wrangler secret delete CATALOG_LOADER_KEY_HASH --env production -c wrangler.portal.jsonc
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const key = randomBytes(32).toString("base64url");
execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "secret", "put", "CATALOG_LOADER_KEY_HASH", "--env", "production", "-c", "wrangler.portal.jsonc"], {
  input: createHash("sha256").update(key).digest("hex"),
  stdio: ["pipe", "inherit", "inherit"],
});
const dir = join(homedir(), ".ronchi");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "catalog-loader-key"), key, { mode: 0o600 });
console.log(`Loader key set on ronchi-portal and saved in ${join(dir, "catalog-loader-key")}.`);

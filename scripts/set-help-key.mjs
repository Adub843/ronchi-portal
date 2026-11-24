// Makes a new random publish key for the customer help center and sets it on both Workers without
// ever printing or saving it: the help center gets only its SHA-256 hash (ADMIN_KEY_HASH), the
// portal gets the key (HELP_ADMIN_KEY). Same as docs/REBUILD.md step 4c, but runs on Windows.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const wrangler = "node_modules/wrangler/bin/wrangler.js";
const put = (name, config, value) =>
  execFileSync(process.execPath, [wrangler, "secret", "put", name, "--env", "production", "-c", config], {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });

let key = randomBytes(32).toString("base64url");
put("ADMIN_KEY_HASH", "wrangler.help.jsonc", createHash("sha256").update(key).digest("hex"));
put("HELP_ADMIN_KEY", "wrangler.portal.jsonc", key);
key = "";
console.log("Publish key set on ronchi-help and ronchi-portal.");

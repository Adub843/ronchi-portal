// Makes a new random publish key and sets it on both Workers without ever printing or saving it:
// the parts site gets only its SHA-256 hash (ADMIN_KEY_HASH), the portal gets the key (PARTS_ADMIN_KEY).
// Same as docs/REBUILD.md step 4b, but runs on Windows with no shell quoting.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const wrangler = "node_modules/wrangler/bin/wrangler.js";
const put = (name, config, value) =>
  execFileSync(process.execPath, [wrangler, "secret", "put", name, "--env", "production", "-c", config], {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });

let key = randomBytes(32).toString("base64url");
put("ADMIN_KEY_HASH", "wrangler.parts.jsonc", createHash("sha256").update(key).digest("hex"));
put("PARTS_ADMIN_KEY", "wrangler.portal.jsonc", key);
key = "";
console.log("Publish key set on ronchi-parts and ronchi-portal.");

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// The portal config points at web/dist for the staff app. Tests don't need the built app,
// but the folder has to exist.
mkdirSync("web/dist", { recursive: true });
mkdirSync("web-parts/dist", { recursive: true });

// The parts site tests publish with this key; the Worker only ever sees its hash.
export const TEST_ADMIN_KEY = "test-publish-key-0123456789abcdefghijklmnop";

export default defineConfig({
  test: {
    projects: [
      // Plain logic and the structural wall checks, run in Node.
      { test: { name: "unit", include: ["test/unit/**/*.test.ts"], environment: "node" } },
      // The staff portal, run inside the real Workers runtime with a local portal-db.
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.portal.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("migrations/portal"),
                TEST_PARTS_MIGRATIONS: await readD1Migrations("migrations/parts"),
                TEST_ADMIN_KEY,
                TEST_ADMIN_KEY_HASH: createHash("sha256").update(TEST_ADMIN_KEY).digest("hex"),
              },
              // The real parts site isn't running in portal tests. test/portal/parts-site.ts swaps in
              // the parts site's code with its own test database, so publish runs end to end.
              serviceBindings: { PARTS: () => Response.json({ error: "Parts site not running in tests." }, { status: 503 }) },
              d1Databases: { DB: "portal-db-test", TEST_PARTS_DB: "parts-db-test" },
              r2Buckets: { FILES: "portal-files-test", TEST_PARTS_FILES: "parts-files-test" },
            },
          })),
        ],
        test: { name: "portal", include: ["test/portal/**/*.test.ts"], setupFiles: ["test/portal/setup.ts"] },
      },
      // The customer help center, with only help-db.
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.help.jsonc" },
            miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("migrations/help") } },
          })),
        ],
        test: { name: "help", include: ["test/help/**/*.test.ts"], setupFiles: ["test/help/setup.ts"] },
      },
      // The customer parts site, with only parts-db and its own bucket.
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.parts.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("migrations/parts"),
                TEST_ADMIN_KEY,
                ADMIN_KEY_HASH: createHash("sha256").update(TEST_ADMIN_KEY).digest("hex"),
              },
            },
          })),
        ],
        test: { name: "parts", include: ["test/parts/**/*.test.ts"], setupFiles: ["test/parts/setup.ts"] },
      },
    ],
  },
});

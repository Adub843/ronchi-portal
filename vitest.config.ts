import { mkdirSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// The portal config points at web/dist for the staff app. Tests don't need the built app,
// but the folder has to exist.
mkdirSync("web/dist", { recursive: true });

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
            miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("migrations/portal") } },
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
    ],
  },
});

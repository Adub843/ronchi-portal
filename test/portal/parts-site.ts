// Runs the customer parts site's code in-process for portal tests, with its own test database and
// bucket, so Publish and customer management are tested end to end through the real /admin door.
import { env } from "cloudflare:workers";
import partsApp from "../../src/parts/index";

export const partsEnv = {
  PARTS_DB: env.TEST_PARTS_DB,
  PARTS_FILES: env.TEST_PARTS_FILES,
  ASSETS: env.ASSETS,
  ORIGIN: "http://localhost:8789",
  RP_ID: "localhost",
  RP_NAME: "Ronchi Parts",
  ADMIN_KEY_HASH: env.TEST_ADMIN_KEY_HASH,
};

/** Connect the portal to the in-process parts site (or disconnect it). */
export function connectPartsSite(on = true) {
  const e = env as unknown as Record<string, unknown>;
  if (!on) {
    delete e.PARTS_ADMIN_KEY;
    return;
  }
  e.PARTS_ADMIN_KEY = env.TEST_ADMIN_KEY;
  e.PARTS = { fetch: (input: RequestInfo, init?: RequestInit) => partsApp.request(input as string, init, partsEnv) };
}

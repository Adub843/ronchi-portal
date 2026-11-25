// Runs the customer help center's code in-process for portal tests, with its own test database,
// so knowledge base Publish is tested end to end through the real /admin door.
import { env } from "cloudflare:workers";
import helpApp from "../../src/help/index";

export const helpEnv = { HELP_DB: env.TEST_HELP_DB, ADMIN_KEY_HASH: env.TEST_ADMIN_KEY_HASH };

/** What a customer sees at a help center address. */
export const helpPage = async (path: string) => (await helpApp.request(`https://help.example${path}`, {}, helpEnv)).text();

/** Connect the portal to the in-process help center (or disconnect it). */
export function connectHelpSite(on = true) {
  const e = env as unknown as Record<string, unknown>;
  if (!on) {
    delete e.HELP_ADMIN_KEY;
    return;
  }
  e.HELP_ADMIN_KEY = env.TEST_ADMIN_KEY;
  e.HELP = { fetch: (input: RequestInfo, init?: RequestInit) => helpApp.request(input as string, init, helpEnv) };
}

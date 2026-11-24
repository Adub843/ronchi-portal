import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env as PortalEnv } from "../src/portal/env";

declare global {
  namespace Cloudflare {
    interface Env extends PortalEnv {
      TEST_MIGRATIONS: D1Migration[];
      HELP_DB: D1Database;
    }
  }
}
export {};

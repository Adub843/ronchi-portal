import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env as PortalEnv } from "../src/portal/env";

declare global {
  namespace Cloudflare {
    interface Env extends PortalEnv {
      TEST_MIGRATIONS: D1Migration[];
      HELP_DB: D1Database;
      PARTS_DB: D1Database;
      PARTS_FILES: R2Bucket;
      ADMIN_KEY_HASH?: string;
      TEST_ADMIN_KEY: string;
      TEST_ADMIN_KEY_HASH: string;
      TEST_PARTS_DB: D1Database;
      TEST_PARTS_FILES: R2Bucket;
      TEST_PARTS_MIGRATIONS: D1Migration[];
    }
  }
}
export {};

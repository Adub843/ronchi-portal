import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// The customer parts site's own test database, for the publish tests (see parts-site.ts).
await applyD1Migrations(env.TEST_PARTS_DB, env.TEST_PARTS_MIGRATIONS);

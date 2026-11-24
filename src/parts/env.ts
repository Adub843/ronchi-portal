// What the customer parts Worker is given by Cloudflare (see wrangler.parts.jsonc).
// THE WALL: no binding, key or address for the business store (portal-db) or the staff Worker.

export interface PartsEnv {
  PARTS_DB: D1Database;     // parts-db: customer logins, their machines, the published catalog, carts and quotes
  PARTS_FILES: R2Bucket;    // ronchi-parts-files: published drawings and 3D models
  ASSETS: Fetcher;          // the built customer app in web-parts/dist
  AUTH_LIMIT?: RateLimit;
  API_LIMIT?: RateLimit;
  ORIGIN: string;           // https://parts.ronchiamerica.com
  RP_ID: string;
  RP_NAME: string;
  // SHA-256 (hex) of the key the staff portal uses to publish. Set with `wrangler secret put ADMIN_KEY_HASH`.
  // When it's missing, publishing is switched off.
  ADMIN_KEY_HASH?: string;
}

export type CustomerRole = "standard" | "buyer";

export interface Customer {
  id: string;
  companyId: string;
  companyName: string;
  email: string;
  name: string;
  role: CustomerRole;
  sessionHash: string;
}

export type PartsApp = { Bindings: PartsEnv; Variables: { user: Customer | null; ip: string } };

import type { Role } from "./lib/roles";

export type { Role };

// What the portal Worker is given by Cloudflare (see wrangler.portal.jsonc).
export interface Env {
  DB: D1Database;          // portal-db, the business store
  ASSETS: Fetcher;         // the built staff app in web/dist
  AUTH_LIMIT?: RateLimit;  // sign-in attempts per address
  API_LIMIT?: RateLimit;   // API calls per signed-in person
  ORIGIN: string;          // for example https://portal.ronchiamerica.com
  RP_ID: string;           // passkey domain, for example portal.ronchiamerica.com
  RP_NAME: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  can_type_address: number;
  sessionHash: string;
}


export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null; ip: string } };

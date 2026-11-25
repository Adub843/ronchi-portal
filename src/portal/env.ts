import type { Permission, Role } from "./lib/roles";

export type { Role };

// What the portal Worker is given by Cloudflare (see wrangler.portal.jsonc).
export interface Env {
  DB: D1Database;          // portal-db, the business store
  ASSETS: Fetcher;         // the built staff app in web/dist
  FILES: R2Bucket;         // photos and files sent in boards and chats (bucket ronchi-portal-files)
  AUTH_LIMIT?: RateLimit;  // sign-in attempts per address
  API_LIMIT?: RateLimit;   // API calls per signed-in person
  ORIGIN: string;          // for example https://portal.ronchiamerica.com
  RP_ID: string;           // passkey domain, for example portal.ronchiamerica.com
  RP_NAME: string;
  // The customer parts site (Worker ronchi-parts), reached only through this service binding.
  // The portal publishes into it; the parts site has no way to call back. PARTS_ADMIN_KEY is a
  // secret (`wrangler secret put PARTS_ADMIN_KEY`); its SHA-256 is the parts site's ADMIN_KEY_HASH.
  PARTS?: Fetcher;
  PARTS_ADMIN_KEY?: string;
  // The customer help center (Worker ronchi-help), the same way: the portal copies customer-safe
  // knowledge base articles in; the help center can't call back. HELP_ADMIN_KEY is a secret.
  HELP?: Fetcher;
  HELP_ADMIN_KEY?: string;
  // Job emails to techs (Cloudflare Email Service). Both are optional: without them the portal
  // says "email isn't set up" and offers to send from the scheduler's own email app.
  EMAIL?: SendEmail;
  MAIL_FROM?: string;      // for example jobs@ronchiamerica.com, on a domain set up for Email Sending
  // The portal's own Microsoft 365 app (docs/SHAREPOINT.md), so software downloads can come from
  // SharePoint through the portal. All three are secrets; without them downloads go straight to
  // SharePoint with each person's own Microsoft sign-in.
  MS_TENANT_ID?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  /** A built-in role id (see lib/roles.ts) or the id of a role an admin made (table roles). */
  role: string;
  /** Everything this person may do: their role plus any per-person changes. */
  perms: ReadonlySet<Permission>;
  /** The portal owner (Aaron): the only one who sees the command center. See lib/owner.ts. */
  owner: boolean;
  sessionHash: string;
}


export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null; ip: string } };

# Rebuild: from nothing to a running portal

For a new Cloudflare account, or rebuilding after a disaster. Takes about 30 minutes.
You need: a computer with Node 22+ and Git, the Cloudflare account, and the
`ronchiamerica.com` DNS in that Cloudflare account (or the ability to add records).

## 1. Get the code

```bash
git clone https://github.com/Adub843/ronchi-portal.git
cd ronchi-portal
npm ci
npm run check            # everything should pass before you go further
npx wrangler login       # opens the browser; sign in as the Cloudflare account owner
```

## 2. Create the databases and file stores

```bash
npx wrangler d1 create portal-db
npx wrangler d1 create help-db
npx wrangler d1 create parts-db
npx wrangler r2 bucket create ronchi-portal-files   # photos and files sent in chats (staff portal only)
npx wrangler r2 bucket create ronchi-parts-files    # published drawings and 3D models (customer parts site only)
```

Each database prints a `database_id`. Put the portal-db id into **both** places in
`wrangler.portal.jsonc` (top level and `env.production`), the help-db id into both
places in `wrangler.help.jsonc`, and the parts-db id into both places in
`wrangler.parts.jsonc`. Commit that change. (A test fails if parts-db ever gets the same
id as another database.)

## 3. Create the tables

```bash
npm run db:migrate:remote
```

If you are restoring from a backup instead, load the export first:
`npx wrangler d1 execute portal-db --remote --env production -c wrangler.portal.jsonc --file backup-portal.sql`
(and the same for help-db), then run `npm run db:migrate:remote` to apply anything newer.

## 4. Check the addresses

In `wrangler.portal.jsonc` under `env.production.vars`:

- `ORIGIN`: `https://portal.ronchiamerica.com`
- `RP_ID`: `portal.ronchiamerica.com` (passkeys are tied to this; changing it later means
  everyone makes a new passkey)

In `wrangler.parts.jsonc` under `env.production.vars`: `ORIGIN` is
`https://parts.ronchiamerica.com` and `RP_ID` is `parts.ronchiamerica.com`.

## 4b. Parts site

The staff portal publishes catalogs to the customer parts site through a private
service binding, using a long random key. The parts site keeps only the key's SHA-256
hash, so reading its settings never reveals the key.

```bash
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$KEY")
echo "$HASH" | npx wrangler secret put ADMIN_KEY_HASH --env production -c wrangler.parts.jsonc
echo "$KEY"  | npx wrangler secret put PARTS_ADMIN_KEY --env production -c wrangler.portal.jsonc
unset KEY HASH
```

Don't write the key down anywhere else. If it's ever lost or leaked, make a new one the
same way (RECOVERY.md section 7). Until both secrets are set, the portal's catalog shows
"The customer parts site isn't connected yet" and nothing can be published.

## 5. Deploy

```bash
npm run deploy
```

This runs all checks, builds the staff and customer apps, and deploys the three Workers
in order: the parts site first (the portal's service binding needs it to exist), then the
portal, then the help center.

## 6. Custom domains

Dashboard → Workers & Pages → `ronchi-portal` → Settings → Domains & Routes → Add →
Custom domain → `portal.ronchiamerica.com`. Same for `ronchi-help` →
`help.ronchiamerica.com`, and `ronchi-parts` → `parts.ronchiamerica.com`.

Then Dashboard → the zone → Security → WAF → turn on the Cloudflare Managed Ruleset.

## 7. First admin

```bash
npm run invite:first-admin -- --name "Aaron Lewis" --username AaronL   # or --email someone@company.com
```

Open the printed link and create a passkey. Paolo then invites everyone else from
**People**. (If you restored from a backup, skip this: people sign in as before. If their
passkeys were made for a different domain, use RECOVERY.md section 2.)

## 8. Check it

- `https://portal.ronchiamerica.com` shows the sign-in page.
- `https://help.ronchiamerica.com` shows the help search.
- `https://parts.ronchiamerica.com` shows the parts site's sign-in page.
- In the portal, **Parts catalog** doesn't say the parts site isn't connected.
- `curl -sI https://portal.ronchiamerica.com | grep -i content-security` shows the policy.

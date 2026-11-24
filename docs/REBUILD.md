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

## 2. Create the two databases

```bash
npx wrangler d1 create portal-db
npx wrangler d1 create help-db
```

Each prints a `database_id`. Put the portal-db id into **both** places in
`wrangler.portal.jsonc` (top level and `env.production`), and the help-db id into both
places in `wrangler.help.jsonc`. Commit that change.

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

## 5. Deploy

```bash
npm run deploy
```

This runs all checks, builds the staff app, and deploys both Workers.

## 6. Custom domains

Dashboard → Workers & Pages → `ronchi-portal` → Settings → Domains & Routes → Add →
Custom domain → `portal.ronchiamerica.com`. Same for `ronchi-help` →
`help.ronchiamerica.com`.

Then Dashboard → the zone → Security → WAF → turn on the Cloudflare Managed Ruleset.

## 7. First admin

```bash
npm run invite:first-admin -- --name "Paolo Ferla" --email paolo@ronchiamerica.com
```

Open the printed link and create a passkey. Paolo then invites everyone else from
**People**. (If you restored from a backup, skip this: people sign in as before. If their
passkeys were made for a different domain, use RECOVERY.md section 2.)

## 8. Check it

- `https://portal.ronchiamerica.com` shows the sign-in page.
- `https://help.ronchiamerica.com` shows the help search.
- `curl -sI https://portal.ronchiamerica.com | grep -i content-security` shows the policy.

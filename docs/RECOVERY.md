# Recovery: what to do when something goes wrong

Each fix is written as exact steps. Commands run in the `ronchi-portal` folder on a
computer with Node 22 and `npx wrangler login` done once (Cloudflare account owner).

Cloudflare dashboard: https://dash.cloudflare.com → Workers & Pages.

---

## 1. The portal or help center is down

1. Open https://www.cloudflarestatus.com. If Cloudflare has an outage, wait.
2. Dashboard → Workers & Pages → `ronchi-portal` (or `ronchi-help`) → **Logs**. Look for red errors.
3. If it broke right after a deploy, roll back: the Worker → **Deployments** → the
   previous one → **Rollback**. Or run `npx wrangler rollback -c wrangler.portal.jsonc --env production`.
4. If the database is the problem, see section 5.

## 2. Someone is locked out (lost phone, new phone)

1. An admin opens **People** → that person → **Sign out everywhere** (this kills any
   session on the lost phone).
2. Create a new invite for the same email: since the login exists, use the person's
   own **Settings → Add a phone or computer** link from another signed-in device; if
   they have none, an admin runs this to make a one-hour device link:
   ```bash
   # replace the email; prints nothing secret to logs except the link itself
   node -e "
   const c=require('crypto');const t=c.randomBytes(32).toString('base64url');
   console.log('LINK: https://portal.ronchiamerica.com/welcome#'+t);
   console.log('HASH:',c.createHash('sha256').update(t).digest('hex'))"
   npx wrangler d1 execute portal-db --remote --env production -c wrangler.portal.jsonc --command \
     "INSERT INTO invites (id,email,name,role,token_hash,created_at,expires_at,user_id)
      SELECT lower(hex(randomblob(16))), email, name, role, '<HASH>', datetime('now'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'), id
      FROM users WHERE email='person@ronchiamerica.com'"
   ```
3. Send them the link directly. They open it and create a new passkey.
4. Old passkeys can be removed by the person in **Settings**.

## 3. The only admin is locked out

Same as section 2, step 2, using the admin's email. If the admin was disabled by mistake:

```bash
npx wrangler d1 execute portal-db --remote --env production -c wrangler.portal.jsonc --command \
  "UPDATE users SET status='active', role='admin' WHERE email='paolo@ronchiamerica.com'"
```

## 4. Suspected break-in or a leaked link

1. **People** → **Sign out everywhere** for anyone affected (or everyone).
2. Look at **People → Recent activity** for odd sign-ins, exports or role changes. The
   full log is the `audit_log` table:
   `npx wrangler d1 execute portal-db --remote --env production -c wrangler.portal.jsonc --command "SELECT * FROM audit_log ORDER BY at DESC LIMIT 200"`
3. Disable any account that shouldn't exist.
4. Unused invites can be cancelled in **People**.
5. To sign out every person at once:
   `npx wrangler d1 execute portal-db --remote --env production -c wrangler.portal.jsonc --command "DELETE FROM sessions"`
6. Write down what happened and when, and tell Paolo.

## 5. Data needs restoring

D1 keeps a 30-day point-in-time history ("Time Travel").

1. Find the time before the problem (UTC), for example `2026-12-01T14:00:00Z`.
2. Check what's there: `npx wrangler d1 time-travel info portal-db --env production -c wrangler.portal.jsonc --timestamp 2026-12-01T14:00:00Z`
3. Restore: `npx wrangler d1 time-travel restore portal-db --env production -c wrangler.portal.jsonc --timestamp 2026-12-01T14:00:00Z`
   (This replaces the live database. Everything after that time is lost, so export first:
   `npx wrangler d1 export portal-db --remote --env production -c wrangler.portal.jsonc --output before-restore.sql`.)
4. Same for `help-db` if needed.

Nightly exports to a separate, locked storage bucket are added before launch (plan,
"Before launch").

## 6. A deploy broke something

Rollback (section 1, step 3), then fix on a branch, run `npm run check`, open a pull
request, and deploy again after it is merged.

## 7. The parts site publish key leaked or was lost

Make a new key and set both halves (REBUILD.md step 4b). The old key stops working as
soon as the new `ADMIN_KEY_HASH` is set. Wrong-key attempts are recorded in the parts
site's audit log:
`npx wrangler d1 execute parts-db --remote --env production -c wrangler.parts.jsonc --command "SELECT * FROM audit_log ORDER BY at DESC LIMIT 100"`

## 8. A customer company must be cut off now

In the portal: **Customers** → the company → **Manage** → **Turn company off**. Everyone
at that company is signed out at once and can't sign in until it's turned back on. To
cut off one person, use **Turn off** on their row. To stop a company seeing one machine,
remove it from **Machines they see** and save.

If the portal itself is down, the same from the command line:
`npx wrangler d1 execute parts-db --remote --env production -c wrangler.parts.jsonc --command "UPDATE companies SET status='disabled' WHERE name='Company Name'; DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id=(SELECT id FROM companies WHERE name='Company Name'))"`

## 9. Pull a catalog off the parts site

**Parts catalog** → the machine → **Unpublish**. Its sheets, drawings and 3D files are
removed from the parts site at once. The staff copy in the portal is untouched.


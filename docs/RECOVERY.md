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

## 2. Someone is locked out (forgot password, lost phone)

1. An admin opens **People** and presses **Reset password** next to that person. Their old
   password stops working, they're signed out everywhere, and their next sign-in asks them
   to choose a new password (open for the invite lifetime, 72 hours by default).
2. Lost phone only: **Sign out everywhere** on the same row ends the session on that phone.

## 3. The only admin is locked out

Reopen the admin's first sign-in from the command line. Put the admin's username (lower
case) in place of `aaronl`. For the next 2 hours, signing in with that username asks for a
new password:

```bash
npx wrangler d1 execute portal-db --remote --env production -c wrangler.portal.jsonc --command \
  "UPDATE users SET status='active', password_hash=NULL, failed_logins=0, locked_until=NULL, password_setup_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 hours') WHERE email='aaronl'; DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE email='aaronl')"
```

Sign in straight away: until a password is chosen, anyone who knows the username could
choose it.

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


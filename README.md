# Ronchi Portal

The control hub for Ronchi America: one sign-in for staff (computer or phone), plus a
separate public help center for customers. Written so any web developer can pick it up.

- **Staff portal** (`portal.ronchiamerica.com`): sign-in with passkeys, message boards,
  machine registry, time clock and hours. Later steps add the knowledge base, training,
  orders, the schedule and remote support (see the plan).
- **Help center** (`help.ronchiamerica.com`): an open search of Ronchi-made articles.
  No login, and no way to reach business data (see "The wall" below).

Plan: https://claude.ai/artifact/RVQFd7dgM7uPNsj9gaFSJQ

## What it's built with

All mainstream, nothing homemade:

| Part | Tool |
| --- | --- |
| Language | TypeScript |
| Server | Cloudflare Workers with [Hono](https://hono.dev) |
| Database | Cloudflare D1 (SQLite) |
| Staff app | React + Vite, served by the portal Worker |
| Sign-in | Passkeys via [SimpleWebAuthn](https://simplewebauthn.dev) |
| Tests | Vitest, run inside the real Workers runtime |

## Folders

```
src/portal/          staff portal Worker
  index.ts           start here: security headers, request checks, routes
  env.ts             what Cloudflare gives the Worker
  lib/roles.ts       who can do what (one table)
  lib/session.ts     sign-in cookies
  routes/            one file per feature: auth, users, machines, boards, clock, prefs
src/help/            customer help center Worker (may import only src/help and src/shared)
src/shared/          code both sides use: ids, CSV export, privacy check, themes, headers
web/                 staff app (React). web/src/pages has one file per screen
migrations/portal/   database tables for the business store (portal-db)
migrations/help/     database tables for the customer store (help-db)
test/                automatic tests (unit, portal, help)
scripts/             first-admin.mjs makes the very first admin invite
docs/                RECOVERY.md and REBUILD.md
```

## Run it on a laptop

Needs Node 22 or newer.

```bash
npm ci
npm run db:migrate:local                 # creates local copies of both databases
npm run invite:first-admin -- --name "Your Name" --email you@example.com --local
npm run dev                              # builds the app, serves it at http://localhost:8787
```

Open the printed `http://localhost:8787/welcome#...` link and create a passkey
(Windows Hello, Touch ID, or your phone). The help center runs with `npm run dev:help`
on http://localhost:8788.

For front-end work with instant reload, run `npm run dev` in one window and
`npm run dev:web` in another, then use http://localhost:5173.

## Preview with example data

`npm run build:demo` builds the same staff app with `web/src/demo/mock.ts` answering the API
from example data, as one file (`web/dist-demo/ronchi-portal-preview.html`). That's the
clickable preview shown inside Claude. The real build never includes the demo code or its
example data.

## Checks

```bash
npm run check        # type checks + every test (about 10 seconds)
```

GitHub runs the same checks on every pull request, plus a CodeQL security scan.
Dependabot opens pull requests for dependency updates every week. Every version in
`package.json` is pinned exactly, and `package-lock.json` is committed.

(`.npmrc` turns on `legacy-peer-deps` because npm 10 crashes on Vitest's optional
peer list. All peers the project needs are listed directly in `package.json`.)

## How security works

- **Passkeys only.** No passwords and no text codes. A person gets a one-time invite link
  (72 hours) from an admin, and creates a passkey. Extra devices are added from
  Settings with a one-hour link.
- **Sessions** are a random 256-bit token in an `HttpOnly`, `Secure`, `SameSite=Strict`
  cookie. Only its SHA-256 hash is stored. Sessions end after 14 idle days or 30 days,
  and can be ended from Settings (own devices) or People (anyone, by an admin).
  Changing someone's role or disabling them signs them out everywhere at once.
- **Deny by default.** Every API route asks `requirePerm(...)`; the role table is in
  `src/portal/lib/roles.ts`. Boards limited to some roles return "not found" to others.
- **Changes must come from the portal's own pages**: `Origin` must match and the
  `X-Ronchi: 1` header must be present, on top of the SameSite cookie.
- **Headers**: strict Content Security Policy (only our own files), HSTS, no framing,
  no referrer. Fonts are bundled, nothing loads from other sites.
- **Rate limits** on sign-in (20 a minute per address) and the API (300 a minute).
- **Audit log** of sign-ins, invites, role changes, exports and hour edits. The database
  itself refuses to change or delete audit rows.
- **Time clock** uses the server's clock. Location is taken only at the tap.
  **Typed-address mode** (hard rule): people allowed to type an address can turn it on;
  while it is on the app never asks the device for its location, the server discards any
  coordinates, and every punch uses the typed address until it is turned off. Time
  changes need someone else's approval (Lola or an admin); the original time is kept.
- **Exports** are built so a spreadsheet cell can't run as a formula.
- **Message board text** is always shown as text, never as HTML.

## The wall (customers vs. business)

The help center is a separate Worker with a separate database:

- `wrangler.help.jsonc` binds only `help-db`. It has no binding, URL or key for `portal-db`.
- `help-db` holds only published, customer-safe articles (`migrations/help`).
- Code in `src/help` may import only from `src/help` and `src/shared`.
- `src/shared/privacy.ts` refuses any text with a customer name, site or machine number.
  Step 2's Publish button runs it before copying an article across.

`test/unit/wall.test.ts` checks all of these on every build, so a change that breaks
the wall fails the build.

## Going live

See [docs/REBUILD.md](docs/REBUILD.md). In short: create the two D1 databases, put their
ids in the two wrangler files, `npm run db:migrate:remote`, `npm run deploy`, then
`npm run invite:first-admin` and set up the two custom domains in Cloudflare.

If something breaks: [docs/RECOVERY.md](docs/RECOVERY.md).

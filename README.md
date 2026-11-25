# Ronchi Portal

The control hub for Ronchi America: one sign-in for staff (computer or phone), plus a
separate public help center and a customer parts site. Written so any web developer can pick it up.

- **Staff portal** (`ronchi-portal.business-console.workers.dev` for now): sign-in with passkeys, message boards,
  the machine registry, change-part orders and the knowledge base (one search box with filters, Issue
  and Fix articles, quick notes, search by machine number or customer). Later steps add workbook
  Submit, the schedule and remote support (see the plan).
- **Help center** (`ronchi-help.business-console.workers.dev`): an open search of Ronchi-made articles.
  No login, and no way to reach business data (see "The wall" below). Articles arrive only by the
  knowledge base's one-way Publish, after a scan for customer names, sites, machine numbers, emails,
  phone numbers and passwords; the machine number of a quick note is never sent. Someone who searches
  a machine number is sent to sign in to the parts site, which knows the machines on their account.
- **Parts site** (`ronchi-parts.business-console.workers.dev`): the interactive parts catalog for customers.
  Each customer company signs in with passkeys and sees only its own machines: 2D
  exploded drawings with clickable balloons, 3D models to rotate, hide, isolate,
  see through, explode and cut, search, carts, shared lists and quote requests.
  Staff build the catalogs in the portal (**Parts catalog**) from manual chapter 11 and
  CAD, then publish them across. Same wall as the help center.

Parts catalog plan: https://claude.ai/artifact/Q3W9nmRCZfQmvY6cPo9bha

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
| Files | Cloudflare R2 |
| Manual reading | [pdf.js](https://mozilla.github.io/pdf.js/), in the browser |
| 3D | [three.js](https://threejs.org); STEP is turned into glTF in the browser by [occt-import-js](https://github.com/kovacsv/occt-import-js) (OpenCascade, LGPL 2.1, loaded as its own unmodified file) |
| Tests | Vitest, run inside the real Workers runtime; Playwright for browser checks |

## Folders

```
src/portal/          staff portal Worker
  index.ts           start here: security headers, request checks, routes
  env.ts             what Cloudflare gives the Worker
  lib/roles.ts       who can do what (sections switched off in Settings are removed for everyone but admins)
  lib/settings.ts    the admin controls in Settings: defaults, limits, checks (stored by lib/settings-store.ts)
  lib/session.ts     sign-in cookies
  routes/            one file per feature: auth, users, machines, boards, prefs, catalog, customers
  lib/parts-site.ts  the only way the portal talks to the parts site (publish, customer logins)
src/help/            customer help center Worker (may import only src/help and src/shared)
src/parts/           customer parts site Worker (may import only src/parts and src/shared)
  lib/access.ts      which machines a signed-in customer may see; every customer route uses it
  routes/admin.ts    the publish door the portal uses, locked by key
src/shared/          code all sides use: ids, CSV export, privacy check, themes, headers,
  catalog/           the catalog's data shapes and the chapter 11 reader
web/                 staff app (React). web/src/pages has one file per screen
web/catalog/         the 2D and 3D viewers, shared by the staff app and the parts site
web-parts/           customer parts app (React)
migrations/portal/   database tables for the business store (portal-db)
migrations/help/     database tables for the help store (help-db)
migrations/parts/    database tables for the parts site (parts-db)
test/                automatic tests (unit, portal, help, parts)
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

The parts site runs with `npm run dev:parts` on http://localhost:8789. To publish to it
from a local portal, both need the same key. Put it in `.dev.vars` files (never committed):

```bash
KEY=local-publish-key-0123456789abcdefghijklmnop
echo "PARTS_ADMIN_KEY=$KEY" > .dev.vars.portal
echo "ADMIN_KEY_HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('$KEY').digest('hex'))")" > .dev.vars.parts
npx wrangler dev -c wrangler.parts.jsonc --port 8789 --inspector-port 9331 --env-file .dev.vars.parts
npx wrangler dev -c wrangler.portal.jsonc --port 8787 --inspector-port 9332 --env-file .dev.vars.portal
```

Customers are added in the portal under **Customers**; the sign-up link it makes opens
the local parts site.

For front-end work with instant reload, run `npm run dev` in one window and
`npm run dev:web` in another, then use http://localhost:5173.

## Preview with example data

`npm run build:demo` builds the same staff app with `web/src/demo/mock.ts` answering the API
from example data, as one file (`web/dist-demo/ronchi-portal-preview.html`). That's the
clickable preview shown inside Claude. The real build never includes the demo code or its
example data. The preview lists machines under **Parts catalog** but can't import, edit or
publish; that needs the real portal.

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
  (72 hours unless an admin changes it in Settings) from an admin, and creates a passkey. Extra devices are added from
  Settings with a one-hour link.
- **Sessions** are a random 256-bit token in an `HttpOnly`, `Secure`, `SameSite=Strict`
  cookie. Only its SHA-256 hash is stored. Sessions end after 14 idle days or 30 days (both adjustable in Settings > Admin controls),
  and can be ended from Settings (own devices) or People (anyone, by an admin).
  Changing someone's role or disabling them signs them out everywhere at once.
- **Deny by default.** Every API route asks `requirePerm(...)`; the role table is in
  `src/portal/lib/roles.ts`. An admin can turn a whole section off in Settings > Admin controls;
  its permissions are then removed from everyone but admins, even from someone given one personally.
  Managing people, the admin controls and the audit log stay admin-only. Boards limited to some roles return "not found" to others.
- **Per-person access.** On People, the Access button switches any single permission on or off
  for one person, on top of their role (table `user_access`, migration 0009). It applies on
  their next click. Admins always keep everything, nobody can change their own access, and
  managing people and the audit log stay admin-only. Every change goes in the audit log.
- **Roles.** Admin (Aaron only) can do everything. Manager (Paolo, Steve, Michele, Morad) can do
  everything except manage people and read the audit log. Each page's add, change and remove
  actions are separate switches (for example orders.add, orders.edit, orders.remove), and the
  Access panel's "View only" button switches off everything that adds, changes or removes.
- **Changes must come from the portal's own pages**: `Origin` must match and the
  `X-Ronchi: 1` header must be present, on top of the SameSite cookie.
- **Headers**: strict Content Security Policy (only our own files), HSTS, no framing,
  no referrer. Fonts are bundled, nothing loads from other sites.
- **Rate limits** on sign-in (20 a minute per address) and the API (300 a minute).
- **Audit log** of sign-ins, invites, role changes and exports. The database
  itself refuses to change or delete audit rows.
- **No time clock.** Ronchi keeps time in its existing timekeeping app; the portal has no
  clock, hours or location tracking (removed 2026-11-24 at Aaron's request).
- **Exports** are built so a spreadsheet cell can't run as a formula.
- **Message board and chat text** is always shown as text, never as HTML.
- **Private chats** can be read only by the people in them, admins included
  (Aaron's choice, 2026-11-24). Boards stay visible to the roles they're shared with.
- **People in a chat:** anyone in a chat can add people, and they then see its history. Only
  the person who started the chat can remove someone, who loses access at once. Adding someone
  to a one-to-one chat starts a new group instead, so the two-person history stays private.
  Each add, remove and leave shows as a line in the chat and goes in the audit log.
- **Files in chats** (photos, PDF, Office, CAD, video, zip; 25 MB each) are kept in R2 and
  served only to people who can see that chat. The served type comes from the file's
  extension (src/shared/files.ts), never from the uploader's browser; web pages, SVG and
  programs are refused, and every file is served with a sandbox policy so it can't run code.
- **Knowledge base publish** goes one way through the HELP service binding with its own key
  (`scripts/set-help-key.mjs`); the help center can't call back. A publisher can confirm a word is
  not a customer detail (a customer called "Method"), but never a machine number or a password.
- **Languages:** English, Spanish and Italian for the app's screens (web/src/i18n-dict.ts).
  Messages are never translated. A test fails if any screen text is missing a translation.

## The wall (customers vs. business)

The help center and the parts site are each a separate Worker with a separate database.
The help center:

- `wrangler.help.jsonc` binds only `help-db`. It has no binding, URL or key for `portal-db`.
- `help-db` holds only published, customer-safe articles (`migrations/help`).
- Code in `src/help` may import only from `src/help` and `src/shared`.
- `src/shared/privacy.ts` refuses any text with a customer name, site or machine number. The knowledge
  base's Publish runs it (through `src/shared/kb.ts`, which also checks emails, phone numbers and passwords).
  Step 2's Publish button runs it before copying an article across.

The parts site:

- `wrangler.parts.jsonc` binds only `parts-db` and the `ronchi-parts-files` bucket. No
  other Worker binds them, and the parts site has no service bindings, so it can't call
  out. The portal calls in through one service binding with a key whose hash only the
  parts site holds; wrong keys get "not found" and are logged.
- `parts-db` holds parts, drawings and models, and the customers' own logins, carts and
  quote requests. No prices, costs, staff names or staff notes (a test checks the table
  list). Publishing refuses any sheet with a customer name or site from the registry.
- Each company sees only the machines staff link to it. Every customer request goes
  through `src/parts/lib/access.ts`; another company's machine, sheet, file or quote
  answers "not found". `test/parts` signs in as two companies and tries each route
  across the wall.
- Code in `src/parts` may import only from `src/parts` and `src/shared`.

`test/unit/wall.test.ts` checks all of these on every build, so a change that breaks
the wall fails the build.

## Jobs, job emails and the Ronchi workbook

- **Jobs** (`/jobs`): a scheduled field service visit. Job number, customer, machine, the customer's
  location (opens in Google Maps, Waze or Apple Maps), point of contact, days of work, the field service
  engineers going, a free text box, and files. Schedulers (`jobs.schedule`: scheduling, service, admins)
  make and change jobs. Everyone with `jobs.view` sees them; the engineers on a job always see it.
  Code: `src/portal/routes/jobs.ts`, `src/shared/jobs.ts`, `web/src/pages/Jobs.tsx`. Files go in R2 under `jobs/<id>`.
- **Work orders** (`/work-orders/<job>`): the Ronchi workbook page. The current work order on top, then the
  log of past work orders for the same machine with their notes and files, and the machine's record.
  `web/src/pages/WorkOrders.tsx`.
- **Job paperwork** (the old "Ronchi Field Service Workbook" app, now on each work order): tabs for **Time sheet**,
  **Service report**, **Job chat** and **Machine history**. Each field service engineer on the job has their own time
  sheet (one line per day: date, start, end, break, travel, work hours worked out, billable or not, production hours,
  notes; expenses with type, description, quantity such as miles or nights, and a receipt photo, never an amount) and
  their own service report (job details filled in from the job, summary, work log per day, Ronchi parts used or
  needed, photos, recipe and settings, follow-up, and the customer's name, date and signature drawn on the screen,
  saved as a PNG). One report per engineer, like the old workbook: each person's work, hours and sign-off stay theirs.
  Everything saves as it's typed, on Enter and on upload. Draft → sent for review → approved, or sent back with a note;
  approved is locked until a reviewer sends it back. Engineers see only their own; reviewers (`reports.review`) see
  all of it on **Time sheets and reports** (`/reports`) with queues, filters and an hours CSV. The service report has
  a printable page (Print or save as PDF). Code: `src/portal/routes/reports.ts`, `src/shared/reports.ts`,
  `web/src/pages/Workbook.tsx`, `web/src/pages/Reports.tsx`. Files go in R2 under `reports/<id>` and are served only
  to the engineer who owns the paperwork and to reviewers. Times are typed paperwork: there is still no clock.
- **Job chat**: a private chat (the normal chat code and rules) linked to the job in `job_chats`, made the first time
  someone opens it. In it: the job's engineers and the scheduler who made the job; anyone who schedules jobs joins when
  they open it. Engineers put on the job join it and engineers taken off leave it (`src/portal/lib/job-chat.ts`).
- **The workbook switch**: Settings > Ronchi workbook (admins). Off = Work orders, the job paperwork and `/reports`
  leave the menu, their API answers "Not found", and the job email links to the plain job page. Jobs, emails, files
  and job chats already made (under Chats) keep working. The Command center section "Time sheets and service reports"
  closes the paperwork to everyone but admins.
  Stored in table `feature_switches` (`src/portal/lib/switches.ts`).
- **Job emails** go out through Cloudflare Email Service. Until it is set up, nothing is sent: the job
  page says so and offers "Send it from my email", which opens the scheduler's own email app with the same message.
  To turn it on (needs the sending domain's DNS on Cloudflare, so after the ronchiamerica.com move):
  1. `npx wrangler email sending enable ronchiamerica.com` (or Cloudflare dashboard > Email Service).
  2. In `wrangler.portal.jsonc` under `env.production`, add `"send_email": [{ "name": "EMAIL" }]` and the var
     `"MAIL_FROM": "jobs@ronchiamerica.com"`, then deploy.
  3. People whose login is a username (no email) need an "email for job notices", set on the People page.

## Going live

See [docs/REBUILD.md](docs/REBUILD.md). In short: create the three D1 databases and two R2
buckets, put the ids in the three wrangler files, set the parts site's publish key,
`npm run db:migrate:remote`, `npm run deploy`, then `npm run invite:first-admin` and set up
the three custom domains in Cloudflare.

If something breaks: [docs/RECOVERY.md](docs/RECOVERY.md).

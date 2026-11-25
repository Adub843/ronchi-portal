# Cloudflare usage

What uses the Cloudflare account's free daily allowance, and how to stay inside it.
The free allowances reset every day at 00:00 UTC (7 PM Eastern in winter, 8 PM in summer).

## The limits that matter (Workers Free plan, whole account)

| Allowance | Free per day | Normal portal use |
| --- | --- | --- |
| Worker requests | 100,000 | about 4 a minute per person using the portal (see `web/src/poll.ts`) |
| D1 rows written | 100,000 | a few hundred |
| D1 rows read | 5,000,000 | tens of thousands |

On the free plan, going over a D1 allowance makes database calls fail until the reset.
The Workers Paid plan ($5 a month) raises these to 10 million requests and 50 million rows written a month.

## What went wrong on 2026-11-25

The one-time parts catalog load (488 machines, 24,006 sheets, 260,957 rows, 37,467 parts) was run
as one SQL file at about 05:40 UTC. With the indexes, it wrote about 1.19 million rows in one hour,
12 times the free daily allowance, and Cloudflare paused the account's D1 until the reset or an upgrade.
Day-to-day use of the portal writes a few hundred rows a day.

## Rules for big loads

- On the free plan, split any load over 80,000 rows written across days (each table row also writes
  one row per index on it, so a `catalog_rows` row counts as 3).
- Don't run whole-table counts on big tables (`SELECT COUNT(*) FROM catalog_rows`) to check a load:
  each one reads every row. Count one machine's sheets instead.

## How often the app checks for new messages

Set in `web/src/poll.ts`. One alerts check per signed-in tab drives everything: every 15 seconds while
someone is using the page, every minute when it is left open untouched for 5 minutes, and every 5 minutes
in a background tab. Open chat lists and chats reload when that check sees a new message, with a slow
backstop check (chat list every minute, open chat every 30 seconds) for edits and renames.

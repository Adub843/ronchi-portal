# Ronchi Portal: ways to make it better

Last updated: 2026-11-25. These are the improvements found during the full check of the portal. The
items most worth doing come first. Each one says what it would change and what it needs.

## Decisions for Aaron

1. **Money amounts in sales tracking.** The portal has a locked rule: "No money amounts or sales totals are
   shown anywhere in the portal." Because of that rule, Parts orders tracks counts, quantities and dates
   only. The top sales tools (Syncron, Prophet 21, Acumatica) also track revenue, open order value and
   margin. If you want those numbers, the rule would change to "money amounts are visible only to the
   owner and managers". Price fields would be added then.
2. **Real-time updates instead of every 15 seconds.** Live updates now reach other people's screens on
   their next check: 15 seconds while the page is in use, 60 seconds when it's left untouched, and
   5 minutes for a background tab. Cloudflare Durable Objects with WebSockets would make it instant.
   That is one new piece on the Cloudflare account, about 1 to 2 days of work, and likely stays within the
   free or $5 plan.
3. **Ronchi CAD for 3D.** The 3D pipeline is ready, but real 3D for each machine needs Ronchi's own
   files: SolidWorks or STEP from SharePoint, or exports from Ronchi Mario in Italy. Someone has to
   copy them to the PC (Desktop\ronchi-cad\inbox) or say where they are.

4. **One service report per engineer, or one per job?** Each field service engineer now has their own
   report and time sheet for each job, the way the old Field Service Workbook worked. If the customer
   should sign once for the whole visit, it can become one shared report per job.
5. **Leaving a job chat.** An engineer taken off a job leaves its chat and loses the history. The other
   choice is to let them keep reading it.
6. **Who ships and receives.** Billing (Lola) and Service can ship and receive. Sales can ship, receive
   and work parts orders. Everyone else can only view them. This can be changed on People > Roles.
7. **LTL tracking links.** The links for Old Dominion, Estes, Saia, R+L and ABF need one check each
   on the carrier's own site, and XPO needs a link added (Shipping and receiving > Carriers). UPS,
   FedEx, USPS and DHL are checked.

## Worth doing next

- **Offline use for field service engineers.** The old Field Service Workbook app worked with no
  signal. Time sheets and service reports would be saved on the phone and sent once there is signal
  again. This needs an installable app (a service worker).
- **Job emails.** Cloudflare Email Service is built in but switched off until the ronchiamerica.com
  domain is on Cloudflare (README, "Job emails"). Until then, "Send it from my email" opens the
  scheduler's own mail app.
- **Separate switches for Chats and for Boards.** They share one permission today (boards.use), so
  the Command center switches them together.
- **Built-in roles edited in People > Roles don't get new permissions on their own.** A role that was
  changed by hand keeps its own saved list. New permissions such as reports.write and ship.view have
  to be ticked on that role. Roles that were never edited get them automatically.
- **Shipments booked at the same moment.** Two people shipping the same order in the same second could
  ship more than was ordered. The quantity is checked when the shipment is read, not inside one
  database transaction. Moving that check into a single D1 batch would close the gap.
- **Stock on hand, pick lists and bills of lading.** Shipping records what came in and what went out,
  but it doesn't keep a running stock count per bin yet. It has no pick list or bill of lading either.
- **"Raise a parts order" from a service report** opens Parts orders, but doesn't fill in the parts
  the engineer listed yet.
- **On phones, the Backordered tag on a parts order's lines** is cut off at the right edge.
- **Carrier connections (paid, later).** Shipping is manual today: type the tracking number and
  open the carrier's page. A ShipStation or EasyPost account would add rate shopping, label
  printing and automatic tracking status.
- **Accounting link.** Parts orders keep the invoice number typed by hand. A QuickBooks or NetSuite
  connection would fill it in.
- **Drawings published to customers aren't checked for customer names.** The text of a catalog
  is scanned before it is published, but the drawing images are copied as they are. A title block
  could show a customer's name (unconfirmed). Text recognition on each drawing before publishing
  would close this gap.
- **The demo file is 15 MB.** The preview inlines the 3D and PDF readers. Loading them only when a
  catalog page opens would make the preview, and the real app's first load, faster.
- **The Ronchi watermark** behind the cards on every page is busy compared with the reference apps.
  A plainer background would look more finished.

## Done during this check (2026-11-25)

- Parts orders and sales tracking (/parts-orders) and Shipping and receiving (/shipping), modeled on
  Prophet 21, Acumatica, Odoo, inFlow, NetSuite, ShipStation, Freightview and Flexport (research in
  docs/research).
- The Ronchi workbook on every work order: time sheet, service report with photos and customer
  signature, job chat, and the reviewers' page (/reports). Everything saves as you type.

- Live updates: every save, Enter or upload makes other people's open pages reload that area,
  but never while they are typing.
- Command center switches for every new part: Parts orders and sales, Shipping and receiving, and
  Time sheets and service reports. Software downloads now has its own switch.
- 13 audit fixes (see the pull request): owner protection on Restore, no API route to grant admin,
  job files working with chats off, no staff names sent to the parts site, safe machine edits, list
  limits on the parts site, a menu that never hides pages, phone card tables, and plain audit-log
  names.

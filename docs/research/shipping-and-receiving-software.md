# Shipping and receiving software: what the leaders do, and what Ronchi should copy

Research date: 25 November 2026. Every claim links to the vendor's own page or docs where one could be read. Where a vendor page did not say something, this file says so instead of guessing.

## Short answer

Most of what makes ShipStation, Fishbowl, Odoo and the others useful is plain record keeping. A list of things to ship. A packing slip. A bill of lading. A list of things coming in. A way to receive part of an order. A note and a photo when something arrives damaged. A shelf location. None of that needs an outside service. The portal can do all of it today on Cloudflare Workers and D1.

Only three things truly need an outside account:

1. Printing a real carrier label (UPS, FedEx, USPS, LTL).
2. Live carrier prices (rate shopping).
3. Live tracking status pulled into the portal (for example "Out for delivery").

A tracking LINK does not need any account. The portal can save the carrier and tracking number and build a link to the carrier's public tracking page.

## Ronchi's situation in one paragraph

Outbound: whole machines on LTL or full truckload, in crates or on pallets. Spare parts and change parts by UPS or FedEx parcel, sometimes freight. Samples. Inbound: machines and parts from Italy by ocean or air, with customs. Supplier deliveries. Customer returns (RMA). Customer sample bottles and caps sent in for change-part testing. One shipping helper (Olivia) plus office staff. Volume is low and the items are big and costly. That shape favors careful records over high-speed label printing. Tools built for e-commerce stores shipping 500 parcels a day (ShipStation, Shippo) are the wrong fit to buy, but they have good ideas to copy.

---

## 1. Parcel shipping tools

### ShipStation

What it does:

- Plans priced by shipments per month. Starter is $14.99 a month for 50 shipments with 3 users. Standard is $29.99 for 50 shipments with 10 users. The page lists a $0.00 per-label fee on all plans. [shipstation.com/pricing](https://www.shipstation.com/pricing/)
- Branded tracking page and branded tracking emails are in Standard and Premium only, not Starter. [shipstation.com/pricing](https://www.shipstation.com/pricing/)
- Returns: Starter has return labels only. Standard adds a returns portal, a branded returns and exchanges portal, and RMA workflows. [shipstation.com/pricing](https://www.shipstation.com/pricing/)
- API access is in Standard and Premium, not Starter. [shipstation.com/pricing](https://www.shipstation.com/pricing/)
- Batch label printing ("ad hoc batch" when you print many labels at once). [ShipStation glossary](https://help.shipstation.com/hc/en-us/articles/360026158671-ShipStation-Product-Glossary)
- Multi-package shipments: one shipment, many boxes, each with its own label and tracking number, tied to a master tracking number. Not all carriers support it. [ShipStation glossary](https://help.shipstation.com/hc/en-us/articles/360026158671-ShipStation-Product-Glossary)
- Customs: CN22 and CN23 forms, HS and HTS codes, commercial invoices, EORI and ITN. [ShipStation glossary](https://help.shipstation.com/hc/en-us/articles/360026158671-ShipStation-Product-Glossary)
- End of Day manifest (USPS calls it a SCAN form), pick lists, and a "Verify and Print" barcode scan step. [ShipStation glossary](https://help.shipstation.com/hc/en-us/articles/360026158671-ShipStation-Product-Glossary)
- LTL freight is now built in. 50+ LTL carriers (ABF, FedEx Freight, Old Dominion, R+L, Saia, XPO and more). Live quotes on one screen. BOL, packing lists, pallet labels made at booking. Density calculations. Milestone tracking. You can connect a Worldwide Express or Unishippers account for your own rates. [shipstation.com LTL](https://www.shipstation.com/fulfillment/shipping/ltl-freight/)

Receiving: none to speak of. ShipStation is an outbound tool.

Worth copying for Ronchi: the "orders to ship" queue, the multi-package idea (one shipment with many boxes, each with its own tracking number), the RMA number on returns, the pick list, and the freight document set (BOL, packing list, pallet label).

### Shippo

What it does:

- API Starter plan: 30 labels a month free, then 7 cents a label. [goshippo.com/pricing/api](https://goshippo.com/pricing/api)
- Separate API fees: tracking 2 cents per track, rate quotes 1 cent each, US address check 2 cents, non-US address check 8 cents, insurance 1.25% (US) or 1.5% (international) of value. [goshippo.com/pricing/api](https://goshippo.com/pricing/api)
- Batch labels for hundreds of orders at once, tracking across 1,000+ carriers with webhooks, branded tracking pages and notifications, return labels, customs forms and commercial invoices, address validation. [goshippo.com/llm-info](https://goshippo.com/llm-info)
- Shippo says it is for parcels, not full truckload or ocean freight. [goshippo.com/llm-info](https://goshippo.com/llm-info)
- The pricing page does not say clearly whether you can use your own UPS or FedEx account. [goshippo.com/pricing/api](https://goshippo.com/pricing/api)

Receiving: none.

### EasyPost

What it does:

- "Wallet Carriers" plan: free for the first 3,000 labels a month, then 8 cents a label, using EasyPost's discounted rates. [EasyPost plans](https://support.easypost.com/hc/en-us/articles/39984592062605-EasyPost-Wallet-and-Bring-Your-Own-Carrier-Account-Plans)
- "Bring Your Own Carrier Account" plan: $20 a month plus 8 cents a label, 100+ carriers, billed by your carrier directly. [EasyPost plans](https://support.easypost.com/hc/en-us/articles/39984592062605-EasyPost-Wallet-and-Bring-Your-Own-Carrier-Account-Plans)
- Trackers: made automatically when you buy a label, or on their own from just a tracking number. Updates come in by webhook. Each tracker has a public tracking page link (`public_url`). The page does not state the tracker fee. [EasyPost Tracker docs](https://docs.easypost.com/docs/trackers)
- Batches, SCAN forms (manifests) and shipments are separate API objects. [EasyPost Batch](https://docs.easypost.com/docs/batches), [EasyPost ScanForm](https://docs.easypost.com/docs/scan-form)
- Zoho Inventory routes FedEx and many smaller carriers through EasyPost, which shows how common it is as the "plumbing" under other tools. [Zoho shipping integrations](https://www.zoho.com/us/inventory/help/shipping-carriers/shipping-us.html)

Receiving: none.

Note for Ronchi: EasyPost's free tier (3,000 labels a month) is far above Ronchi's parcel volume. If Aaron ever wants labels inside the portal, EasyPost is likely the cheapest path. It still needs an EasyPost account and an API key stored as a Worker secret.

### FedEx Ship Manager and FedEx APIs (carrier's own tool)

- FedEx Ship Manager at fedex.com: address book (personal or shared, CSV import), saved shipment profiles, batch shipping, email tracking notices, commercial and pro forma invoices, commodity profiles, electronic trade documents. Over 150 lb counts as freight. LTL goes through FedEx Freight, a separate company. [FedEx Ship Manager](https://www.fedex.com/en-us/shipping/ship-manager/online.html)
- FedEx says its APIs, docs and sample code are free to developers, under terms of use. Some APIs need a "Label Certification" before going live. [FedEx developer FAQ](https://developer.fedex.com/api/en-us/integration/faq.html)
- FedEx Freight LTL API: account-specific rate quotes and transit times, create and cancel LTL shipments, a label per handling unit, and pickup requests. [FedEx Freight LTL API](https://developer.fedex.com/api/en-us/catalog/ltl-freight.html)

### UPS WorldShip and UPS APIs (carrier's own tool)

- WorldShip is Windows-only desktop software (Windows 10 and 11). Batch and automatic import and export of shipments, negotiated or published rates, return labels, international shipments, air freight. [WorldShip support](https://www.ups.com/us/en/business-solutions/business-shipping-tools/worldship/worldship-support)
- UPS lists Tracking, Rating and Shipping APIs on its developer portal and says to request access keys there. [UPS Developer Resource Center](https://www.ups.com/pl/en/business-solutions/expand-your-online-business/upgrade-digital-technology/developer-resource-center)
- Getting UPS API access through OAuth needs a UPS.com login linked to a UPS account number. [AfterShip's UPS guide](https://support.aftership.com/en/shipping/article/ups-developer-guide-api-credentials-1orsuot) (third party, but it walks the UPS steps)
- I could not find a UPS page that states a per-call fee. Treat the UPS API as "needs a UPS account" and confirm cost with UPS.

Worth copying from carrier tools: the shared address book, saved "shipment profiles" (for example "Change parts box, UPS Ground, signature required"), and commodity profiles for customs (for example "Bottle filling machine, HS code ...").

---

## 2. LTL freight tools

### Freightview

- Quote parcel, LTL, truckload and spot shipments from one screen. [Freightview why](https://www.freightview.com/why-freightview)
- Automatic bill of lading on every shipment, with your logo. Automatic labels. Pickup scheduling with the carrier. NMFC code search and a density-based freight class calculator. Carrier documents to download, or upload your own. Shipments shared with customers for updates. [Freightview LTL and parcel](https://WWW.FREIGHTVIEW.COM/ltl-parcel)
- Notification Center for quotes, pickups, deliveries and billing. Invoice and BOL matching. Discrepancy management. [Freightview why](https://www.freightview.com/why-freightview)
- Price: $149 a month for 0 to 50 shipments. Larger tiers by quote. 14-day free trial. [Freightview pricing](https://www.freightview.com/pricing)

Worth copying: the BOL template with Ronchi's logo, the freight class helper (density = weight divided by cubic feet), pickup details on the record, and a place to upload the carrier's signed BOL and delivery receipt.

---

## 3. Inventory and ERP tools (shipping and receiving together)

### Fishbowl (Fishbowl Advanced)

- Receiving is tied to purchase orders. Scan an item and enter the quantity received. The app shows the warehouse section, aisle, shelf and bin. [Fishbowl receive goods](https://www.fishbowlinventory.com/features/receive-goods)
- "Reconcile" clears differences between what was ordered and what came in (extra or missing units, price changes) and adds landed costs. [Fishbowl receive goods](https://www.fishbowlinventory.com/features/receive-goods), [Fishbowl receiving module](https://www.fishbowlinventory.com/blog/regarding-the-receiving-module)
- Each receiving line can be held, received, reconciled, fulfilled or voided. [Fishbowl receiving module](https://www.fishbowlinventory.com/blog/regarding-the-receiving-module)
- Shipping module: pack button, cartons with description, quantity and weight, a tracking number per carton, batch shipment, search by status. Rate quote and return options there need UPS. [Fishbowl shipping module](https://www.fishbowlinventory.com/blog/navigating-the-shipping-module)
- Mobile app on Android and Apple. [Fishbowl receive goods](https://www.fishbowlinventory.com/features/receive-goods)

Worth copying: the line status idea (held, received, reconciled, voided), the "carton list with weight and tracking number per carton", and bin location shown at receiving time.

### Zoho Inventory

- Purchase receive: open the PO, click Receive, enter the quantity for each item, and choose a bin. Save as "In Transit" if it is on the way, or "Received" once it is here. [Zoho purchase receives](https://www.zoho.com/us/inventory/help/purchase-orders/purchase-receive.html), [Zoho bin locations](https://www.zoho.com/uk/inventory/help/bin-locations)
- Serial and batch numbers can be added at receiving. A receive can be turned into a bill. [Zoho purchase receives](https://www.zoho.com/us/inventory/help/purchase-orders/purchase-receive.html)
- Outbound: Packages, then "Ship via Carrier". UPS and USPS are built in. FedEx and others go through EasyPost. Every carrier needs your own account. [Zoho shipping integrations](https://www.zoho.com/us/inventory/help/shipping-carriers/shipping-us.html)
- Live tracking works through AfterShip, another outside service. [Zoho real-time tracking](https://www.zoho.com/us/inventory/kb/package/ship-tracking.html)

Worth copying: the "In Transit" status on an inbound receive. That fits Italy shipments perfectly. Also the Sales order, then Package, then Shipment flow.

### Odoo Inventory

- Three-step receiving: Input, then Quality Control, then Stock. Goods cannot be used until they reach Stock. [Odoo three-step receipts](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/receipts_three_steps.html)
- Odoo's docs cover putaway rules, storage categories, dropshipping, multi-package shipments, printing shipping labels, batch, cluster and wave picking. Carrier connectors exist for UPS, FedEx, USPS, DHL, EasyPost and others. [Odoo third-party shipping carriers (menu)](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/shipping_receiving/setup_configuration/third_party_shipper.html)
- Odoo carrier connectors need credentials from each carrier (for example UPS). [Odoo UPS credentials](https://www.odoo.com/documentation/user/14.0/inventory/shipping/setup/ups_credentials.html)
- Partial receipts create a "backorder" for the rest. This is well known Odoo behavior; the docs page for it ([Odoo 13 partial receipts](https://www.odoo.com/documentation/13.0/applications/inventory_and_mrp/purchase/purchases/rfq/reception.html)) could not be fetched during this research.

Worth copying: the quality hold. For Ronchi, "Quality hold" is a status on a received item. Nothing on hold can be issued to a job or shipped until someone clears it.

### NetSuite

- Inbound Shipment record: shipment number, the shipper's reference, status, expected and actual ship and delivery dates, vessel number, bill of lading number, PO lines (one PO can be split across shipments), landed costs (duty, freight) spread by quantity, value or weight, plus attached files and notes. [NetSuite Inbound Shipment Management](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1490823161.html)
- Advanced Receiving keeps receiving separate from billing. You can receive part of a PO. Status shows "Partially Received" and each line shows "Remaining Quantity". Overages need a setting. [NetSuite Advanced Receiving](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2412119.html)

Worth copying: the Inbound Shipment record is the best model for "machine coming from Italy". Container or vessel, BOL, expected date, which PO lines are on it, customs and freight costs, and the documents.

### Katana

- "Receive some..." lets you receive part of a PO. Each item starts at its full expected quantity; you change what actually came. [Katana partial receive](https://support.katanamrp.com/en/articles/5944993-how-to-partially-receive-a-purchase-order-po)
- Three delivery statuses: Expected, Partially received, Done. [Katana partial receive](https://support.katanamrp.com/en/articles/5944993-how-to-partially-receive-a-purchase-order-po)

Worth copying: the simple three-status model and the "start at full quantity, change what differs" screen. That is the fastest receiving screen for one person.

### Cin7 Core

- Receive with a PO or without one. Scan or type the item. "Receive all" or "Receive partially". Items not yet shelved wait in a put-away list. Put-away: scan item, scan bin, "Place all". [Cin7 receive and put away](https://help.core.cin7.com/hc/en-us/articles/10664584489103-Receive-and-put-away-stock-with-WMS)
- The system checks quantities and SKUs against the PO. [Cin7 receive and put away](https://help.core.cin7.com/hc/en-us/articles/10664584489103-Receive-and-put-away-stock-with-WMS)

Worth copying: "Receive without a PO". Ronchi needs it for customer sample bottles and caps, and for surprise deliveries.

### Sortly

- Up to 8 photos per item, added from the phone app or desktop. Photos show condition over time. [Sortly photos](https://www.sortly.com/features/photos/)
- QR and barcode labels you print yourself and scan with a phone. Custom fields, folders, tags, low stock and date alerts, pick lists, purchase orders. [Sortly features](https://www.sortly.com/features/)
- Sortly's features page does not mention receiving. [Sortly features](https://www.sortly.com/features/)

Worth copying: photo-first records and printable QR labels. A QR label on a received crate or sample box that opens the portal record is cheap and needs no outside service.

---

## 4. Feature by feature: who has it, and does the portal need an outside service?

"No" means the portal can do it alone with Workers, D1 and R2 (or whatever file storage the portal already uses).

### Shipping (outbound)

| Feature | Seen in | Outside service needed? |
|---|---|---|
| Queue of orders to ship (from change-part orders, parts orders, jobs) | ShipStation, Fishbowl, Zoho | No |
| Packing slip / packing list (printable page or PDF) | ShipStation, Freightview, Fishbowl | No |
| Multi-package shipment (many boxes or crates, each with weight, size, tracking number) | ShipStation, Odoo, Fishbowl | No, for the record. Yes, if the portal prints the labels |
| Dimensions and weights per box | Fishbowl, ShipStation, Zoho | No |
| Freight class helper (density from weight and size) | Freightview | No (it is math). The NMFC code lookup itself is a paid NMFTA product |
| Bill of lading (printable, with Ronchi logo) | Freightview, ShipStation LTL | No, if the portal fills its own BOL form. Yes, if the carrier must issue an electronic BOL with a PRO number |
| Saved shipment profiles and address book | FedEx Ship Manager | No (the portal already has customers) |
| Customs documents (commercial invoice, HS codes) | ShipStation, FedEx, Shippo | No, for a printable commercial invoice. Yes, for filing electronically with the carrier |
| Carrier label printing | All parcel tools | Yes: UPS or FedEx developer account plus a shipping account, or an aggregator (EasyPost free to 3,000 labels a month, then 8 cents; Shippo 30 free, then 7 cents) |
| Rate shopping (live prices) | ShipStation, Shippo, EasyPost, Freightview | Yes: carrier API or aggregator. Shippo charges 1 cent per rate call |
| Batch labels and end-of-day manifest | ShipStation, EasyPost | Yes (only matters with real labels) |
| Tracking LINK to carrier page | All | No |
| Live tracking STATUS inside the portal | All | Yes: carrier API or aggregator (Shippo 2 cents per track) |
| Email to customer "your order shipped" with link | ShipStation, Shippo, FedEx | No extra service, if the portal already sends email. If it does not, it needs an email sender (for example Cloudflare Email Service) |
| Branded tracking page (Ronchi-styled page showing the shipment) | ShipStation Standard, Shippo | No, if it shows the portal's own status plus the carrier link. Yes, if it must show live carrier scans |
| Returns / RMA number and return record | ShipStation, Odoo | No |
| Prepaid return label emailed to the customer | ShipStation, Shippo | Yes (it is a carrier label) |
| Pickup request to carrier | Freightview, FedEx Freight API | Yes for automatic. No for a manual "pickup booked, confirmation #, date" field |

### Receiving (inbound)

| Feature | Seen in | Outside service needed? |
|---|---|---|
| Expected deliveries list (what is coming, when) | NetSuite, Zoho, Katana | No |
| Inbound shipment record (Italy: vessel or flight, BOL or AWB, container, ETA, customs broker, docs) | NetSuite | No |
| Receive against a PO, change only what differs | Katana, NetSuite, Cin7 | No |
| Partial receipts, remaining quantity, auto "backorder" | NetSuite, Katana, Odoo | No |
| Receive without a PO (samples, surprises) | Cin7 | No |
| Damage and discrepancy notes per line | Fishbowl (reconcile), Freightview | No |
| Photos of the delivery, crate, damage, packing slip | Sortly | No (uses the portal's file upload) |
| Put-away and bin location | Fishbowl, Zoho, Cin7, Odoo | No |
| Quality hold before use | Odoo three-step | No |
| Landed cost (freight, duty, broker fees added to the part cost) | NetSuite, Fishbowl | No |
| QR or barcode label for a received item | Sortly, Fishbowl, Cin7 | No (QR can be drawn in the browser). Scanning works with a phone camera |
| Inbound tracking link | Zoho, NetSuite | No for a link. Yes for live status |
| Ocean container live tracking | none of the above built in | Yes, a paid container-tracking service. A link to the shipping line's site is free |

---

## 5. Public tracking link patterns

Replace `{n}` with the tracking or PRO number. Carriers do not publish these as official, stable formats. They are the patterns in common use. They can change without notice. I could not open the carrier sites from the research machine to test them (the network blocked carrier sites), so test each one once in a browser before relying on it. Best practice: keep these patterns in a small table that Aaron can edit in the command center, so a broken link is a one-line fix and not a code change.

| Carrier | Pattern | Source |
|---|---|---|
| UPS | `https://www.ups.com/track?loc=en_US&tracknum={n}` | Reported working in [this Drupal issue](https://www.drupal.org/node/3113863). Older form `https://wwwapps.ups.com/WebTracking/track?track=yes&trackNums={n}` from the open [tracking_number_data](https://npmjs.com/package/tracking_number_data) list |
| FedEx | `https://www.fedex.com/fedextrack/?trknbr={n}` (common). Older form `https://www.fedex.com/apps/fedextrack/?tracknumbers={n}` | Older form from [tracking_number_data](https://npmjs.com/package/tracking_number_data). FedEx's own [tracking page](https://www.fedex.com/en-lc/tracking.html) does not document a parameter |
| USPS | `https://tools.usps.com/go/TrackConfirmAction?tLabels={n}` | [tracking_number_data](https://npmjs.com/package/tracking_number_data); USPS's own [tracking page](https://tools.usps.com/go/TrackAction) |
| DHL Express | `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}` (common). Older form `http://www.dhl.com/en/express/tracking.html?brand=DHL&AWB={n}` | Older form from [tracking_number_data](https://npmjs.com/package/tracking_number_data). DHL's [global tracking page](https://www.dhl.com/global-en/home/tracking.html) |

### LTL carriers (PRO numbers)

| Carrier | Public PRO tracking without login? | Prefilled link? |
|---|---|---|
| Saia | Yes, [saia.com/track](https://www.saia.com/track) | Probably. Search engines index pages shaped like `https://www.saia.com/track/details;pro={n}` (seen in [search results](https://www.saia.com/track/details;?pro=104953443801)). Not documented. Test it |
| Old Dominion | Yes, up to 25 numbers, at [odfl.com trace page](https://www.odfl.com/us/en/tools/trace-track-ltl-freight.html). Advanced search (BOL, PO) needs login. [ODFL trace](https://www.odfl.com/Trace/standard.faces) | No documented URL parameter. Link to the page and show the PRO with a copy button |
| Estes | Yes, standard tracking by PRO. Documents and extra detail need login. [Estes enhanced tracking](https://www.estes-express.com/resources/enhanced-tracking) | No documented URL parameter |
| R+L Carriers | Yes, "Shipment Tracing" box on most pages and a tool at [rlcarriers.com shipment tracing](https://www.rlcarriers.com/freight/shipping/shipment-tracing). [R+L FAQ](https://rlcarriers.com/freight/shipping/frequently-asked-questions) | No documented URL parameter |
| XPO | PRO search at ltl.xpo.com. XPO's help page describes it after login. [XPO help](https://www.xpo.com/help-center/how-track-ltl-shipment/) | No documented URL parameter |

Simple rule for the portal: if a carrier has a pattern, open the prefilled link. If not, open the carrier's tracking page and copy the PRO number to the clipboard in the same click.

Ocean and air from Italy: the same idea works. Save the shipping line or airline and the container or air waybill number. Link to the line's public tracking page. No outside account.

---

## 6. Costs of outside services (from vendor pricing pages)

| Service | Cost |
|---|---|
| EasyPost Wallet Carriers | Free for 3,000 labels a month, then $0.08 per label. [EasyPost plans](https://support.easypost.com/hc/en-us/articles/39984592062605-EasyPost-Wallet-and-Bring-Your-Own-Carrier-Account-Plans) |
| EasyPost with your own UPS/FedEx account | $20 a month plus $0.08 per label. [EasyPost plans](https://support.easypost.com/hc/en-us/articles/39984592062605-EasyPost-Wallet-and-Bring-Your-Own-Carrier-Account-Plans) |
| Shippo API Starter | 30 labels a month free, then $0.07. Tracking $0.02 per track, rates $0.01 per call. [Shippo API pricing](https://goshippo.com/pricing/api) |
| ShipStation | From $14.99 a month (50 shipments, 3 users, no API, no branded tracking). Standard from $29.99. [ShipStation pricing](https://www.shipstation.com/pricing/) |
| Freightview | $149 a month for up to 50 shipments. [Freightview pricing](https://www.freightview.com/pricing) |
| FedEx APIs | Free to developers under terms of use. Needs a FedEx account to ship. [FedEx FAQ](https://developer.fedex.com/api/en-us/integration/faq.html) |
| UPS APIs | Needs a UPS account linked to a UPS.com login. No fee found on UPS pages. Confirm with UPS. |

---

## 7. Ranked recommendation

### Build now without outside services

In order of value to Ronchi:

1. **Shipments record with many packages.** One shipment linked to a change-part order, parts order, job, RMA or sample. Each package or crate has weight, length, width, height, carrier, tracking or PRO number. (ShipStation multi-package, Fishbowl cartons.)
2. **Ship queue.** "Ready to ship" list pulled from change-part orders, parts orders and jobs. Statuses: To pack, Packed, Picked up, In transit, Delivered. Olivia updates by hand.
3. **Tracking links.** Carrier plus number builds the link from an editable table. Copy button for LTL PROs with no prefilled link.
4. **Printable packing slip and bill of lading** with Ronchi logo, from the shipment record. Freight class helper from weight and size.
5. **Inbound shipments (Italy).** Mode (ocean, air, truck), vessel or flight, container, BOL or air waybill, customs broker, ETA, actual arrival, attached documents, and which PO lines are on it. Status "In transit" until received. (NetSuite, Zoho.)
6. **Receiving screen.** Receive against a PO or inbound shipment. Quantities start full; change only what differs. Partial receipts keep a remaining quantity. Statuses: Expected, Partially received, Received. Also "Receive without PO" for samples and surprises. (Katana, Cin7, NetSuite.)
7. **Damage and discrepancy notes with photos** on every receipt line, from a phone. (Fishbowl reconcile, Sortly photos.)
8. **Quality hold.** A received item can be put on hold. It cannot be issued or shipped until cleared. (Odoo.)
9. **Bin location and put-away** on received parts. (Zoho, Cin7, Fishbowl.)
10. **RMA returns.** RMA number, reason, link to the customer, machine and original order, expected return, receive it, inspect, decide (repair, replace, credit). (ShipStation RMA, Odoo returns.)
11. **Customer sample intake.** A special receipt for bottles and caps sent in for change-part testing. Link to the customer and the change-part order. Photos. Where they are stored. Return or dispose by date.
12. **QR labels** printed from the portal for received crates and sample boxes. Scanning with a phone opens the record. (Sortly.)
13. **Landed cost fields** on inbound shipments: freight, duty, broker fee, spread over the parts. (NetSuite, Fishbowl.)
14. **Customer "shipped" email** with the tracking link, if the portal already sends email. Plus a simple Ronchi-branded shipment page that shows the portal's own status and the carrier link.
15. **Commercial invoice printout** for exports (HS code, value, country of origin), as a printable form.
16. **On/off switch** for the whole Shipping and receiving section in the owner-only command center, and an editable carrier link table there.

### Build later if Aaron opens a carrier or aggregator account

1. **Print UPS/FedEx parcel labels from the portal.** Cheapest path: EasyPost (free up to 3,000 labels a month on their rates, or $20 a month with Ronchi's own UPS/FedEx accounts). Direct UPS and FedEx APIs are also possible but need two integrations and FedEx label certification.
2. **Live tracking status** shown in the portal and auto-updating ("Delivered" flips on its own). Via EasyPost trackers or Shippo at 2 cents per track.
3. **Rate shopping** for parcels.
4. **Prepaid return labels** for RMAs.
5. **LTL quotes, booking and electronic BOL.** Only if freight volume justifies Freightview ($149 a month) or ShipStation LTL. Otherwise keep booking by phone or carrier website and log it in the portal.

### Skip

1. Batch label printing, end-of-day manifests, SCAN forms, wave or cluster picking. Built for high-volume e-commerce. Ronchi ships a few things a day.
2. Hosted customer returns portal where customers make their own labels. Ronchi's returns need a conversation first.
3. Ocean container live tracking services. A link to the shipping line is enough.
4. Address validation services. Customers are known and stored already.
5. Buying ShipStation, Shippo, Fishbowl, Zoho or Odoo as a separate product. Each would duplicate the customers, orders and jobs already in the portal.

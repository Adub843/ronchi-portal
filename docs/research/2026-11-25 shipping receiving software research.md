# Shipping & Receiving: market research and feature list to clone

- Date: 2026-11-25
- For: Ronchi America staff portal (Cloudflare Workers + D1 + React), new "Shipping & receiving" module linked to parts sales orders
- Use case: small/mid industrial parts warehouse. Inbound = machines and parts from Italy (international freight, customs broker). Outbound = spare parts and change parts to US factories (parcel + LTL).
- Method: web search (G2, Capterra, Software Advice, vendor docs and feature pages). Ratings are snapshots on the date above and differ between review pages; treat them as approximate.

---

## 1. Ranking for this use case

Ranking weighs: receive-against-PO with partials, ship-from-sales-order with partials/backorders, bins, mobile scanning, LTL + parcel, and international inbound. Pure ecommerce/3PL tools score low because they assume DTC parcel orders, not B2B parts and freight.

| # | Product | Why it ranks here | Reputation evidence |
|---|---|---|---|
| 1 | **Odoo Inventory** (+ Barcode app) | The closest model of what we need: receipts and deliveries as documents tied to PO/SO, automatic backorders on partial receipt or short shipment, putaway rules that suggest a bin, phone-scanner app (GS1/EAN). | G2 about 4.4-4.5/5 (63-65 reviews). Odoo docs: barcode receipts/deliveries; partial PO line creates a backorder for the balance (Cleverence guide). |
| 2 | **Fishbowl** | Built for manufacturers and distributors on QuickBooks: Receiving module separate from Purchasing, pick/pack/ship, bins, batch receipt import. Manufacturing is a top reviewer segment. | G2 about 4.0/5 (274 reviews). Cons cited: licence cost, limited customization. |
| 3 | **inFlow Inventory** | Best small-team usability: scan to receive, pick lists, pick/pack/ship, partial shipments, locations and sublocations, stock counts, customs info, carrier rate compare, custom barcode/QR labels. | G2 about 4.4/5; reviewers rate it easier to set up than Odoo. Feature list from inflowinventory.com/features. |
| 4 | **NetSuite WMS** | The enterprise reference: Inbound Shipment Management (ASN-like shipments grouping many POs), Advanced Receiving, mobile receiving, bins, landed cost. Too heavy and costly for a small team, but its inbound model is the one to copy for container/air shipments from Italy. | SelectHub 78% satisfaction (aggregated). Oracle docs: receive inbound shipment orders on mobile. |
| 5 | **ShipStation** | Best-known outbound shipping tool; freight is now native: LTL quote, book, BOL and pallet labels, track, invoice reconciliation, beside parcel. US domestic LTL only. | G2 4.3/5 (581 reviews), 90% small business. Customer story: BOLs and pallet labels generated in-app. |
| 6 | **Freightview** | Best-reviewed LTL-only tool: compare your negotiated LTL rates in one place, BOL, documents, tracking. Good model for our LTL screen. | Capterra 4.7/5 (743 reviews); G2 4.7 (195). From about $149/month. Cons: price for small firms. |
| 7 | **Flexport** (inbound reference) | Not a WMS. Model for the customs side: broker files entry, filing status and release posted to a shared dashboard, documents searchable by PO, HS code or entry number. | Vendor claims only (100% entry review, 99.8% accuracy); not independently verified. |

Also checked, not ranked:
- **Zoho Inventory**: purchase receives with bin assignment, picklists, packages and shipments. Solid and cheap, but bins only on higher plans and cannot be turned on for a warehouse that already has transactions. Good fallback reference.
- **Cin7 Core**: strong landed-cost allocation (freight + duty into COGS). Copy the landed-cost idea LATER.
- **Shippo / EasyPost**: label and rate APIs (G2 about 4.2). These are what we would *call*, not clone. EasyPost has a free developer tier (120k shipments/yr per its own page).
- **ShipBob, ShipHero, Logiwa**: 3PL / DTC ecommerce fulfilment. Wrong fit.
- **Ordoro, Sortly**: Ordoro is ecommerce order/label; Sortly is simple item counting with QR. Sortly's phone-scan counting UX is worth copying for stock counts only.
- **Freightquote (C.H. Robinson)**: broker quoting site; Freightview/ShipStation cover the same need with better reviews.

Bottom line: copy **Odoo's document model** (receipt/delivery tied to PO/SO, backorders, putaway), **inFlow's small-team UX** (phone scan, pick list, partial ship), **NetSuite's inbound shipment** (one container = many POs), **Freightview/ShipStation's LTL screen** (BOL, PRO, pallets), and **Flexport's customs panel** (entry status + documents).

---

## 2. Feature list to clone

Legend: **MUST** = core for a small team, day one. **SHOULD** = next. **LATER** = only once volume justifies it.
API column: **Manual** = works with typed data and our own PDFs. **Free** = public/free data or link only. **Paid API** = needs a carrier or aggregator account (EasyPost, Shippo, ShipStation API, carrier direct).

### 2.1 Inbound receiving

| Feature | Priority | API | Notes |
|---|---|---|---|
| Inbound shipment record (from Ronchi Italy or other supplier): mode (air, ocean, courier, truck), carrier, AWB/BL/container no., ETD, ETA, incoterm | MUST | Manual | NetSuite "inbound shipment" idea: one shipment can carry lines from several POs. |
| Expected lines (ASN): part no., description, qty expected, PO line link | MUST | Manual | Paste or upload the Italian packing list (CSV/PDF) to fill lines. CSV import SHOULD. |
| Receive against PO: scan or pick the shipment, enter qty received per line | MUST | Manual | |
| Partial receipts: balance stays open; automatic backorder line | MUST | Manual | Odoo behaviour. |
| Over/short/wrong-part discrepancy per line with reason code | MUST | Manual | Reasons: short, over, wrong part, damaged, missing paperwork. |
| Damage report with phone photos (crate, label, part) | MUST | Manual | Store in R2; link to line. Needed for freight claims. |
| Put-away to bin: suggested bin (last bin used for that part), confirm by scan | MUST (manual bin) / SHOULD (suggested) | Manual | |
| Customs/broker panel: broker name, entry no., entry date, ISF filed (ocean), duties paid, release status (pending, held, released) | MUST | Manual | Flexport pattern. ISF is due 24 h before ocean departure. |
| Documents on the inbound shipment: commercial invoice, packing list, BL/AWB, entry summary (CBP 7501), arrival notice, delivery order, proof of delivery | MUST | Manual | R2 uploads, typed by doc type. |
| Machine receipts: serial number, crate count, crate dimensions/weight, inspection checklist | SHOULD | Manual | Whole machines from Italy differ from parts. |
| Landed cost: freight + duty + broker fees allocated to lines | LATER | Manual | Cin7/NetSuite pattern; only if finance wants it in the portal. |
| Ocean container / air AWB live tracking | LATER | Paid API (or free link) | MUST have a click-through link (see 2.3); live status needs a paid tracking API. |
| Receiving label print (part no., bin, PO, QR) | SHOULD | Manual | Browser print to label printer (4x6 or 2x1). |

### 2.2 Outbound shipping

| Feature | Priority | API | Notes |
|---|---|---|---|
| Create shipment from a parts sales order (pull customer, ship-to, lines) | MUST | Manual | The required link to sales orders. |
| Partial shipments: ship what is in stock; remaining qty becomes backorder | MUST | Manual | inFlow/Odoo behaviour. |
| Backorder list per customer and per part, with expected date (from inbound ETA) | MUST | Manual | Connects inbound and outbound. |
| Pick list (printable and on phone), sorted by bin | MUST | Manual | |
| Pick confirm by scan (part barcode or bin QR) | SHOULD | Manual | MUST-level for accuracy once bins are labelled. |
| Pack: number of boxes/pallets, each with L x W x H, weight, contents | MUST | Manual | |
| Carrier + service selection (UPS Ground, FedEx 2Day, LTL carrier, customer's own account / collect, will-call pickup) | MUST | Manual | Include "bill to third party / customer account no." field. |
| Tracking number (parcel) or PRO number (LTL) per package or shipment | MUST | Manual | Typed or scanned from the label. |
| Packing slip PDF (no prices) | MUST | Manual | Generated in the Worker or browser print. |
| Bill of lading PDF for LTL: shipper, consignee, freight class, NMFC, pieces, pallets, weight, hazmat flag, special instructions, PRO | MUST | Manual | VICS-style straight BOL. Freightview/ShipStation both produce one. |
| Commercial invoice for export (Canada/Mexico customers, returns to Italy) | SHOULD | Manual | |
| Ship confirmation e-mail to customer with tracking link | SHOULD | Free (link) | Send through the portal's mail path; staff click Send. |
| Rate shopping across carriers | LATER | **Paid API** | EasyPost/Shippo/ShipStation API or carrier accounts. |
| Buy and print parcel labels in the portal | LATER | **Paid API** | Until then, labels are made in UPS/FedEx web or ShipStation and the tracking no. pasted in. |
| LTL quote + book + BOL submit to carrier | LATER | **Paid API** | Freightview/ShipStation freight; keep manual BOL until then. |
| Address validation | LATER | **Paid API** | |
| Returns / RMA receipt (customer sends part back) | SHOULD | Manual | Reuses inbound receiving with source = customer. |

### 2.3 Tracking links per carrier

Store these as a **carriers table with a URL template** (`{n}` = tracking/PRO no.) so staff can fix a broken link without a code deploy. Infor and Microsoft Dynamics both use this "configure URL per carrier" approach. Carrier sites change URLs; **verify each template on the live carrier site before go-live** and fall back to the carrier's tracking home page if one breaks.

| Carrier | Number type | URL template (verify) | Confidence |
|---|---|---|---|
| UPS (parcel, UPS Freight now TForce) | 1Z... tracking | `https://www.ups.com/track?tracknum={n}` | High |
| FedEx (Express, Ground, Freight) | 12-15 digits; Freight uses PRO | `https://www.fedex.com/fedextrack/?trknbr={n}` | High |
| USPS | 20-22 digits | `https://tools.usps.com/go/TrackConfirmAction?tLabels={n}` | High (seen in tracking libraries) |
| DHL Express (Italy inbound courier) | 10 digits | `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}` | Medium |
| Old Dominion (LTL) | PRO | `https://www.odfl.com/us/en/tools/trace-track-ltl-freight/trace.html?proNumbers={n}` | Low, verify |
| Estes (LTL) | PRO | `https://www.estes-express.com/myestes/shipment-tracking/?type=PRO&query={n}` | Low, verify |
| Saia (LTL) | PRO | `https://www.saia.com/track/details;pro={n}` | Low, verify |
| XPO (LTL) | 9-digit PRO (mod-7 check digit) | carrier tracking page, PRO entered | Low, verify |
| R+L Carriers (LTL) | PRO | `https://www2.rlcarriers.com/freight/shipping/shipment-tracing?pro={n}` | Low, verify |
| ABF (LTL) | PRO | `https://arcb.com/tools/tracking.html#/{n}` | Low, verify |
| Ocean line (MSC, Maersk, Hapag, etc.) | Container no. / BL | per line, added by staff in the carriers table | Manual |
| Generic fallback | any | `https://www.aftership.com/track/{n}` style aggregator link | Optional |

Also MUST: a tracking-number **format check** (UPS starts "1Z", USPS 20-22 digits, XPO mod-7) to catch typos; open-source tables exist (`tracking_number_data`, `jkeen/tracking_number`).

### 2.4 Inventory, stock counts and bins

| Feature | Priority | API |
|---|---|---|
| Parts master link (use the portal's existing parts/catalog) | MUST | Manual |
| Locations: warehouse > zone/aisle > bin; bin QR labels | MUST | Manual |
| On-hand qty per part per bin; moves on receive, put-away, pick, ship | MUST | Manual |
| Stock movements ledger (every +/- with source doc) | MUST | Manual |
| Bin-to-bin transfer | SHOULD | Manual |
| Cycle count / full count by bin on phone, variance approval before adjust | SHOULD | Manual |
| Reorder point / min qty alert for fast-moving spares | LATER | Manual |
| Serial and lot tracking (machines, wear parts) | SHOULD (serial for machines) / LATER (lots) | Manual |
| Reserved qty (allocated to open sales orders) vs available | SHOULD | Manual |

### 2.5 Barcode / QR scanning from a phone

| Feature | Priority | API |
|---|---|---|
| Camera scan in browser (Barcode Detection API where supported, ZXing/`html5-qrcode` fallback for iOS Safari) | MUST | Free (open source) |
| Scan targets: shipment QR, PO no., part no. (Code 128), bin QR, tracking no. | MUST | Free |
| Print our own Code 128 / QR labels for parts and bins | MUST | Free |
| Bluetooth/USB keyboard-wedge scanner support (just a focused input) | SHOULD | Free |
| GS1-128 parsing of supplier labels | LATER | Free |

### 2.6 Dashboards

| Tile / list | Priority |
|---|---|
| Inbound due today / this week (by ETA) | MUST |
| Inbound late (ETA passed, not received) | MUST |
| In transit inbound (with customs status: held / released) | MUST |
| Received this week (with discrepancy count) | MUST |
| Outbound to ship today (SO promised date) | MUST |
| Outbound late (promised date passed) | MUST |
| Shipped this week; in transit outbound | MUST |
| Open backorders by customer and part | MUST |
| Open discrepancies / damage claims | SHOULD |
| Carrier on-time and freight spend per month | LATER |

### 2.7 Notifications

| Event | Priority | Channel |
|---|---|---|
| Inbound arriving tomorrow / today | SHOULD | In-portal + e-mail to warehouse |
| Customs hold | MUST | In-portal + e-mail to logistics lead |
| Discrepancy or damage logged | MUST | In-portal to purchasing/sales owner |
| Backordered part received (ready to ship SO X) | MUST | In-portal to sales rep |
| Shipment shipped (customer e-mail with tracking link) | SHOULD | E-mail, staff-approved send |
| Late shipment (promised date passed) | SHOULD | Daily digest |

### 2.8 Documents

MUST: R2 file store per shipment (inbound and outbound) with doc type, uploaded by, date; generated PDFs for packing slip, pick list and BOL; photos from phone camera. SHOULD: commercial invoice, receiving label, ship confirmation. LATER: carrier-generated labels (paid API), proof-of-delivery auto-fetch.

### 2.9 Audit

MUST: append-only event log for every status change, qty change, stock move, document upload/delete and edit (who, when, before, after). Stock is never edited directly, only through a movement row. SHOULD: per-shipment timeline view built from the log. LATER: export for auditors.

---

## 3. What needs a paid carrier API vs manual

| Capability | Manual possible? | Paid API needed for |
|---|---|---|
| Record carrier, service, tracking/PRO | Yes | - |
| Tracking link | Yes (URL template) | Live status inside the portal, delivery events, auto "delivered" |
| Packing slip, pick list, BOL PDF | Yes | - |
| Parcel label | Make it in UPS/FedEx web or ShipStation, paste tracking no. | Print labels from the portal |
| Rate shopping | Check carrier sites by hand | Side-by-side rates (EasyPost, Shippo, ShipStation, Freightview) |
| LTL booking | Phone/web booking with carrier, enter PRO | Book + dispatch from portal |
| Address validation | - | Yes |
| Customs status | Typed from broker e-mails | Broker/forwarder API (e.g. Flexport) |
| Container/AWB live tracking | Link to carrier site | Container tracking APIs |

Recommendation: ship v1 fully manual (no paid accounts, no keys); design the `shipment_packages` and `carriers` tables so a label/rate API can fill the same fields later.

---

## 4. Suggested minimal data model (D1 / SQLite)

All tables get `id INTEGER PRIMARY KEY`, `created_at`, `created_by`, `updated_at`. Money in cents, weights in lb, dimensions in in.

**carriers**: `code` (UPS, FEDEX, USPS, DHL, ODFL...), `name`, `mode` (parcel, ltl, ocean, air, courier), `tracking_url_template`, `active`.

**locations**: `code` (e.g. `A-03-2`), `warehouse`, `zone`, `kind` (bin, staging, receiving_dock, shipping_dock, quarantine), `active`.

**stock_levels**: `part_id`, `location_id`, `qty_on_hand`, `qty_reserved`. UNIQUE(part_id, location_id). Derived from movements, kept as a cache.

**stock_movements**: `part_id`, `from_location_id`, `to_location_id`, `qty`, `reason` (receive, putaway, pick, ship, adjust, transfer, count), `source_type` (inbound_line, outbound_line, count), `source_id`, `serial_no`.

**purchase_orders** / **purchase_order_lines** (if not already in the portal): `po_no`, `supplier`, `status`; lines `part_id`, `qty_ordered`, `qty_received`.

**inbound_shipments**: `ref_no` (IN-2026-0001), `supplier`, `mode`, `carrier_id`, `tracking_no` (AWB/BL/container), `incoterm`, `etd`, `eta`, `arrived_at`, `status`, `broker_name`, `entry_no`, `isf_filed_at`, `customs_status` (n/a, pending, held, released), `released_at`, `notes`.

**inbound_lines**: `inbound_shipment_id`, `po_line_id`, `part_id`, `qty_expected`, `qty_received`, `qty_damaged`, `putaway_location_id`, `serial_no`, `status` (open, partial, received, discrepancy).

**discrepancies**: `source_type` (inbound_line, outbound_shipment), `source_id`, `kind` (short, over, wrong_part, damaged, missing_docs), `qty`, `description`, `status` (open, claim_filed, resolved), `resolved_at`, `resolution`.

**outbound_shipments**: `ref_no` (OUT-2026-0001), `sales_order_id` (required), `ship_to_*` (snapshot), `carrier_id`, `service`, `freight_terms` (prepaid, collect, third_party), `bill_to_account`, `tracking_no` / `pro_no`, `bol_no`, `ship_date`, `promised_date`, `delivered_at`, `status`, `freight_cost_cents`, `notes`.

**outbound_lines**: `outbound_shipment_id`, `sales_order_line_id`, `part_id`, `qty`, `pick_location_id`, `picked_qty`, `serial_no`.

**shipment_packages**: `shipment_type` (inbound, outbound), `shipment_id`, `kind` (box, pallet, crate), `length_in`, `width_in`, `height_in`, `weight_lb`, `freight_class`, `nmfc`, `tracking_no` (per box for multi-box parcel).

**backorders** (or a view): `sales_order_line_id`, `part_id`, `qty_open`, `expected_inbound_line_id`, `expected_date`, `status` (open, allocated, shipped, cancelled).

**documents**: `owner_type` (inbound_shipment, outbound_shipment, discrepancy), `owner_id`, `doc_type` (commercial_invoice, packing_list, bol, awb, entry_summary, arrival_notice, pod, photo, packing_slip, label), `r2_key`, `filename`, `content_type`, `size_bytes`.

**stock_counts** / **stock_count_lines**: count header (`location_scope`, `status`), lines (`part_id`, `location_id`, `qty_system`, `qty_counted`, `approved_by`).

**audit_log**: `entity_type`, `entity_id`, `action`, `before_json`, `after_json`, `user_id`, `at`. Append only.

---

## 5. Status flows

### Inbound shipment

```
draft -> expected -> in_transit -> at_customs -> customs_released -> arrived
      -> receiving -> received            (all lines received)
                   -> received_partial    (some lines open; balance stays expected / backorder)
      -> closed                           (after put-away done and discrepancies resolved)
Side state: customs_held (from at_customs; back to at_customs or customs_released)
Any state before arrived -> cancelled
```

Inbound line: `open -> partial -> received` (or `discrepancy` until resolved) -> `put_away`.

Rules: `received` needs every line qty_received + qty_damaged = qty_expected or a discrepancy row; `closed` needs every received qty in a real bin (not receiving dock).

### Outbound shipment

```
draft (created from sales order)
  -> ready_to_pick   (stock reserved; short lines split to backorder)
  -> picking -> picked
  -> packed          (packages with dims/weight entered)
  -> shipped         (carrier + tracking/PRO entered, ship_date set; stock leaves)
  -> in_transit -> delivered
Side states: on_hold (credit, customer request), exception (carrier problem, damage claim)
Any state before shipped -> cancelled (releases reserved stock)
```

Sales order roll-up: `open -> partially_shipped -> shipped`, driven by sum of shipped qty vs ordered qty per line. Backorder: `open -> allocated (inbound received) -> shipped`.

---

## 6. Build order suggestion

1. Carriers + locations + tracking links, outbound shipment from sales order with manual tracking, packing slip, partial ship + backorders, dashboard tiles. (Fastest value: links the module to sales orders.)
2. Inbound shipments with lines, receive against PO, partials, discrepancies with photos, customs panel, documents.
3. Bins, put-away, pick lists, phone scanning, stock movements ledger.
4. BOL PDF, counts, notifications.
5. LATER: paid carrier API (rates, labels, live tracking), landed cost, LTL booking.

---

## Sources

- G2, Fishbowl vs Odoo Inventory: https://www.g2.com/compare/fishbowl-inventory-fishbowl-vs-odoo-inventory
- G2, Cin7 Core vs inFlow vs Fishbowl: https://www.g2.com/compare/cin7-core-vs-inflow-inventory-vs-fishbowl-inventory
- G2, Odoo Inventory vs Zoho Inventory: https://www.g2.com/compare/odoo-inventory-vs-zoho-inventory
- G2, EasyPost vs ShipStation: https://www.g2.com/compare/easypost-vs-shipstation
- G2, ShipStation vs Shippo: https://www.g2.com/compare/shipstation-vs-shippo-shippo
- inFlow features: https://www.inflowinventory.com/features
- Fishbowl receiving module: https://www.fishbowlinventory.com/blog/regarding-the-receiving-module
- Fishbowl receiving import: https://help.fishbowlinventory.com/advanced/s/importBCReceiving.html
- Odoo barcode receipts and deliveries: https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/barcode/operations/receipts_deliveries.html
- Odoo warehouse features: https://www.odoo.com/page/warehouse-features
- Odoo receiving guide (Cleverence): https://www.cleverence.com/articles/business-blogs/odoo-receiving-4827/
- NetSuite inbound processing: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1541435915.html
- NetSuite receiving inbound shipment orders: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158212308061.html
- NetSuite partial PO receipt: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2411754.html
- NetSuite WMS (SelectHub): https://www.selecthub.com/p/warehouse-management-software/netsuite-wms/
- NetSuite WMS (ERP Research): https://www.erpresearch.com/erp-add-ons/wms/netsuite-wms
- ShipStation freight launch: https://www.shipstation.com/blog/big-news-freight-is-now-native-to-shipstation/
- ShipStation LTL page: https://www.shipstation.com/fulfillment/shipping/ltl-freight/
- ShipStation Magic FX story: https://www.shipstation.com/stories/magic-fx/
- Freightview on Capterra: https://www.capterra.com/p/136895/Freightview/reviews/
- Freightview on G2: https://www.g2.com/products/freightview/reviews
- Freightview on Software Advice: https://www.softwareadvice.com/scm/freightview-profile
- Flexport customs: https://www.flexport.com/solutions/simplify-customs/
- Flexport ISF glossary: https://www.flexport.com/glossary/importer-security-filing/
- Zoho Inventory warehouse management: https://www.zoho.com/ae/inventory/warehouse-inventory-management/
- Zoho bin locations: https://help.zoho.com/portal/en/community/topic/introducing-bin-locations?page=43
- Cin7 Core landed costs: https://help.core.cin7.com/hc/en-us/articles/10553625549711-Landed-costs-for-purchases
- EasyPost comparison (vendor page): https://www.easypost.com/compare/easypost-vs-shippo-vs-shipstation/
- Tracking number data (URL templates, formats): https://npmjs.com/package/tracking_number_data
- Infor, configuring carrier URLs: https://docs.infor.com/rhycomm/2023.x/en-us/rhycb2bolh/rhycommwebug/zin1550846249846.html
- Microsoft, custom tracking links: https://support.microsoft.com/en-gb/topic/custom-link-tracking-numbers-5211b7c8-ad64-04d6-3f5d-9b181167ee26
- XPO PRO format: https://www.trackingmore.com/id/xpoweb-tracking
- Roundups (vendor/affiliate-driven, used only for the candidate list): https://www.softwaretestinghelp.com/best-shipping-and-receiving-software/ , https://worldmetrics.org/best/small-business-distribution-software/

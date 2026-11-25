# Parts orders & sales tracking: market research and feature list

Last updated: 2026-11-25. Scope: what the leading aftermarket and parts order tools do, and what Ronchi America's staff portal (Workers + D1 + React) should copy for a 10-30 person after-sales team that sells spare parts and change parts.

Method: web search plus vendor pages, G2, Capterra, TrustRadius and Gartner Peer Insights. Review counts are snapshots from 2026 pages and change often. Gartner Magic Quadrant text was not reachable, so analyst standing is taken from public vendor pages (IDC MarketScape) and Peer Insights.

---

## 1. Top tools for this use case, ranked

Ranking weighs two things: (a) reputation for OEM aftermarket parts specifically, and (b) how much of what they do fits a small after-sales team that quotes and ships parts. The enterprise planners (1-3) set the bar for aftermarket thinking; the mid-market ERPs and catalog tools (4-7) are the closest match to the screens we will actually build.

| # | Product | Why it ranks | Evidence | Fit for a 10-30 person team |
|---|---|---|---|---|
| 1 | **Syncron** (Service Parts Planning, Price, Warranty) | The aftermarket specialist for equipment OEMs; parts pricing, inventory and warranty in one suite, built for industrial machinery makers | Gartner Peer Insights 4.9 (7 reviews) for Service Supply Chain Solutions; listicles call it strong but costly, best for large OEMs | Too big and expensive to buy; copy its ideas: price intelligence, availability per part, installed-base thinking |
| 2 | **PTC Servigistics** | Most often named the benchmark for service-parts planning (multi-echelon, repair loops) | Peer Insights 4.4 (3 reviews); repeatedly ranked first in service-parts round-ups (gitnux, Lokad review) | Planning engine, not an order desk. Copy: parts classification and stocking signals (LATER) |
| 3 | **IFS Cloud** (service, parts, field service) | One platform for service, parts, repair, warranty, tied to the customer's asset | Leader, IDC MarketScape 2025 for AI-enabled aftermarket/service life-cycle platforms (vendor page); FSM Peer Insights about 4.6-4.7 on 100+ ratings | Copy: everything hangs off the customer's machine (asset/serial) |
| 4 | **Epicor Prophet 21** | The best-known distribution ERP for industrial parts distributors: quotes, orders, backorders, rep commissions | G2 4.0 (206 reviews, Distribution ERP); Capterra 3.8-3.9; TrustRadius 7.9/10. Praise: inventory; complaints: cost, customization | Closest model for the order desk: quote, order, backorder, partial ship, rep reporting |
| 5 | **Acumatica** (Distribution / Sales Order Mgmt) | Clean mid-market order lifecycle with explicit statuses and line-level ship rules | G2 about 4.4 (~2,000 reviews); ease of use 8.4 vs NetSuite 7.5 on G2's comparison | Copy its status set and line-level backorder rule almost directly |
| 6 | **Documoto** | Leading interactive parts catalog + storefront for equipment OEMs; cart and quote request, routed to ERP | Vendor site; used by OEMs such as MacLean Engineering for fleet docs and parts ordering | Copy: buy-by-machine catalog, quote request intake, branded quote templates (customer portal is LATER) |
| 7 | **Odoo Sales** (reference for small teams) | Simple, well-documented quote to order flow: send quote, online acceptance, lock on confirm, pro forma | G2 4.2 (~350 reviews); official docs | Copy: quote states, lock-after-confirm, pro forma button, signature/acceptance record |

Also checked:
- **Salesforce Manufacturing Cloud**: worth copying one idea, comparing planned vs actual run-rate volume per account (Sales Agreements and account forecasting). Asset/installed base lives on the service side. Too heavy to adopt.
- **NetSuite**: strong all-round order management, G2 4.1 on 4,600+ reviews, lower ease-of-use score. Nothing parts-specific it does better than P21 or Acumatica.
- **SAP (S/4HANA Service Parts), Infor**: enterprise; same concepts as Syncron/IFS at higher cost. No public data showed an advantage for a small team.
- **Partium**: parts *search* (photo, label, text, BOM) inside an existing portal, plus an agent inbox that turns inquiries into quotes or orders. Copy the inquiry intake idea, not the search AI.
- **Fishbowl, Zoho Inventory, Katana, Cin7**: inventory and small-business order tools. Fine for stock counts, weak on quotes, installed base and rep reporting. Not ranked.
- **Prodik**: no usable public information found.

---

## 2. Feature list to clone

Legend: **MUST** = core for launch with a 10-30 person team. **SHOULD** = next release. **LATER** = only once the basics are used daily. Wording is ours. "Inspired by" names where the pattern comes from.

### 2.1 Quote to order lifecycle and statuses

| Feature | Priority | Inspired by |
|---|---|---|
| One record that starts as a quote and becomes an order (same number family, quote Q-, order SO-), keeping a link back to the quote | MUST | Odoo, Acumatica |
| Inquiry intake: log a customer request (email text, photos, machine serial) before it is priced; convert to quote | MUST | Partium agent inbox, Documoto quote request |
| Quote statuses: Draft, Sent, Revised, Accepted, Lost, Expired | MUST | Odoo, P21 |
| Quote revisions: "Revise" copies to rev B and keeps rev A read-only | MUST | P21, common practice |
| Quote validity date, auto-flag Expired | MUST | Odoo |
| Lost reason (price, lead time, went elsewhere, project cancelled) required on Lost | MUST | Salesforce opportunity practice |
| Convert accepted quote to order (whole or chosen lines), customer PO number required | MUST | Acumatica, Odoo |
| Order statuses: Open, In Production / Sourcing, Ready to Ship, Partially Shipped (Back Order), Shipped, Invoiced, Closed, Cancelled, On Hold | MUST | Acumatica (Open, Back Order, Completed), P21 |
| Lock the order after confirmation; changes need Unlock with a reason (logged) | MUST | Odoo lock-confirmed-sales |
| On Hold with reason (credit, waiting on drawing approval, waiting on customer sample bottle) | SHOULD | ERP practice; fits change parts |
| Change-part approval step: drawing sent, customer approved drawing (date, who) before production | SHOULD | Ronchi-specific need; format parts are made per bottle/cap |
| Customer online acceptance of quote (link with accept + name) | LATER | Odoo online signature |
| RMA / returns and warranty claims linked to the original order | LATER | IFS, Syncron Warranty |

### 2.2 Pricing, discounts, price lists

| Feature | Priority | Inspired by |
|---|---|---|
| Part master with list price, currency, cost (staff-only), lead time, supplier (Italy factory or local) | MUST | All ERPs |
| Line discount % and order-level discount; margin shown to staff only | MUST | P21, Odoo |
| Customer price list or customer discount tier (e.g. key account 10%) applied automatically | MUST | P21 contract pricing, Odoo pricelists |
| Price source shown on each line (list, customer tier, manual override) and manual overrides logged with reason | MUST | P21 |
| EUR cost to USD price conversion with stored exchange rate per quote | SHOULD | Fits an Italian parent; ERP multi-currency |
| Freight, crating, expedite and handling as separate charge lines | SHOULD | Distribution ERPs |
| Quantity breaks | SHOULD | P21, Acumatica |
| Discount approval threshold (e.g. over 15% needs manager approval) | SHOULD | CPQ practice (Salesforce CPQ) |
| Yearly price update tool (bulk % change with preview and undo) | LATER | Syncron Price (much simpler version) |
| Price intelligence: suggest price from history and demand | LATER | Syncron Price |

### 2.3 Customer and machine linkage (installed base)

| Feature | Priority | Inspired by |
|---|---|---|
| Customers with plants/sites and contacts (buyer, maintenance, AP) | MUST | All |
| Installed base: each machine with serial number, model (unscrambler, filler, capper, labeler), year, site, line | MUST | IFS, Salesforce asset console, Documoto |
| Every quote/order line can point to a machine serial; header defaults to one machine | MUST | IFS, Documoto |
| Machine page: all quotes, orders and parts ever sold for that serial | MUST | IFS, Syncron |
| Change-part sets per machine per format (bottle/cap reference), reorder a set in one click | MUST | Ronchi need; Documoto "buy by machine" |
| Parts list per machine model (BOM / where-used) to pick parts fast | SHOULD | Documoto, Partium BOM search |
| Wear-part reminders by machine age or last purchase (e.g. star wheels, gripper pads) | LATER | Syncron, IFS service life-cycle |
| Customer self-service portal (view orders, request quote by serial) | LATER | Documoto storefront |

### 2.4 Order lines, backorders, partial shipments

| Feature | Priority | Inspired by |
|---|---|---|
| Lines: part, description, qty ordered, qty shipped, qty open, unit price, discount, promised date, machine serial | MUST | Acumatica, P21 |
| Line status: Open, Sourcing/On order from Italy, Ready, Partially Shipped, Shipped, Cancelled | MUST | Acumatica |
| Per-line "backorder allowed" vs "ship complete" rule, default from customer | MUST | Acumatica line ship rules |
| Shipments: one order, many shipments; each shipment has date, carrier, tracking, lines and qtys | MUST | Acumatica, P21 |
| Order status derived from lines (all shipped = Shipped; some = Partially Shipped) | MUST | Acumatica (avoids its known stuck-status issue by computing, not storing) |
| Promised date vs actual ship date on each line (feeds on-time KPI) | MUST | Distribution practice |
| Link line to supplier PO / factory order number in Italy | SHOULD | P21 drop-ship / special order |
| Close short: cancel the rest of a line with reason | SHOULD | Acumatica forum need |
| Stock on hand / reserved per part (simple counts) | LATER | Fishbowl, Zoho, Katana |

### 2.5 Sales pipeline, dashboards and KPIs

| Feature | Priority | Notes |
|---|---|---|
| Open quotes pipeline by status with value and age | MUST | Kanban or table |
| Bookings (value of orders confirmed) by month, customer, rep, product type (spare vs change part) | MUST | Uses order confirm date |
| Revenue (shipped or invoiced value) by month, customer, rep | MUST | Uses shipment/invoice date |
| Open order value (backlog) and open backorder value | MUST | Sum of open line qty x price |
| Quote conversion rate (won / (won + lost)), by count and value, by rep | MUST | Exclude open quotes |
| Average days quote-to-order and order-to-ship | MUST | Medians too; outliers distort averages |
| On-time ship % (shipped on or before promised date) | MUST | Line level |
| Top customers and top parts (12 months) | SHOULD | |
| Lost reasons breakdown | SHOULD | |
| Year-over-year and plan vs actual per account | LATER | Salesforce Sales Agreements idea |
| CSV export of any table | MUST | |

### 2.6 Reminders and follow-ups

| Feature | Priority |
|---|---|
| Follow-up date on each quote; "my follow-ups due today" list | MUST |
| Auto task when a quote has been Sent 7 days with no response (configurable) | MUST |
| Alert before quote expiry | SHOULD |
| Alert when a line passes its promised date unshipped | MUST |
| Notes / activity log per quote, order, customer (calls, emails) | MUST |
| Daily email digest per rep (follow-ups, late lines) | SHOULD |
| Reorder nudge for customers who buy the same wear parts regularly | LATER |

### 2.7 Documents

| Feature | Priority |
|---|---|
| Quote PDF (Ronchi America letterhead, revision, validity, terms, lead times) | MUST |
| Order acknowledgment PDF (confirms PO, lines, promised dates) | MUST |
| Pro forma invoice PDF (for prepayment customers) | SHOULD |
| Packing list per shipment | SHOULD |
| Invoice reference field (number/date from accounting system) rather than creating invoices | MUST |
| Attachments on quote/order/machine (drawings, photos, customer PO PDF) in R2 | MUST |
| Configurable terms text and templates | SHOULD |
| Email the PDF from the portal with a log of what was sent | SHOULD |

### 2.8 Integrations

| Feature | Priority |
|---|---|
| CSV import for parts, customers, machines (first load) | MUST |
| CSV export of orders and lines for accounting | MUST |
| Accounting system sync (QuickBooks / whatever Ronchi America uses) for invoice numbers and paid status | LATER |
| Factory (Ronchi Italy) order reference and lead-time updates | SHOULD (manual field first) |
| Carrier tracking links (UPS/FedEx URL from tracking number) | SHOULD |
| Email-in: forward a customer email to create an inquiry | LATER |
| CRM sync | LATER |

### 2.9 Permissions and audit

| Feature | Priority |
|---|---|
| Roles: Admin, Sales/Parts rep, Manager (approvals, all reps' data), Shipping/Warehouse, Read-only (finance, service techs) | MUST |
| Cost and margin visible only to Manager and Admin | MUST |
| Audit log of every create/update/status change (who, when, before/after JSON) | MUST |
| Reason required on: unlock, manual price override, cancel, close short, Lost | MUST |
| Discount approval workflow over threshold | SHOULD |
| Reps see all customers but "my" filters by default (small team; avoid hiding data) | MUST |
| Soft delete only; cancelled records stay | MUST |

---

## 3. Status flow

```
Inquiry:  New -> Quoted (converted to quote) | Closed (no quote)

Quote:    Draft -> Sent -> Accepted -> (converted to order)
                     |-> Revised (new revision, old rev becomes read-only)
                     |-> Lost (reason required)
                     |-> Expired (auto, after valid_until)

Order:    Open -> In Production/Sourcing -> Ready to Ship
               -> Partially Shipped -> Shipped -> Invoiced -> Closed
          any open state -> On Hold (reason) -> back to previous
          any state before Shipped -> Cancelled (reason)

Line:     Open -> Sourcing -> Ready -> Partially Shipped -> Shipped
          Open/Sourcing/Ready/Partially Shipped -> Cancelled or Closed Short (reason)
```

Rule: order shipping status is computed from its lines (sum qty_shipped vs qty_ordered), never typed. Invoiced/Closed are header-only steps. Keep this as one transition table in code so the API and UI share it.

---

## 4. Suggested minimal data model (D1 / SQLite)

Money as integer cents, dates as ISO text, ids as text (ULID). Reuse existing change-parts tables where they already hold customers or parts.

| Table | Key columns |
|---|---|
| `customers` | id, name, account_no, price_tier_id, ship_rule_default (backorder/ship_complete), payment_terms, rep_user_id, notes, created_at |
| `customer_sites` | id, customer_id, name, address_city, address_state, address_full |
| `contacts` | id, customer_id, site_id, name, role, email, phone |
| `machines` | id, customer_id, site_id, serial_no (unique), model, machine_type, year, line_name, notes |
| `parts` | id, part_no (unique), description, kind (spare/change_part), machine_model, list_price_cents, cost_cents, cost_currency, lead_time_days, supplier, active |
| `change_part_sets` | id, machine_id, format_ref (bottle/cap), drawing_attachment_id, last_order_id |
| `change_part_set_items` | set_id, part_id, qty |
| `price_tiers` | id, name, discount_pct |
| `customer_prices` | customer_id, part_id, price_cents, valid_from, valid_to |
| `inquiries` | id, customer_id, contact_id, machine_id, received_at, channel, description, status, quote_id |
| `quotes` | id, number, revision, parent_quote_id, customer_id, contact_id, machine_id, rep_user_id, status, valid_until, currency, fx_rate, subtotal_cents, discount_cents, freight_cents, total_cents, lost_reason, follow_up_on, sent_at, decided_at, created_at |
| `quote_lines` | id, quote_id, line_no, part_id, description, machine_id, qty, unit_price_cents, price_source, discount_pct, lead_time_days, line_total_cents |
| `orders` | id, number, quote_id, customer_id, site_id, contact_id, rep_user_id, customer_po, status, hold_reason, locked, ship_rule, confirmed_at, promised_date, invoice_ref, invoice_date, total_cents, cancelled_reason |
| `order_lines` | id, order_id, line_no, part_id, machine_id, qty_ordered, qty_shipped, unit_price_cents, discount_pct, promised_date, status, factory_order_ref, close_reason |
| `shipments` | id, order_id, shipped_at, carrier, tracking_no, packing_list_attachment_id |
| `shipment_lines` | shipment_id, order_line_id, qty |
| `tasks` | id, entity_type, entity_id, assignee_user_id, due_on, kind (follow_up/expiry/late_line), done_at, note |
| `activities` | id, entity_type, entity_id, user_id, at, kind (call/email/note/status), body |
| `attachments` | id, entity_type, entity_id, r2_key, filename, content_type, uploaded_by, uploaded_at |
| `documents` | id, entity_type, entity_id, doc_type (quote_pdf/ack/proforma/packing), revision, r2_key, sent_to, sent_at |
| `audit_log` | id, at, user_id, entity_type, entity_id, action, before_json, after_json, reason |
| `users` / `roles` | reuse portal auth; role in (admin, manager, sales, shipping, readonly) |

Useful indexes: orders(status, confirmed_at), orders(customer_id), order_lines(order_id), order_lines(promised_date) where qty_shipped < qty_ordered, quotes(status, follow_up_on), machines(serial_no).

KPI queries come straight from these tables:
- Bookings = sum(orders.total_cents) by month of confirmed_at.
- Revenue = sum(shipment_lines.qty x order_lines net price) by month of shipped_at (or by invoice_date once invoice_ref is set).
- Open order value = sum((qty_ordered - qty_shipped) x net price) on non-cancelled lines.
- Conversion = count(Accepted) / count(Accepted + Lost) over quotes decided in the period (latest revision only).
- Days to ship = shipped_at - confirmed_at per order (first and last shipment).

---

## 5. Recommended build order

1. MUST items in 2.1, 2.3, 2.4 (quote, order, lines, shipments, machines) with audit log.
2. Quote PDF and order acknowledgment.
3. Dashboard with the seven MUST KPIs and follow-up list.
4. SHOULD items, then LATER as usage shows the need.

---

## Sources

- Syncron, Gartner Peer Insights: https://www.gartner.com/reviews/market/supply-chain-planning-solutions/vendor/syncron/product/syncron-service-supply-chain-solutions/likes-dislikes
- PTC vendor page, Gartner Peer Insights: https://www.gartner.com/reviews/vendor/ptc
- IFS vs Servigistics, Peer Insights: https://www.gartner.com/reviews/market/field-service-management/compare/product/ifs-field-service-management-software-vs-servigistics
- IFS, IDC MarketScape 2025 Leader (vendor page): https://www.ifs.com/assets/analyst/idc-service-life-cycle-management-marketscape
- Syncron pricing and inventory: https://www.syncron.com/blog/the-powerful-pairing-of-service-parts-pricing-and-inventory-management
- Lokad, spare parts optimization software review: https://www.lokad.com/spare-parts-optimization-software/
- Service parts round-up (gitnux): https://gitnux.org/best/service-parts-management-software/
- Spare parts software round-up (Growmax): https://www.growmax.io/blog/best-spare-parts-management-software
- Epicor Prophet 21, G2: https://g2.com/products/epicor-prophet-21/reviews ; Capterra: https://www.capterra.com/p/10022775/Epicor-Prophet-21/reviews/ ; TrustRadius: https://www.trustradius.com/products/epicor-prophet-21/reviews/all
- Acumatica vs NetSuite vs Odoo, G2: https://www.g2.com/compare/acumatica-vs-netsuite-vs-odoo-odoo-erp
- Acumatica order statuses and backorders (community): https://community.acumatica.com/everything-else-119/sales-order-status-and-the-meanings-27126 ; datasheet: https://cdn.acumatica.com/media/2017/03/Acumatica_Distribution_Sales-Order-Management_Datasheet_220831.pdf
- Documoto storefront: https://www.documoto.com/sell-parts-online ; MacLean example: https://macleanengineering.com/maclean-documoto/
- Partium aftermarket search and inquiries: https://www.partium.io/solutions/aftermarket ; https://www.partium.io/blog/self-service-spare-parts-ordering
- Odoo quotations, signatures, pro forma: https://www.odoo.com/documentation/18.0/applications/sales/sales/sales_quotations/create_quotations.html ; https://www.odoo.com/documentation/17.0/applications/sales/sales/invoicing/proforma.html
- Salesforce Manufacturing Cloud FAQ: https://salesforce.com/products/manufacturing-cloud/faq/
- G2 order management category: https://learn.g2.com/best-order-management-software

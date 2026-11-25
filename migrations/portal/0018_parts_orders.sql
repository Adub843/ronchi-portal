-- Parts orders: spare parts sales from the customer's first ask to the invoice (routes/parts-orders.ts).
-- Business side only: the help center and the customer parts site never see these tables.
-- Shipments for an order live in the shipping tables (migration 0017); this file doesn't depend on them.
CREATE TABLE parts_orders (
  id              TEXT PRIMARY KEY,
  seq             INTEGER NOT NULL UNIQUE,        -- shown as P-1001, P-1002, ...
  customer        TEXT NOT NULL,
  contact         TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  machine         TEXT,                           -- machine number, e.g. 4222TP; linked to machines by serial
  ship_to         TEXT,
  customer_po     TEXT,
  quote_no        TEXT,
  salesperson     TEXT,
  source          TEXT,                           -- phone, email, parts_site, visit, other
  priority        TEXT NOT NULL DEFAULT 'normal', -- normal, urgent, machine_down
  needed_by       TEXT,                           -- YYYY-MM-DD the customer needs it
  promised        TEXT,                           -- YYYY-MM-DD we said it would ship
  ship_method     TEXT,
  tracking        TEXT,
  invoice_no      TEXT,                           -- the QuickBooks invoice number
  discount_pct    REAL,
  freight         REAL,
  quote_valid     TEXT,                           -- YYYY-MM-DD the quote runs out
  lost_reason     TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'inquiry',
  quote_request_id TEXT UNIQUE,                   -- the parts site quote request it came from, if any
  quote_request_no TEXT,
  quoted_at       TEXT,                           -- first time each step was reached (reports)
  won_at          TEXT,
  shipped_at      TEXT,
  invoiced_at     TEXT,
  closed_at       TEXT,
  revision        INTEGER NOT NULL DEFAULT 1,     -- goes up on every save, so two people can't overwrite each other
  created_by      TEXT REFERENCES users(id),
  updated_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  removed_at      TEXT
);
CREATE INDEX parts_orders_machine ON parts_orders(machine);
CREATE INDEX parts_orders_updated ON parts_orders(updated_at);
CREATE INDEX parts_orders_won ON parts_orders(won_at);

CREATE TABLE parts_order_lines (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES parts_orders(id),
  line_no       INTEGER NOT NULL,
  part_code     TEXT COLLATE NOCASE,
  description   TEXT,
  qty           REAL NOT NULL CHECK (qty > 0),
  unit_price    REAL,
  unit_cost     REAL,
  supplier      TEXT,
  supplier_po   TEXT,
  eta           TEXT,                             -- YYYY-MM-DD the part should arrive
  drop_ship     INTEGER NOT NULL DEFAULT 0,       -- 1 = the supplier ships straight to the customer
  qty_received  REAL NOT NULL DEFAULT 0,          -- typed by hand; receiving in Shipping adds to it on screen
  qty_shipped   REAL NOT NULL DEFAULT 0,
  note          TEXT
);
CREATE INDEX parts_order_lines_order ON parts_order_lines(order_id, line_no);
CREATE INDEX parts_order_lines_code ON parts_order_lines(part_code);

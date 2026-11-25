-- Parts orders: spare parts quotes and the orders they become (change parts stay in cp_orders).
-- A row starts as a quote (Q-2026-0001) and becomes an order (SO-2026-0001) when the customer's PO
-- comes in: same row, same history. Shipping progress is never stored here; it comes from the
-- shipments in 0021 (sh_out_lines), so it can't get out of step.
--
-- HARD RULE: no money. No price, cost, value or total columns anywhere (a test checks every table).

-- The next document number for each kind and year, e.g. kind 'Q-2026' -> 7 makes Q-2026-0007.
CREATE TABLE doc_numbers (
  kind TEXT PRIMARY KEY,
  n    INTEGER NOT NULL
);

CREATE TABLE po_orders (
  id             TEXT PRIMARY KEY,
  quote_number   TEXT NOT NULL UNIQUE,
  quote_rev      INTEGER NOT NULL DEFAULT 0,   -- 0 = revision A, 1 = B ...
  order_number   TEXT UNIQUE,                  -- given when booked
  status         TEXT NOT NULL DEFAULT 'quote' CHECK (status IN ('quote','sent','lost','booked','closed','cancelled')),
  customer       TEXT NOT NULL,                -- company name (customer logins live on the parts site)
  contact        TEXT,
  machine        TEXT,                         -- machine number, linked to machines by serial
  customer_po    TEXT,                         -- required to book
  salesperson    TEXT,
  follow_up      TEXT,                         -- YYYY-MM-DD
  valid_until    TEXT,                         -- YYYY-MM-DD, quote expiry
  promised_date  TEXT,                         -- YYYY-MM-DD, promised ship date
  hold_reason    TEXT,                         -- set = on hold
  reason         TEXT,                         -- why it was lost or cancelled
  request_id     TEXT,                         -- the customer's quote request on the parts site it came from
  request_number TEXT,
  notes          TEXT,
  revision       INTEGER NOT NULL DEFAULT 1,   -- goes up on every save, so two people can't overwrite each other
  sent_at        TEXT,
  booked_at      TEXT,
  lost_at        TEXT,
  closed_at      TEXT,
  cancelled_at   TEXT,
  created_by     TEXT REFERENCES users(id),
  updated_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX po_orders_status ON po_orders(status, updated_at);
CREATE INDEX po_orders_machine ON po_orders(machine);

CREATE TABLE po_lines (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES po_orders(id),
  line_no     INTEGER NOT NULL,
  part_code   TEXT,                            -- Ronchi part code
  description TEXT,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  backorder   INTEGER NOT NULL DEFAULT 0,      -- 1 = waiting on stock (e.g. on order from Italy)
  created_at  TEXT NOT NULL
);
CREATE INDEX po_lines_order ON po_lines(order_id, line_no);

-- Earlier quote revisions, kept read-only when a quote is revised.
CREATE TABLE po_revisions (
  order_id TEXT NOT NULL REFERENCES po_orders(id),
  rev      INTEGER NOT NULL,
  lines    TEXT NOT NULL,                      -- JSON list of { part_code, description, qty }
  detail   TEXT,                               -- JSON of the header as it was
  saved_by TEXT REFERENCES users(id),
  saved_at TEXT NOT NULL,
  PRIMARY KEY (order_id, rev)
);

-- Files on a parts order (the customer's PO, drawings, photos). Kept in R2 under parts-orders/<id>.
CREATE TABLE po_files (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES po_orders(id),
  user_id    TEXT REFERENCES users(id),
  name       TEXT NOT NULL,
  ext        TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX po_files_order ON po_files(order_id);

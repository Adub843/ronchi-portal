-- Shipping and receiving: shipments coming in (from Ronchi Italy and other suppliers) and going out
-- (from a parts order, a change-part order, or anything else). Partial receipts and partial shipments
-- are normal: received and shipped quantities are added up from these rows, never typed over.
-- No paid carrier services: tracking is a link built from each carrier's template below.
--
-- HARD RULE: no money. No freight charge, duty or value columns (a test checks every table).

CREATE TABLE carriers (
  id           TEXT PRIMARY KEY,               -- ups, fedex, ...
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('parcel','ltl','ocean','air','courier','pickup','other')),
  url_template TEXT,                           -- https://...{n}... ; {n} is the tracking number
  checked      INTEGER NOT NULL DEFAULT 0,     -- 1 = the link was checked on the carrier's own site
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 100,
  updated_by   TEXT REFERENCES users(id),
  updated_at   TEXT
);
-- The four parcel carriers' links are well known. The LTL ones must be checked on the carrier's site
-- before relying on them (Shipping > Carriers shows "Check this link" until someone does).
INSERT INTO carriers (id, name, mode, url_template, checked, sort) VALUES
  ('ups',    'UPS',             'parcel',  'https://www.ups.com/track?tracknum={n}', 1, 10),
  ('fedex',  'FedEx',           'parcel',  'https://www.fedex.com/fedextrack/?trknbr={n}', 1, 20),
  ('usps',   'USPS',            'parcel',  'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}', 1, 30),
  ('dhl',    'DHL Express',     'courier', 'https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}', 1, 40),
  ('odfl',   'Old Dominion',    'ltl',     'https://www.odfl.com/us/en/tools/trace-track-ltl-freight/trace.html?proNumbers={n}', 0, 50),
  ('estes',  'Estes',           'ltl',     'https://www.estes-express.com/myestes/shipment-tracking/?type=PRO&query={n}', 0, 60),
  ('saia',   'Saia',            'ltl',     'https://www.saia.com/track/details;pro={n}', 0, 70),
  ('rl',     'R+L Carriers',    'ltl',     'https://www2.rlcarriers.com/freight/shipping/shipment-tracing?pro={n}', 0, 80),
  ('abf',    'ABF Freight',     'ltl',     'https://arcb.com/tools/tracking.html#/{n}', 0, 90),
  ('xpo',    'XPO',             'ltl',     NULL, 0, 100),
  ('ocean',  'Ocean line',      'ocean',   NULL, 0, 110),
  ('pickup', 'Customer pickup', 'pickup',  NULL, 1, 120),
  ('other',  'Other',           'other',   NULL, 1, 130);

CREATE TABLE sh_inbound (
  id             TEXT PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,         -- IN-2026-0001
  supplier       TEXT NOT NULL,                -- Ronchi Italy, or another supplier
  reference      TEXT,                         -- their order or our PO number
  mode           TEXT NOT NULL DEFAULT 'courier' CHECK (mode IN ('ocean','air','courier','truck','other')),
  carrier_id     TEXT REFERENCES carriers(id),
  tracking       TEXT,                         -- tracking, air waybill, container or bill of lading number
  expected_date  TEXT,                         -- YYYY-MM-DD
  stage          TEXT NOT NULL DEFAULT 'expected' CHECK (stage IN ('expected','in_transit','at_customs','arrived','cancelled')),
  customs_status TEXT NOT NULL DEFAULT 'none' CHECK (customs_status IN ('none','pending','held','released')),
  broker         TEXT,                         -- customs broker
  customs_notes  TEXT,
  notes          TEXT,
  received_at    TEXT,                         -- when the last line was received in full
  revision       INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT REFERENCES users(id),
  updated_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX sh_inbound_expected ON sh_inbound(stage, expected_date);

CREATE TABLE sh_in_lines (
  id           TEXT PRIMARY KEY,
  inbound_id   TEXT NOT NULL REFERENCES sh_inbound(id),
  line_no      INTEGER NOT NULL,
  part_code    TEXT,
  description  TEXT,
  qty_expected INTEGER NOT NULL CHECK (qty_expected > 0),
  bin          TEXT                            -- where it was put away (last receipt)
);
CREATE INDEX sh_in_lines_inbound ON sh_in_lines(inbound_id, line_no);

-- Each time something on a line is received. A line can be received in several goes.
CREATE TABLE sh_receipts (
  id         TEXT PRIMARY KEY,
  inbound_id TEXT NOT NULL REFERENCES sh_inbound(id),
  line_id    TEXT NOT NULL REFERENCES sh_in_lines(id),
  qty        INTEGER NOT NULL CHECK (qty >= 0),  -- good parts received
  damaged    INTEGER NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  bin        TEXT,
  user_id    TEXT REFERENCES users(id),
  at         TEXT NOT NULL
);
CREATE INDEX sh_receipts_line ON sh_receipts(line_id);

-- Problems found on receiving: short, over, wrong part, damaged, missing paperwork. Photos go in sh_files.
CREATE TABLE sh_issues (
  id          TEXT PRIMARY KEY,
  inbound_id  TEXT NOT NULL REFERENCES sh_inbound(id),
  line_id     TEXT REFERENCES sh_in_lines(id),
  kind        TEXT NOT NULL CHECK (kind IN ('short','over','wrong_part','damaged','missing_docs','other')),
  qty         INTEGER,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution  TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT
);
CREATE INDEX sh_issues_inbound ON sh_issues(inbound_id, status);

CREATE TABLE sh_outbound (
  id           TEXT PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,           -- OUT-2026-0001
  source       TEXT NOT NULL CHECK (source IN ('parts_order','change_part','other')),
  po_order_id  TEXT REFERENCES po_orders(id),
  cp_order_id  TEXT REFERENCES cp_orders(id),
  customer     TEXT NOT NULL,
  ship_to      TEXT,                           -- address as it goes on the packing slip
  carrier_id   TEXT REFERENCES carriers(id),
  service      TEXT,                           -- Ground, 2Day, LTL standard ...
  tracking     TEXT,                           -- tracking or PRO number
  boxes        INTEGER,
  weight_lb    REAL,
  ship_date    TEXT,                           -- planned until shipped, then the day it left
  status       TEXT NOT NULL DEFAULT 'to_pick' CHECK (status IN ('to_pick','packed','shipped','delivered','cancelled')),
  notes        TEXT,
  delivered_at TEXT,
  revision     INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT REFERENCES users(id),
  updated_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX sh_outbound_status ON sh_outbound(status, ship_date);
CREATE INDEX sh_outbound_po ON sh_outbound(po_order_id);

CREATE TABLE sh_out_lines (
  id          TEXT PRIMARY KEY,
  outbound_id TEXT NOT NULL REFERENCES sh_outbound(id),
  po_line_id  TEXT REFERENCES po_lines(id),    -- the parts order line it ships, when it comes from one
  part_code   TEXT,
  description TEXT,
  qty         INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX sh_out_lines_po ON sh_out_lines(po_line_id);
CREATE INDEX sh_out_lines_out ON sh_out_lines(outbound_id);

-- Paperwork and photos on a shipment (packing list, bill of lading, damage photos). R2: shipping/<id>.
CREATE TABLE sh_files (
  id         TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('inbound','outbound')),
  owner_id   TEXT NOT NULL,
  issue_id   TEXT REFERENCES sh_issues(id),
  user_id    TEXT REFERENCES users(id),
  name       TEXT NOT NULL,
  ext        TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX sh_files_owner ON sh_files(owner_type, owner_id);

-- Shipping and receiving (Aaron, 2026-11-25): everything going out of Ronchi America (machines, spare
-- parts, change parts, samples) and everything coming in (parts from Italy, supplier deliveries, customer
-- returns, sample bottles and caps). Business side only: the help center and parts site never see these.
--
-- Other parts of the portal read these tables (no code import either way):
--  - parts orders: shipped qty per order line = SUM(shipment_lines.qty) of 'out' shipments that are
--    shipped or delivered; received qty = SUM(qty_received) of 'in' shipments; matched by
--    shipment_lines.source_type = 'parts_order_line' AND source_id = <line id>.
--  - change-part orders, jobs and machines list their shipments by source_type/source_id or machine.

CREATE TABLE shipments (
  id             TEXT PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,           -- SH-2026-0001 (out) or RC-2026-0001 (in)
  direction      TEXT NOT NULL CHECK (direction IN ('out','in')),
  kind           TEXT NOT NULL,                  -- machine, spare_parts, change_parts, samples, from_italy, supplier, return, other
  status         TEXT NOT NULL,                  -- see src/shared/shipping.ts
  party          TEXT NOT NULL,                  -- customer (out) or supplier / sender (in)
  machine        TEXT,                           -- machine number, linked to machines by serial
  reference      TEXT,                           -- customer PO, supplier PO, RMA or Italy order number
  address        TEXT,                           -- ship to (out) or ship from (in)
  origin         TEXT,                           -- ship from (out)
  contact_name   TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  carrier        TEXT,                           -- id from the carrier list
  carrier_other  TEXT,
  service        TEXT,
  tracking       TEXT,                           -- one or more tracking / PRO numbers
  bol_number     TEXT,                           -- bill of lading or air waybill number
  mode           TEXT,                           -- in: ocean, air, truck or parcel
  vessel         TEXT,                           -- in: ship and voyage, or flight
  container      TEXT,                           -- in: container number
  broker         TEXT,                           -- in: customs broker
  freight_class  TEXT,
  freight_options TEXT NOT NULL DEFAULT '[]',    -- JSON list: liftgate, inside_delivery, appointment...
  packages       TEXT NOT NULL DEFAULT '[]',     -- JSON list of {type, count, weight, length, width, height}
  planned_date   TEXT,                           -- ship by (out) or expected (in), YYYY-MM-DD
  shipped_date   TEXT,                           -- left the dock (out) or arrived at the dock (in)
  done_date      TEXT,                           -- delivered (out) or fully received (in)
  problem        TEXT,                           -- damaged, short, over, wrong_item, other
  problem_note   TEXT,
  notes          TEXT,
  source_type    TEXT,                           -- parts_order, cp_order or job: what this shipment is for
  source_id      TEXT,
  revision       INTEGER NOT NULL DEFAULT 1,     -- goes up on every save, so two people can't overwrite each other
  created_by     TEXT REFERENCES users(id),
  updated_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  removed_at     TEXT                            -- set when removed; the row is kept for the record
);
CREATE INDEX shipments_open ON shipments(direction, status);
CREATE INDEX shipments_source ON shipments(source_type, source_id);
CREATE INDEX shipments_machine ON shipments(machine);
CREATE INDEX shipments_updated ON shipments(updated_at);

-- What is in a shipment: the packing list (out) or what is expected and what came in (in).
CREATE TABLE shipment_lines (
  id            TEXT PRIMARY KEY,
  shipment_id   TEXT NOT NULL REFERENCES shipments(id),
  line_no       INTEGER NOT NULL,
  part_code     TEXT,
  description   TEXT NOT NULL,
  qty           INTEGER NOT NULL,                -- shipped (out) or expected (in)
  qty_received  INTEGER NOT NULL DEFAULT 0,      -- in only: checked in so far
  bin           TEXT,                            -- in only: where it was put away (shelf, bin, area)
  hold          INTEGER NOT NULL DEFAULT 0,      -- in only: 1 = on quality hold, not to be used or shipped until cleared
  hold_note     TEXT,
  source_type   TEXT,                            -- parts_order_line when it comes from a parts order
  source_id     TEXT
);
CREATE INDEX shipment_lines_shipment ON shipment_lines(shipment_id);
CREATE INDEX shipment_lines_source ON shipment_lines(source_type, source_id);
CREATE INDEX shipment_lines_hold ON shipment_lines(shipment_id) WHERE hold = 1;

-- Photos and papers: packed crate, signed bill of lading, proof of delivery, damage, packing slip.
-- Stored in R2 under shipping/<id>.
CREATE TABLE shipment_files (
  id           TEXT PRIMARY KEY,
  shipment_id  TEXT NOT NULL REFERENCES shipments(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  ext          TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX shipment_files_shipment ON shipment_files(shipment_id);

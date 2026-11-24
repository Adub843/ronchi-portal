-- Change-part orders (replaces the old Change Parts Console and its projects.json).
-- One row per change-part job. Business side only: the help center never sees this table.
CREATE TABLE cp_orders (
  id               TEXT PRIMARY KEY,
  customer         TEXT NOT NULL,
  machine          TEXT,              -- machine number as typed, e.g. 3069MB; linked to machines by serial
  part             TEXT,
  status           TEXT,
  customer_po      TEXT,
  ra_po            TEXT,
  aa               TEXT,
  samples_received TEXT,              -- YYYY-MM-DD
  samples_shipped  TEXT,              -- YYYY-MM-DD
  fill_test        TEXT,
  ship_date        TEXT,              -- YYYY-MM-DD
  folder_url       TEXT,              -- SharePoint folder for the job
  notes            TEXT,
  revision         INTEGER NOT NULL DEFAULT 1,  -- goes up on every save, so two people can't overwrite each other
  created_by       TEXT REFERENCES users(id),
  updated_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  removed_at       TEXT               -- set when removed; the row is kept for the record
);
CREATE INDEX cp_orders_machine ON cp_orders(machine);
CREATE INDEX cp_orders_updated ON cp_orders(updated_at);
CREATE INDEX audit_target ON audit_log(target_type, target_id);

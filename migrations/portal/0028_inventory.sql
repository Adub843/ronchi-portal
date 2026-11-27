-- Inventory: stock on the shelves at Ronchi America (routes/inventory.ts, src/shared/inventory.ts).
-- Business side only: the help center and the customer parts site never see these tables.
--
-- stock_moves is the ledger: one row per change in quantity, never edited or deleted. stock_levels is
-- the running total per part and shelf, changed in the same batch as each ledger row.
CREATE TABLE stock_items (
  part_code     TEXT PRIMARY KEY COLLATE NOCASE,
  description   TEXT,
  bin           TEXT,                           -- the usual shelf
  reorder_point REAL,                           -- low stock when available falls to this
  reorder_qty   REAL,                           -- how many to order when low
  unit_cost     REAL,                           -- US dollars each; only sent to people with inventory.prices
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,     -- 0 = no longer kept in stock (history stays)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT REFERENCES users(id)
);

CREATE TABLE stock_levels (
  part_code TEXT NOT NULL COLLATE NOCASE REFERENCES stock_items(part_code),
  location  TEXT NOT NULL COLLATE NOCASE,       -- shelf, bin or area, as people name it
  qty       REAL NOT NULL CHECK (qty >= 0),     -- a shelf can never go below zero
  PRIMARY KEY (part_code, location)
);

CREATE TABLE stock_moves (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  part_code   TEXT NOT NULL COLLATE NOCASE,
  location    TEXT NOT NULL COLLATE NOCASE,
  delta       REAL NOT NULL,                    -- + into the shelf, - out of it
  type        TEXT NOT NULL,                    -- receive, issue, move, adjust, opening
  reason      TEXT,
  note        TEXT,
  pair_id     TEXT,                             -- the two rows of one shelf-to-shelf move share this
  source_type TEXT,                             -- what caused it, when another part of the portal did (shipment_line ...)
  source_id   TEXT,
  user_id     TEXT REFERENCES users(id)
);
CREATE INDEX stock_moves_part ON stock_moves(part_code, at);
CREATE INDEX stock_moves_at ON stock_moves(at);
CREATE INDEX stock_moves_source ON stock_moves(source_type, source_id);

-- A built-in role an admin already saved keeps its own list, so give it this section's defaults
-- (the same as roles.ts) once. Roles nobody saved follow roles.ts and need nothing here.
WITH defaults(role, perm) AS (VALUES
  ('manager', 'inventory.view'), ('manager', 'inventory.edit'), ('manager', 'inventory.adjust'), ('manager', 'inventory.prices'),
  ('sales', 'inventory.view'), ('sales', 'inventory.edit'), ('sales', 'inventory.prices'),
  ('billing', 'inventory.view'), ('billing', 'inventory.prices'),
  ('scheduling', 'inventory.view'), ('scheduling', 'inventory.edit'), ('scheduling', 'inventory.adjust'),
  ('service', 'inventory.view'), ('service', 'inventory.edit'),
  ('engineering', 'inventory.view'), ('tech', 'inventory.view'))
UPDATE roles SET perms = (
    SELECT json_group_array(value) FROM (
      SELECT value FROM json_each(roles.perms)
      UNION SELECT perm FROM defaults WHERE defaults.role = roles.id))
 WHERE json_valid(perms) AND id IN (SELECT role FROM defaults);

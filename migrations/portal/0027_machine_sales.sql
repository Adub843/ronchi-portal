-- Machine sales: new-machine deals from the first call to final payment (routes/machine-sales.ts).
-- Business side only: the help center and the customer parts site never see these tables.
CREATE TABLE machine_deals (
  id             TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL UNIQUE,     -- shown as M-1001, M-1002, ...
  customer       TEXT NOT NULL,
  site           TEXT,
  title          TEXT,                        -- e.g. "24-head filler with capper"
  machine_type   TEXT,
  speed_bpm      REAL,                        -- bottles a minute
  formats        TEXT,
  value          REAL,                        -- US dollars; only sent to people with machinesales.prices
  chance         REAL,                        -- percent typed by hand; NULL = the stage's usual chance
  expected_po    TEXT,                        -- YYYY-MM the PO is expected
  owner          TEXT,                        -- salesperson
  lead_source    TEXT,
  funded         INTEGER NOT NULL DEFAULT 0,  -- 1 = the customer's budget is approved
  decision_date  TEXT,
  next_step      TEXT,
  next_step_date TEXT,
  hold_until     TEXT,                        -- reconnect date while on hold
  lost_reason    TEXT,
  competitor     TEXT,
  customer_po    TEXT,
  contact        TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  target_ship    TEXT,
  machine        TEXT,                        -- machine number once one is given, e.g. 4222TP
  notes          TEXT,
  stage          TEXT NOT NULL DEFAULT 'lead',
  prev_stage     TEXT,                        -- where it was before On hold or Lost, to pick it back up
  stage_at       TEXT NOT NULL,               -- when it reached this stage (days in stage)
  won_at         TEXT,
  lost_at        TEXT,
  closed_at      TEXT,                        -- final payment received
  revision       INTEGER NOT NULL DEFAULT 1,  -- goes up on every save, so two people can't overwrite each other
  created_by     TEXT REFERENCES users(id),
  updated_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  removed_at     TEXT
);
CREATE INDEX machine_deals_updated ON machine_deals(updated_at);
CREATE INDEX machine_deals_customer ON machine_deals(customer);

-- Calls, visits, emails and notes logged on a deal: its timeline.
CREATE TABLE machine_deal_notes (
  id         TEXT PRIMARY KEY,
  deal_id    TEXT NOT NULL REFERENCES machine_deals(id),
  kind       TEXT NOT NULL DEFAULT 'note',    -- note, call, visit, email, meeting
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX machine_deal_notes_deal ON machine_deal_notes(deal_id, created_at);

-- A built-in role an admin already saved keeps its own list, so give it this section's defaults
-- (the same as roles.ts) once. Roles nobody saved follow roles.ts and need nothing here.
WITH defaults(role, perm) AS (VALUES
  ('manager', 'machinesales.view'), ('manager', 'machinesales.add'), ('manager', 'machinesales.edit'), ('manager', 'machinesales.remove'), ('manager', 'machinesales.prices'),
  ('sales', 'machinesales.view'), ('sales', 'machinesales.add'), ('sales', 'machinesales.edit'), ('sales', 'machinesales.remove'), ('sales', 'machinesales.prices'),
  ('billing', 'machinesales.view'), ('billing', 'machinesales.prices'),
  ('scheduling', 'machinesales.view'), ('service', 'machinesales.view'), ('engineering', 'machinesales.view'), ('tech', 'machinesales.view'))
UPDATE roles SET perms = (
    SELECT json_group_array(value) FROM (
      SELECT value FROM json_each(roles.perms)
      UNION SELECT perm FROM defaults WHERE defaults.role = roles.id))
 WHERE json_valid(perms) AND id IN (SELECT role FROM defaults);

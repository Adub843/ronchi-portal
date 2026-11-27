-- Machine quotes: the priced offer on a machine deal, kept as revisions (routes/machine-sales.ts,
-- src/shared/machine-quotes.ts). Business side only. Only people with machinesales.prices can read them.
CREATE TABLE machine_quotes (
  id             TEXT PRIMARY KEY,
  deal_id        TEXT NOT NULL REFERENCES machine_deals(id),
  rev            INTEGER NOT NULL,              -- 1, 2, 3 ... shown as M-1001-Q2
  kind           TEXT NOT NULL DEFAULT 'firm',  -- budget or firm
  status         TEXT NOT NULL DEFAULT 'draft', -- draft, sent, accepted, declined, superseded
  valid_until    TEXT,
  lead_time      TEXT,
  payment_terms  TEXT,
  delivery_terms TEXT,
  warranty       TEXT,
  notes          TEXT,
  discount_pct   REAL,
  lines          TEXT NOT NULL DEFAULT '[]',    -- JSON list of {description, detail, origin, qty, unit_price, optional}
  total          REAL,                          -- US dollars, after discount, without options
  sent_at        TEXT,
  decided_at     TEXT,                          -- accepted or declined
  revision       INTEGER NOT NULL DEFAULT 1,    -- goes up on every save, so two people can't overwrite each other
  created_by     TEXT REFERENCES users(id),
  updated_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  removed_at     TEXT,
  UNIQUE (deal_id, rev)
);
CREATE INDEX machine_quotes_deal ON machine_quotes(deal_id, rev);

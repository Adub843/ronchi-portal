-- Machine orders: order dates and payments on a sold machine deal (routes/machine-sales.ts,
-- src/shared/machine-orders.ts). Payment amounts are only sent to people with machinesales.prices.
CREATE TABLE machine_deal_milestones (
  id         TEXT PRIMARY KEY,
  deal_id    TEXT NOT NULL REFERENCES machine_deals(id),
  kind       TEXT NOT NULL CHECK (kind IN ('date', 'payment')),
  line_no    INTEGER NOT NULL,
  label      TEXT NOT NULL,
  due        TEXT,                -- planned date, or when the payment is due
  done       TEXT,                -- the day it happened, or the day the payment arrived
  pct        REAL,                -- payments: percent of the order value
  amount     REAL,                -- payments: US dollars, when typed instead of a percent
  invoice_no TEXT
);
CREATE INDEX machine_deal_milestones_deal ON machine_deal_milestones(deal_id, kind, line_no);
CREATE INDEX machine_deal_milestones_due ON machine_deal_milestones(due) WHERE done IS NULL;

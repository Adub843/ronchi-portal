-- Change-part sales: a change-part job starts as a sale (worked by sales, e.g. Andrew Yang or
-- Michele Falsini) and becomes a tracked order when it's sold. Same row, same history.
-- phase = 'sale' while it's being sold, 'order' once sold (every existing row is an order).
ALTER TABLE cp_orders ADD COLUMN phase TEXT NOT NULL DEFAULT 'order' CHECK (phase IN ('sale','order'));
ALTER TABLE cp_orders ADD COLUMN contact TEXT;     -- who at the customer we're dealing with
ALTER TABLE cp_orders ADD COLUMN follow_up TEXT;   -- next follow-up, as typed; a real date flags overdue
ALTER TABLE cp_orders ADD COLUMN sold_at TEXT;     -- when the sale became an order
CREATE INDEX cp_orders_phase ON cp_orders(phase, updated_at);

-- Change-part orders: match the Change Parts Management Master Sheet.
-- Adds Salesperson and Quote #. Samples received/shipped and ship date stay TEXT and are now
-- free text as the sheet writes them ("Yes", "No", "Mid Nov 2026"); a real date still flags late jobs.
ALTER TABLE cp_orders ADD COLUMN salesperson TEXT;
ALTER TABLE cp_orders ADD COLUMN quote TEXT;

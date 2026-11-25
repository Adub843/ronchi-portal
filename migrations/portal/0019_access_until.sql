-- Per-person access changes can run out (Command center: "until a date"). NULL = no end.
-- An expired row is ignored everywhere, so the person simply goes back to what their role gives.
ALTER TABLE user_access ADD COLUMN expires_at TEXT;

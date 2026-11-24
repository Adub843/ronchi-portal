-- Admin controls (Settings > Admin controls): one record holding every setting as JSON.
-- The app fills anything missing with its default (src/portal/lib/settings.ts), so adding a
-- new control later needs no migration. Each save is also written to the audit log.
CREATE TABLE settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,          -- JSON
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);

-- Break button (Aaron, 2026-11-24): going on break stops the clock until the person goes off break.
-- Adds two punch kinds, break_start and break_end. SQLite can't change a CHECK rule in place,
-- so the punches table is rebuilt with the same columns and data.
PRAGMA defer_foreign_keys = true;

CREATE TABLE punches_new (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL CHECK (kind IN ('in','out','break_start','break_end')),
  at              TEXT NOT NULL,
  location_source TEXT NOT NULL CHECK (location_source IN ('gps','typed','none')),
  lat             REAL,
  lng             REAL,
  accuracy_m      REAL,
  address         TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO punches_new SELECT id, user_id, kind, at, location_source, lat, lng, accuracy_m, address, note, created_at FROM punches;
DROP TABLE punches;
ALTER TABLE punches_new RENAME TO punches;
CREATE INDEX punches_user_at ON punches(user_id, at);

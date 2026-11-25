-- Quick links on the Home page (Aaron, 2026-11-25): buttons an admin names and points at a website.
-- audience: NULL = everyone on staff; otherwise a JSON list of role ids and "u:<user id>" entries.
CREATE TABLE IF NOT EXISTS quick_links (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  audience TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quick_links_position ON quick_links (position);

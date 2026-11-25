-- Live updates (Aaron, 2026-11-25: the portal "updates every time a user presses enter or changes
-- anything or uploads a file"). Every change through the API adds one to its area's number here;
-- open pages compare the numbers on their regular check and reload the area that changed.
-- One small row per area, so it never grows.
CREATE TABLE IF NOT EXISTS live_revs (
  topic TEXT PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);

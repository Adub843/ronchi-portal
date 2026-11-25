-- Per-person access (Aaron, 2026-11-24): an admin can switch any single permission on or off for
-- one person, on top of their role. No row = follow the role. allow 1 = on, 0 = off.
CREATE TABLE user_access (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm       TEXT NOT NULL,
  allow      INTEGER NOT NULL CHECK (allow IN (0, 1)),
  set_by     TEXT,
  set_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, perm)
);

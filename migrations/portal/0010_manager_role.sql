-- Manager role (Aaron, 2026-11-24): "paolo, steve, michele, and morad should all be manager level
-- log ins i am the only admin". SQLite can't change a CHECK in place, so the users table is
-- rebuilt with the same columns and rows. Foreign keys are checked at the end, when the new
-- table is back under the same name. Per-person access rows are kept aside first, because
-- dropping the old table would otherwise remove them (ON DELETE CASCADE).
PRAGMA defer_foreign_keys = true;

CREATE TABLE user_access_keep AS SELECT * FROM user_access;

CREATE TABLE users_new (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('admin','manager','billing','scheduling','service','sales','engineering','tech')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
INSERT INTO users_new (id, email, name, role, status, created_at, updated_at)
  SELECT id, email, name, role, status, created_at, updated_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

INSERT OR IGNORE INTO user_access (user_id, perm, allow, set_by, set_at)
  SELECT user_id, perm, allow, set_by, set_at FROM user_access_keep;
DROP TABLE user_access_keep;

-- Every row that pointed at a person still does (same ids), but SQLite still counts the
-- references the drop above touched. Switching deferral off clears that count, as D1's docs
-- describe. Nothing else in this migration changes any reference.
PRAGMA defer_foreign_keys = false;

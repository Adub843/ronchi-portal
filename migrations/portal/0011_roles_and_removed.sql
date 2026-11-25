-- Aaron, 2026-11-24: "i need to be able to add and remove employees" and "add and create rolls".
--
-- 1. Roles live in the database (table roles), so an admin can create a role or change what one
--    allows without a code change. The built-in roles still come from src/portal/lib/roles.ts; a
--    row with a built-in id only changes that role's name or switches.
-- 2. users.role no longer has a fixed list (the app checks it against the built-in roles and the
--    roles table), and users.removed_at marks someone removed: signed out, can't sign in, kept
--    for history (their posts, orders and notes keep their name).
--
-- Same rebuild as 0010: keep per-person access rows aside, rebuild, clear the deferred count.
PRAGMA defer_foreign_keys = true;

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  perms       TEXT NOT NULL DEFAULT '[]',
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE user_access_keep AS SELECT * FROM user_access;

CREATE TABLE users_new (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  removed_at       TEXT
);
INSERT INTO users_new (id, email, name, role, status, created_at, updated_at)
  SELECT id, email, name, role, status, created_at, updated_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

INSERT OR IGNORE INTO user_access (user_id, perm, allow, set_by, set_at)
  SELECT user_id, perm, allow, set_by, set_at FROM user_access_keep;
DROP TABLE user_access_keep;

PRAGMA defer_foreign_keys = false;

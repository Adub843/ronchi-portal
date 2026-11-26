-- A manual read on the PC by the catalog loader has no staff member behind it, so an import's
-- user can be empty. SQLite can't drop NOT NULL in place: the table is rebuilt with its rows kept.
CREATE TABLE catalog_imports_new (
  id         TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  file_name  TEXT NOT NULL,
  pages      INTEGER NOT NULL,
  sheets     INTEGER NOT NULL,
  rows       INTEGER NOT NULL,
  warnings   TEXT,          -- JSON list
  user_id    TEXT REFERENCES users(id),   -- NULL = read on the PC by the catalog loader
  created_at TEXT NOT NULL
);
INSERT INTO catalog_imports_new (id, machine_id, file_name, pages, sheets, rows, warnings, user_id, created_at)
  SELECT id, machine_id, file_name, pages, sheets, rows, warnings, user_id, created_at FROM catalog_imports;
DROP TABLE catalog_imports;
ALTER TABLE catalog_imports_new RENAME TO catalog_imports;
CREATE INDEX catalog_imports_machine ON catalog_imports(machine_id, created_at);

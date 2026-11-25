-- Software downloads (Aaron, 2026-11-25): installers and program folders admins upload, grouped
-- into packages such as "New laptop setup". Staff tick the folders they want and download them all.
-- The files themselves live in the FILES bucket under software/<file id>.
CREATE TABLE IF NOT EXISTS software_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  legacy INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

-- folder: where the file sits inside the package, with / between folders ('' = not in a folder).
-- upload_id: the bucket's multipart upload while the file is still coming in; NULL once it's ready.
CREATE TABLE IF NOT EXISTS software_files (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES software_packages(id),
  folder TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  upload_id TEXT,
  ready_at TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS software_files_package ON software_files (package_id, folder, name);

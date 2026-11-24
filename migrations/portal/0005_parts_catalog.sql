-- Parts catalog (staff side). Read from each machine's manual (chapter 11) and from 3D CAD.
-- Drawings and 3D models are kept in R2 (bucket ronchi-portal-files) under catalog/<sheet id>/...
-- Customers never read these tables: a machine's catalog is copied to the customer parts site
-- by Publish (src/portal/routes/catalog.ts), without staff notes, customer names or sites.

-- One row per Ronchi part code. Names are shared by every machine that uses the part.
CREATE TABLE catalog_parts (
  code       TEXT PRIMARY KEY COLLATE NOCASE,  -- GF010526, CM009450_195, 0000025133
  rev        TEXT,
  name_en    TEXT NOT NULL DEFAULT '',
  name_it    TEXT NOT NULL DEFAULT '',
  maker      TEXT,                             -- for bought-in parts: who makes it (SMC, SKF ...)
  maker_pn   TEXT,                             -- and their part number
  wear       INTEGER NOT NULL DEFAULT 0,       -- 1 = wears out, suggested as a spare
  updated_at TEXT NOT NULL
);

-- One drawing or 3D assembly in a machine's catalog.
CREATE TABLE catalog_sheets (
  id          TEXT PRIMARY KEY,
  machine_id  TEXT NOT NULL REFERENCES machines(id),
  parent_id   TEXT REFERENCES catalog_sheets(id),  -- the assembly this one sits inside
  section     TEXT NOT NULL DEFAULT 'machine' CHECK (section IN ('machine','format','elevator','kit')),
  grp         TEXT,                                -- chapter 11 group, for example "Capping units"
  code        TEXT,                                -- the assembly's own part code
  rev         TEXT,
  title       TEXT NOT NULL DEFAULT '',
  title_it    TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','cad','hand')),
  page        INTEGER,                             -- page in the chapter 11 PDF
  sort        INTEGER NOT NULL DEFAULT 0,
  image_w     INTEGER,                             -- the drawing, when there is one (R2 catalog/<id>/drawing)
  image_h     INTEGER,
  model_size  INTEGER,                             -- the 3D model, when there is one (R2 catalog/<id>/model.glb)
  mesh_map    TEXT,                                -- JSON: 3D part name -> part code
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX catalog_sheets_machine ON catalog_sheets(machine_id, sort);

-- The lines of a sheet's parts table.
CREATE TABLE catalog_rows (
  id        TEXT PRIMARY KEY,
  sheet_id  TEXT NOT NULL REFERENCES catalog_sheets(id) ON DELETE CASCADE,
  pos       TEXT NOT NULL DEFAULT '',
  code      TEXT NOT NULL COLLATE NOCASE,
  qty       REAL,
  unit      TEXT,
  hotspots  TEXT,          -- JSON list of {x,y,w,h} (fractions of the drawing) for this balloon
  sort      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX catalog_rows_sheet ON catalog_rows(sheet_id, sort);
CREATE INDEX catalog_rows_code ON catalog_rows(code);

-- Staff-only know-how on a part: fix tips, photos of where it sits, what to watch for.
CREATE TABLE catalog_notes (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL COLLATE NOCASE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX catalog_notes_code ON catalog_notes(code, created_at);

-- Every import from a manual, so anyone can see what was read and what needs checking.
CREATE TABLE catalog_imports (
  id         TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id),
  file_name  TEXT NOT NULL,
  pages      INTEGER NOT NULL,
  sheets     INTEGER NOT NULL,
  rows       INTEGER NOT NULL,
  warnings   TEXT,          -- JSON list
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- When a machine's catalog was last copied to the customer parts site.
ALTER TABLE machines ADD COLUMN catalog_published_at TEXT;

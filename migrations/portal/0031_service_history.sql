-- Service history: past service projects kept in SharePoint (one row per project folder), shown on
-- the machine's page with a link that opens the folder in SharePoint (routes/machines.ts).
-- Only folder names and links are kept here; invoices and estimates stay in SharePoint.
CREATE TABLE service_history (
  id             TEXT PRIMARY KEY,
  customer       TEXT NOT NULL,
  project_no     TEXT,                 -- e.g. 23-0139-W1
  year           INTEGER,
  title          TEXT NOT NULL,        -- the project folder's name
  machines       TEXT NOT NULL DEFAULT '',  -- machine numbers without the type letters, space on both sides: " 4005 4010 "
  reports        INTEGER NOT NULL DEFAULT 0, -- service report files in the folder
  sharepoint_url TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL
);
CREATE INDEX service_history_year ON service_history(year);

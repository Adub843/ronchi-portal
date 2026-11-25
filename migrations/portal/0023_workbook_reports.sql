-- The Ronchi workbook's job paperwork (Aaron, 2026-11-25): each job's chat, and each field service
-- engineer's time sheet and service report for the job. Replaces the old standalone "Ronchi Field
-- Service Workbook" app's Service report and Time sheet tabs.
--
-- Hard rules: no money amounts anywhere (expenses have a type, description, receipt photo and a
-- quantity such as miles or nights, never an amount), and no clock or location tracking: times are
-- typed paperwork. test/portal/reports.test.ts checks these tables have no money columns.

-- The discussion thread for a job: a private chat in the boards table (kind 'chat'). Its members follow
-- the job's field service engineers; the scheduler who made the job and anyone who schedules jobs join
-- when they open it.
CREATE TABLE job_chats (
  job_id      TEXT PRIMARY KEY REFERENCES jobs(id),
  board_id    TEXT NOT NULL UNIQUE REFERENCES boards(id),
  created_at  TEXT NOT NULL
);

-- One time sheet per engineer per job. Status: draft → sent → approved, or returned (sent back) with a note.
CREATE TABLE time_sheets (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','returned')),
  review_note  TEXT,
  sent_at      TEXT,
  reviewed_by  TEXT REFERENCES users(id),
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (job_id, user_id)
);
CREATE INDEX time_sheets_status ON time_sheets(status);

-- One row per day worked. Work hours are worked out from start, end and break (src/shared/reports.ts).
CREATE TABLE time_days (
  id              TEXT PRIMARY KEY,
  sheet_id        TEXT NOT NULL REFERENCES time_sheets(id),
  work_date       TEXT NOT NULL,              -- YYYY-MM-DD
  start_time      TEXT,                       -- HH:MM, typed
  end_time        TEXT,
  break_min       INTEGER NOT NULL DEFAULT 0,
  travel_min      INTEGER NOT NULL DEFAULT 0,
  production_min  INTEGER NOT NULL DEFAULT 0,
  billable        INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0, 1)),
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX time_days_sheet ON time_days(sheet_id, work_date);

CREATE TABLE time_expenses (
  id           TEXT PRIMARY KEY,
  sheet_id     TEXT NOT NULL REFERENCES time_sheets(id),
  exp_date     TEXT NOT NULL,
  type         TEXT NOT NULL,                 -- mileage, hotel, airfare, rental_car, fuel, meals, parking, tools, other
  description  TEXT,
  quantity     REAL,                          -- miles, nights, days; never money
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX time_expenses_sheet ON time_expenses(sheet_id);

-- One service report per engineer per job.
CREATE TABLE service_reports (
  id                  TEXT PRIMARY KEY,
  job_id              TEXT NOT NULL REFERENCES jobs(id),
  user_id             TEXT NOT NULL REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','returned')),
  summary             TEXT,                   -- what was found and done, in short
  recipe              TEXT,                   -- recipe sheet and machine settings left in place
  follow_up           TEXT,                   -- recommendations and next steps
  signer_name         TEXT,                   -- customer sign-off
  signer_title        TEXT,
  signed_on           TEXT,
  signature_file_id   TEXT,                   -- PNG drawn on the screen, in report_files
  review_note         TEXT,
  sent_at             TEXT,
  reviewed_by         TEXT REFERENCES users(id),
  reviewed_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (job_id, user_id)
);
CREATE INDEX service_reports_status ON service_reports(status);

-- Work log: what was done each day.
CREATE TABLE report_log (
  id          TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL REFERENCES service_reports(id),
  work_date   TEXT NOT NULL,
  text        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX report_log_report ON report_log(report_id, work_date);

-- Ronchi parts used on the visit or needed afterwards (part code and quantity; a parts order is raised separately).
CREATE TABLE report_parts (
  id           TEXT PRIMARY KEY,
  report_id    TEXT NOT NULL REFERENCES service_reports(id),
  kind         TEXT NOT NULL CHECK (kind IN ('used','needed')),
  part_code    TEXT,
  description  TEXT,
  qty          INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX report_parts_report ON report_parts(report_id);

-- Receipt photos, supporting photos and signatures. Stored in R2 under reports/<id>; served only to the
-- engineer who owns the paperwork and to reviewers.
CREATE TABLE report_files (
  id          TEXT PRIMARY KEY,
  doc_kind    TEXT NOT NULL CHECK (doc_kind IN ('sheet','service')),
  doc_id      TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('receipt','photo','signature')),
  row_id      TEXT,                           -- the expense a receipt belongs to
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  ext         TEXT NOT NULL,
  size        INTEGER NOT NULL,
  caption     TEXT,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX report_files_doc ON report_files(doc_kind, doc_id);

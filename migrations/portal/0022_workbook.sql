-- The Ronchi workbook inside Work orders (Aaron, 2026-11-25: "yes, all of it").
-- Each job's work order gets what the old Field Service Workbook app kept on one phone:
-- the service report (daily work log, photos, customer sign-off), billable hours, expenses,
-- a chat for the job, and Submit, which sends the report to the office.
--
-- BILLABLE HOURS ARE NOT A TIME CLOCK (Aaron, 2026-11-25: "the hours on the timesheet or workbook are
-- for customer billing not a time clock"). They are the hours billed to the customer for this job, by
-- type (travel, regular, training, overtime, warranty), typed in per day. No clock-in, no location.
-- Business side only: the help center and parts site never see these tables.

-- One service report per job.
CREATE TABLE wb_reports (
  job_id        TEXT PRIMARY KEY REFERENCES jobs(id),
  scope         TEXT,                 -- Line Down, Start up, Training ... (the old workbook's list)
  summary       TEXT,                 -- what was done, in a few lines, for the office
  open_issues   TEXT,                 -- anything left unresolved
  sign_name     TEXT,                 -- the customer's printed name
  sign_title    TEXT,
  sign_date     TEXT,                 -- YYYY-MM-DD
  signature     TEXT,                 -- the customer's signature as a small PNG data URL
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_by  TEXT REFERENCES users(id),
  submitted_at  TEXT,
  revision      INTEGER NOT NULL DEFAULT 1,
  updated_by    TEXT REFERENCES users(id),
  updated_at    TEXT NOT NULL
);

-- The daily work log: one line per engineer per day (or more).
CREATE TABLE wb_entries (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id),
  user_id       TEXT NOT NULL REFERENCES users(id),   -- the field service engineer
  day           TEXT NOT NULL,                        -- YYYY-MM-DD
  work          TEXT,                                 -- type of work (scope list)
  description   TEXT NOT NULL,                        -- what was done that day
  done          TEXT CHECK (done IN ('Y','N')),       -- finished?
  pct           TEXT,                                 -- how far along, when not finished
  issues        TEXT,                                 -- problems found; each one becomes a quick note on Submit
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  removed_at    TEXT
);
CREATE INDEX wb_entries_job ON wb_entries(job_id, day);

-- Captions for photos. The photos themselves are the job's files (job_files, R2 jobs/<id>).
CREATE TABLE wb_photos (
  file_id       TEXT PRIMARY KEY REFERENCES job_files(id),
  job_id        TEXT NOT NULL REFERENCES jobs(id),
  caption       TEXT,
  recipe_screen TEXT,                 -- set when the photo is a recipe screen (HMI screenshot)
  updated_at    TEXT NOT NULL
);
CREATE INDEX wb_photos_job ON wb_photos(job_id);

-- Billable hours: what to bill the customer for, per engineer per day, by type.
CREATE TABLE wb_hours (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  day           TEXT NOT NULL,
  travel_wd     REAL NOT NULL DEFAULT 0,  -- weekday travel
  travel_we     REAL NOT NULL DEFAULT 0,  -- weekend travel
  regular       REAL NOT NULL DEFAULT 0,
  training      REAL NOT NULL DEFAULT 0,
  overtime      REAL NOT NULL DEFAULT 0,
  warranty      REAL NOT NULL DEFAULT 0,
  miles         REAL NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (job_id, user_id, day)
);
CREATE INDEX wb_hours_day ON wb_hours(day);

-- Expenses for the job, with an optional receipt photo (a job file).
CREATE TABLE wb_expenses (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  day           TEXT NOT NULL,
  type          TEXT NOT NULL,            -- Airfare, Hotel, Meals ... (the old workbook's list)
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  pay           TEXT NOT NULL DEFAULT 'Credit' CHECK (pay IN ('Credit','Cash')),
  description   TEXT,
  billable      TEXT NOT NULL DEFAULT 'Y' CHECK (billable IN ('Y','N')),
  receipt_file  TEXT REFERENCES job_files(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  removed_at    TEXT
);
CREATE INDEX wb_expenses_job ON wb_expenses(job_id);
CREATE INDEX wb_expenses_day ON wb_expenses(day);

-- Who gets the submitted service report (Aaron's list: Paolo, Meagan, Lola, Steve). Admins set it.
-- No foreign key, so rebuilding the users table (as role migrations do) can never drop it.
CREATE TABLE wb_recipients (
  user_id       TEXT PRIMARY KEY,
  added_by      TEXT,
  added_at      TEXT NOT NULL
);

-- The job's own chat (a members-only chat in boards), made the first time someone opens it.
ALTER TABLE jobs ADD COLUMN chat_id TEXT;

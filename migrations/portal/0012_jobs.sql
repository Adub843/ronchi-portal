-- Tech jobs (Aaron, 2026-11-25): a scheduled visit to a customer. Meagan schedules it, the techs on it
-- get an email with a link to the job's page, and anyone on the job can add files to it.
-- Business side only: the help center and parts site never see these tables.

-- Where job emails go for people whose login is a plain username (no email). No row = use the login if
-- it is an email. Kept in its own table, not a column on users, so rebuilding the users table (as the
-- role migrations do) can never drop it. No foreign key on purpose, for the same reason.
CREATE TABLE notice_emails (
  user_id  TEXT PRIMARY KEY,
  email    TEXT NOT NULL,
  set_by   TEXT,
  set_at   TEXT NOT NULL
);

CREATE TABLE jobs (
  id             TEXT PRIMARY KEY,
  job_number     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  customer       TEXT NOT NULL,
  machine        TEXT,              -- machine number as typed, e.g. 4110MB; linked to machines by serial
  location       TEXT,              -- the customer's address; the app turns it into map links
  contact_name   TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  work_days      TEXT NOT NULL DEFAULT '[]',  -- JSON list of YYYY-MM-DD, sorted
  first_day      TEXT,              -- the first and last of work_days, for sorting and "upcoming"
  last_day       TEXT,
  notes          TEXT,              -- the free text box
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','done','cancelled')),
  revision       INTEGER NOT NULL DEFAULT 1,  -- goes up on every save, so two people can't overwrite each other
  created_by     TEXT REFERENCES users(id),
  updated_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX jobs_machine ON jobs(machine);
CREATE INDEX jobs_days ON jobs(first_day, last_day);

-- The techs on a job, and whether their email went out.
CREATE TABLE job_techs (
  job_id       TEXT NOT NULL REFERENCES jobs(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  added_by     TEXT REFERENCES users(id),
  added_at     TEXT NOT NULL,
  email_status TEXT,                -- sent, not_set_up, no_address, failed
  emailed_at   TEXT,
  PRIMARY KEY (job_id, user_id)
);
CREATE INDEX job_techs_user ON job_techs(user_id);

-- Files added to a job (service reports, photos, drawings). Stored in R2 under jobs/<id>.
CREATE TABLE job_files (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  ext         TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX job_files_job ON job_files(job_id);

-- On/off switches for whole parts of the portal, set by an admin. No row = the default (on).
-- "workbook" (Aaron, 2026-11-25): the Ronchi workbook's Work orders pages. Ronchi may keep using its
-- Excel sheets, so switching it off removes the workbook and everything else keeps working.
CREATE TABLE feature_switches (
  name    TEXT PRIMARY KEY,
  is_on   INTEGER NOT NULL CHECK (is_on IN (0, 1)),
  set_by  TEXT REFERENCES users(id),
  set_at  TEXT NOT NULL
);

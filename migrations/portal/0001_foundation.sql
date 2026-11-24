-- Ronchi Portal business store (portal-db), Step 1.
-- Every id is a random string made by the app (never a counting number),
-- so nobody can guess the next record. Times are ISO 8601 UTC text from the server clock.

-- People who can sign in. role decides what they can see (src/portal/lib/roles.ts).
CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('admin','billing','scheduling','service','sales','engineering','tech')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  can_type_address INTEGER NOT NULL DEFAULT 0,   -- may type an address at clock in/out instead of phone location
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- One-time invite links. Only a hash of the token is stored.
CREATE TABLE invites (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  can_type_address INTEGER NOT NULL DEFAULT 0,
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  TEXT,                -- NULL only for the first-admin invite made from the command line
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  user_id     TEXT                 -- set when a person signs up with it (also used for "add another passkey")
);

-- Passkeys (Face ID, fingerprint, Windows Hello, security key). Public keys only.
CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,   -- credential id, base64url
  user_id      TEXT NOT NULL REFERENCES users(id),
  public_key   TEXT NOT NULL,      -- base64url
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,               -- JSON array
  nickname     TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys(user_id);

-- Short-lived passkey challenges (5 minutes).
CREATE TABLE auth_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register','login')),
  invite_id  TEXT,
  expires_at TEXT NOT NULL
);

-- Signed-in sessions. The cookie holds a random token; only its SHA-256 hash is stored here.
CREATE TABLE sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Append-only record of who did what. The app never updates or deletes rows here.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,               -- JSON
  ip          TEXT
);
CREATE INDEX audit_at ON audit_log(at);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

-- Machine registry. serial is the Ronchi machine number, for example 3069MB.
CREATE TABLE machines (
  id         TEXT PRIMARY KEY,
  serial     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  model      TEXT,
  customer   TEXT,
  site       TEXT,
  notes      TEXT,
  sharepoint_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Message boards. audience = JSON list of roles that can see it, or NULL for all staff.
CREATE TABLE boards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  audience    TEXT,
  machine_id  TEXT REFERENCES machines(id),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE posts (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id),
  parent_id  TEXT REFERENCES posts(id),  -- set for replies
  user_id    TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,              -- plain text, never rendered as HTML
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  edited_at  TEXT,
  deleted_at TEXT
);
CREATE INDEX posts_board ON posts(board_id, created_at);

-- Time clock. at is always the server's clock, never the phone's.
CREATE TABLE punches (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL CHECK (kind IN ('in','out')),
  at              TEXT NOT NULL,
  location_source TEXT NOT NULL CHECK (location_source IN ('gps','typed','none')),
  lat             REAL,
  lng             REAL,
  accuracy_m      REAL,
  address         TEXT,      -- only when typed by hand (shown as "entered by hand")
  note            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX punches_user_at ON punches(user_id, at);

-- Requests to change a punch time. Billing (Lola) or admin approves. The original time is kept.
CREATE TABLE punch_edits (
  id           TEXT PRIMARY KEY,
  punch_id     TEXT NOT NULL REFERENCES punches(id),
  requested_by TEXT NOT NULL REFERENCES users(id),
  old_at       TEXT NOT NULL,
  new_at       TEXT NOT NULL,
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by   TEXT REFERENCES users(id),
  decided_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX punch_edits_status ON punch_edits(status);

-- Each person's look: theme, layout and home tiles. Saved to their login.
CREATE TABLE user_prefs (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  theme      TEXT NOT NULL DEFAULT 'ronchi',
  mode       TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','light','dark')),
  layout     TEXT NOT NULL DEFAULT 'L2',
  tiles      TEXT,   -- JSON list
  updated_at TEXT NOT NULL
);

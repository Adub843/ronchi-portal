-- Ronchi Parts store (parts-db). CUSTOMER SIDE: the customer parts catalog at parts.ronchiamerica.com.
--
-- What is here: each customer company's own logins and machine numbers, the published catalog of
-- those machines (drawings, parts lists, part names), and the carts, lists and quote requests
-- customers make. What is never here: other customers' names or sites, service history, staff,
-- staff notes, prices, orders, or anything else from the business store (portal-db).
-- Catalog data only arrives by Publish from the staff portal (src/parts/routes/admin.ts).

-- A customer company. Its people only ever see the machines listed in company_machines.
CREATE TABLE companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,           -- shown to that company's own people only
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Customer logins. standard = finds parts and builds carts and lists; buyer = also sends quote requests.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('standard','buyer')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX users_company ON users(company_id);

CREATE TABLE invites (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  email       TEXT NOT NULL COLLATE NOCASE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('standard','buyer')),
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  user_id     TEXT                      -- set for "add another device" links
);

CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  public_key   TEXT NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys(user_id);

CREATE TABLE auth_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register','login')),
  invite_id  TEXT,
  expires_at TEXT NOT NULL
);

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

-- Append-only record of sign-ins, quote requests and staff publishing.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT,
  company_id  TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  ip          TEXT
);
CREATE INDEX audit_at ON audit_log(at);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

-- Published machines: serial and model only.
CREATE TABLE machines (
  serial       TEXT PRIMARY KEY COLLATE NOCASE,
  model        TEXT,
  published_at TEXT NOT NULL
);

-- Which machines each company owns. THE access rule: a person sees a machine only through this table.
CREATE TABLE company_machines (
  company_id  TEXT NOT NULL REFERENCES companies(id),
  serial      TEXT NOT NULL COLLATE NOCASE,
  label       TEXT,                    -- the company's own name for it, for example "Line 1 filler"
  added_at    TEXT NOT NULL,
  PRIMARY KEY (company_id, serial)
);
CREATE INDEX company_machines_serial ON company_machines(serial);

CREATE TABLE parts (
  code     TEXT PRIMARY KEY COLLATE NOCASE,
  rev      TEXT,
  name_en  TEXT NOT NULL DEFAULT '',
  name_it  TEXT NOT NULL DEFAULT '',
  maker    TEXT,
  maker_pn TEXT,
  wear     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sheets (
  id          TEXT PRIMARY KEY,          -- same id as on the staff side
  serial      TEXT NOT NULL COLLATE NOCASE REFERENCES machines(serial),
  parent_id   TEXT,
  section     TEXT NOT NULL CHECK (section IN ('machine','format','elevator','kit')),
  grp         TEXT,
  code        TEXT,
  rev         TEXT,
  title       TEXT NOT NULL DEFAULT '',
  title_it    TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  image_w     INTEGER,
  image_h     INTEGER,
  model_size  INTEGER,
  mesh_map    TEXT
);
CREATE INDEX sheets_serial ON sheets(serial, sort);

CREATE TABLE sheet_rows (
  id        TEXT PRIMARY KEY,
  sheet_id  TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  pos       TEXT NOT NULL DEFAULT '',
  code      TEXT NOT NULL COLLATE NOCASE,
  qty       REAL,
  unit      TEXT,
  hotspots  TEXT,
  sort      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sheet_rows_sheet ON sheet_rows(sheet_id, sort);
CREATE INDEX sheet_rows_code ON sheet_rows(code);

-- Carts belong to one person. One cart per person is "active": Add to cart puts parts there.
CREATE TABLE carts (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX carts_user ON carts(user_id, updated_at);

-- Lists are shared with everyone in the company (so a technician can hand one to the buyer).
CREATE TABLE lists (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX lists_company ON lists(company_id, updated_at);

-- Quote requests to Ronchi America. Staff read them from the portal and answer by email.
CREATE TABLE quotes (
  id          TEXT PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,        -- RQ-261124-04821 (date, then random)
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  email       TEXT NOT NULL,               -- where the quote goes
  notes       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','received','quoted','closed')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX quotes_company ON quotes(company_id, created_at);
CREATE INDEX quotes_status ON quotes(status, created_at);

-- The lines of a cart, list or quote. Exactly one owner column is set.
-- code is a catalog part; description is for parts not in the catalog (typed by hand).
CREATE TABLE lines (
  id          TEXT PRIMARY KEY,
  cart_id     TEXT REFERENCES carts(id) ON DELETE CASCADE,
  list_id     TEXT REFERENCES lists(id) ON DELETE CASCADE,
  quote_id    TEXT REFERENCES quotes(id),
  code        TEXT COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  qty         REAL NOT NULL CHECK (qty > 0),
  serial      TEXT,                        -- which of the company's machines it's for
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  CHECK ((cart_id IS NOT NULL) + (list_id IS NOT NULL) + (quote_id IS NOT NULL) = 1),
  CHECK (code IS NOT NULL OR description <> '')
);
CREATE INDEX lines_cart ON lines(cart_id);
CREATE INDEX lines_list ON lines(list_id);
CREATE INDEX lines_quote ON lines(quote_id);

-- Starred machines and drawings, per person.
CREATE TABLE favorites (
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('machine','sheet')),
  ref        TEXT NOT NULL,
  label      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
);

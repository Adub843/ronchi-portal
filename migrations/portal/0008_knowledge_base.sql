-- Knowledge base (Step 2): One Point Lessons, how-tos, known issues, quick notes, reference and training.
-- Staff-side store. Articles marked for customers can be copied one way to the help center
-- (help-db) after the customer-data scan; nothing here is ever readable from the customer side.
CREATE TABLE kb_articles (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- RA-OPL-002, RA-QN-501
  kind         TEXT NOT NULL CHECK (kind IN ('opl','howto','known_issue','quick_note','reference','training','verification')),
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  machine_type TEXT,                    -- Filler, Capper, Controls and HMI...
  category     TEXT,                    -- Mechanical, Electrical, Software, Changeover
  serial       TEXT,                    -- the machine a quick note came from. STAFF ONLY, never published
  issue        TEXT NOT NULL DEFAULT '',
  fix          TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '{}', -- JSON layout: meta, safety, tools, blocks (steps, tables, notes)
  body_text    TEXT NOT NULL DEFAULT '',   -- the layout as plain text, for search and the help center
  audience     TEXT NOT NULL DEFAULT 'internal' CHECK (audience IN ('internal','customer')),
  published_at TEXT,                    -- when it was last copied to the help center
  scan_ok      TEXT NOT NULL DEFAULT '[]', -- words a publisher confirmed are not customer details (JSON list)
  created_by   TEXT REFERENCES users(id),
  updated_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT
);
CREATE INDEX kb_articles_serial ON kb_articles(serial) WHERE serial IS NOT NULL;

CREATE VIRTUAL TABLE kb_fts USING fts5(code, title, summary, issue, fix, body_text, serial, content='kb_articles', content_rowid='rowid', tokenize='porter unicode61');
CREATE TRIGGER kb_ai AFTER INSERT ON kb_articles BEGIN
  INSERT INTO kb_fts(rowid, code, title, summary, issue, fix, body_text, serial) VALUES (new.rowid, new.code, new.title, new.summary, new.issue, new.fix, new.body_text, new.serial);
END;
CREATE TRIGGER kb_ad AFTER DELETE ON kb_articles BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, code, title, summary, issue, fix, body_text, serial) VALUES ('delete', old.rowid, old.code, old.title, old.summary, old.issue, old.fix, old.body_text, old.serial);
END;
CREATE TRIGGER kb_au AFTER UPDATE ON kb_articles BEGIN
  INSERT INTO kb_fts(kb_fts, rowid, code, title, summary, issue, fix, body_text, serial) VALUES ('delete', old.rowid, old.code, old.title, old.summary, old.issue, old.fix, old.body_text, old.serial);
  INSERT INTO kb_fts(rowid, code, title, summary, issue, fix, body_text, serial) VALUES (new.rowid, new.code, new.title, new.summary, new.issue, new.fix, new.body_text, new.serial);
END;

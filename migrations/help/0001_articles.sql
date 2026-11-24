-- Ronchi Help Center store (help-db). CUSTOMER SIDE.
-- Holds ONLY published, customer-safe articles. Nothing else is ever stored here:
-- no customers, sites, machine numbers, staff, orders or hours.
-- Articles arrive by the one-way Publish copy from the portal (Step 2).
CREATE TABLE articles (
  id           TEXT PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,      -- public article number, for example KB-1042
  kind         TEXT NOT NULL CHECK (kind IN ('opl','howto','issue_fix','training')),
  title        TEXT NOT NULL,
  machine_type TEXT,                      -- filler, capper, monoblock... never a serial number
  category     TEXT,
  issue        TEXT NOT NULL DEFAULT '',
  fix          TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',  -- plain text / simple markdown, escaped when shown
  published_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Full-text search over title, issue, fix and body.
CREATE VIRTUAL TABLE articles_fts USING fts5(title, issue, fix, body, content='articles', content_rowid='rowid', tokenize='porter unicode61');
CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, issue, fix, body) VALUES (new.rowid, new.title, new.issue, new.fix, new.body);
END;
CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, issue, fix, body) VALUES ('delete', old.rowid, old.title, old.issue, old.fix, old.body);
END;
CREATE TRIGGER articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, issue, fix, body) VALUES ('delete', old.rowid, old.title, old.issue, old.fix, old.body);
  INSERT INTO articles_fts(rowid, title, issue, fix, body) VALUES (new.rowid, new.title, new.issue, new.fix, new.body);
END;

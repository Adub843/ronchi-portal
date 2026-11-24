-- Private chats, files in chats, per-person chat controls, and language.

-- Private chats (one-to-one or a small group) live in the boards table with kind = 'chat'.
-- Only the people listed in board_members can see a chat. Team boards keep kind = 'board'.
ALTER TABLE boards ADD COLUMN kind TEXT NOT NULL DEFAULT 'board' CHECK (kind IN ('board','chat'));
CREATE TABLE board_members (
  board_id TEXT NOT NULL REFERENCES boards(id),
  user_id  TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_members_user ON board_members(user_id);

-- Photos, documents and other files sent in a chat. The file itself is kept in R2
-- (bucket ronchi-portal-files, key files/<id>); this row says which chat it belongs to,
-- so only people who can see that chat can open it.
CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id),
  post_id    TEXT NOT NULL REFERENCES posts(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,      -- shown name, cleaned (no folders)
  ext        TEXT NOT NULL,      -- decides how it is served (src/shared/files.ts)
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT                -- set when its message is removed; the file is kept for the record
);
CREATE INDEX attachments_post ON attachments(post_id);
CREATE INDEX attachments_board ON attachments(board_id, created_at);

-- Mute a chat: no pop-up alerts for it (unread counts still show).
ALTER TABLE board_reads ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;

-- Announcement-only chats: only the creator and moderators can post.
ALTER TABLE boards ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;

-- Language for the app's screens, and whether new messages pop up on a computer.
ALTER TABLE user_prefs ADD COLUMN lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','es','it'));
ALTER TABLE user_prefs ADD COLUMN popups INTEGER NOT NULL DEFAULT 1;

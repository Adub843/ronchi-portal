-- Chat-style boards: remember when each person last read each board, for unread counts.
CREATE TABLE board_reads (
  user_id      TEXT NOT NULL REFERENCES users(id),
  board_id     TEXT NOT NULL REFERENCES boards(id),
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, board_id)
);

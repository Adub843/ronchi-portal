-- Aaron, 2026-11-24: "i want to be able to remove this and other instructions with a small x after reading".
-- One row per instruction note a person closed. Saved to their login, so a note closed on the
-- computer stays closed on the phone. Settings > "Show tips again" deletes their rows.
CREATE TABLE user_tips (
  user_id   TEXT NOT NULL REFERENCES users(id),
  tip       TEXT NOT NULL,
  hidden_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tip)
);

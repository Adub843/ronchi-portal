-- Username and password sign-in (Aaron, 2026-11-26: "each user to create their own password on
-- their first login this should just be a user name and password log in").
-- Only a salted, slow hash of the password is stored (src/portal/lib/password.ts).
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_set_at TEXT;
-- While this time is in the future and there is no password yet, the person's next sign-in is
-- their first one: they type their username and choose a password. Reset password reopens it.
ALTER TABLE users ADD COLUMN password_setup_until TEXT;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

-- People who already have a login get three days to choose their password.
UPDATE users SET password_setup_until = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+3 days') WHERE status = 'active';

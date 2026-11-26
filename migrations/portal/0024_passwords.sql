-- Username and password sign-in (Aaron, 2026-11-26: "this should just be a user name and password
-- log in", "each user to create their own password on their first login").
-- Only a salted PBKDF2-SHA256 hash is stored (src/shared/password.ts). NULL means the person
-- hasn't made a password yet: their first sign-in asks them to make one.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_set_at TEXT;

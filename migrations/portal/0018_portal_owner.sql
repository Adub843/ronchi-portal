-- Portal command center: one owner (Aaron) sees it and flips every switch.
-- The owner is the first admin (the one made with npm run invite:first-admin). While nobody is the
-- owner (a brand-new portal), every admin counts as the owner, so nobody is ever locked out.
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_owner = 1
 WHERE id = (SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1);

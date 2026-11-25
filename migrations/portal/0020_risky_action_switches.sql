-- Separate switches for risky actions (Command center research, 2026-11-25): exporting chats,
-- publishing catalogs to customers and exporting orders used to come with a broader permission.
-- Roles an admin saved keep doing what they did: give each new switch to the roles that had the old one.
UPDATE roles SET perms = json_insert(perms, '$[#]', 'boards.export')
 WHERE json_valid(perms) AND EXISTS (SELECT 1 FROM json_each(roles.perms) WHERE value = 'boards.use')
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.perms) WHERE value = 'boards.export');
UPDATE roles SET perms = json_insert(perms, '$[#]', 'catalog.publish')
 WHERE json_valid(perms) AND EXISTS (SELECT 1 FROM json_each(roles.perms) WHERE value = 'catalog.edit')
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.perms) WHERE value = 'catalog.publish');
UPDATE roles SET perms = json_insert(perms, '$[#]', 'orders.export')
 WHERE json_valid(perms) AND EXISTS (SELECT 1 FROM json_each(roles.perms) WHERE value = 'orders.view')
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.perms) WHERE value = 'orders.export');
-- Personal changes follow too: someone given catalog.edit personally also gets catalog.publish.
INSERT OR IGNORE INTO user_access (user_id, perm, allow, set_by, set_at, expires_at)
  SELECT user_id, 'catalog.publish', allow, set_by, set_at, expires_at FROM user_access WHERE perm = 'catalog.edit';
INSERT OR IGNORE INTO user_access (user_id, perm, allow, set_by, set_at, expires_at)
  SELECT user_id, 'orders.export', allow, set_by, set_at, expires_at FROM user_access WHERE perm = 'orders.view';
INSERT OR IGNORE INTO user_access (user_id, perm, allow, set_by, set_at, expires_at)
  SELECT user_id, 'boards.export', allow, set_by, set_at, expires_at FROM user_access WHERE perm = 'boards.use';

-- Part pictures and 3D views on the customer parts site, copied from the staff portal by Publish.
-- Only pictures rendered from Ronchi CAD come here: no customer data, no staff notes.
--
-- parts.picture_at: when the part's picture was published (R2 parts/<code>/picture); NULL = none.
-- Served only to companies whose machines use the part.
ALTER TABLE parts ADD COLUMN picture_at TEXT;

-- sheets.views: JSON list of the parts list's 3D views (R2 sheets/<id>/view-<name>).
ALTER TABLE sheets ADD COLUMN views TEXT;

-- Pictures for the parts catalog, rendered in Fusion from CAD (scripts/fusion-renders.mjs) and
-- added by staff on a parts list ("Add Fusion pictures").
--
-- A part's picture belongs to its part code, so it shows on every machine that uses the part.
-- Kept in R2 (bucket ronchi-portal-files) under catalog/parts/<code>/picture. NULL = no picture;
-- otherwise when it was added, which also tells browsers to fetch a new one.
ALTER TABLE catalog_parts ADD COLUMN picture_at TEXT;

-- A parts list's 3D views (JSON list, for example ["iso","front","top","right"]), kept under
-- catalog/<sheet id>/view-<name>. The first one is the parts list's picture in the catalog.
ALTER TABLE catalog_sheets ADD COLUMN views TEXT;

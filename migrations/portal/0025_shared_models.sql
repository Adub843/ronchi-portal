-- One stored 3D model can sit on many parts lists. Ronchi reuses the same assembly on many
-- machines, so the file is kept once (R2 catalog/shared/<sha256>.glb) and each parts list
-- points at it. Models loaded before this stay where they are (model_ref is NULL).
ALTER TABLE catalog_sheets ADD COLUMN model_ref TEXT;
CREATE INDEX idx_catalog_sheets_model_ref ON catalog_sheets(model_ref) WHERE model_ref IS NOT NULL;

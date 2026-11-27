-- A parts list with no drawing of its own shows the drawing of the same assembly from another
-- machine's manual. That lookup is by the assembly's part code.
CREATE INDEX catalog_sheets_code ON catalog_sheets(code) WHERE code IS NOT NULL;

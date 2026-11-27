-- A machine's own software backups (Aaron, 2026-11-27: "i wnat them to be downloadable even if that
-- means a tunnel download through the portal"). A software package with a machine number belongs to
-- that machine: it shows on the machine's page and stays off the general Software shelf.
ALTER TABLE software_packages ADD COLUMN machine TEXT;
CREATE INDEX IF NOT EXISTS software_packages_machine ON software_packages (machine) WHERE machine IS NOT NULL;

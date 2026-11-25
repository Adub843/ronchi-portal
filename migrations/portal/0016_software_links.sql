-- Software kept on SharePoint (Aaron, 2026-11-25: "we dont have to store the software ... tunnel that
-- file from share point for now till we upgrade storage"). A file with a source_url is a link:
-- Download sends the person to SharePoint and nothing is kept in the portal's bucket.
ALTER TABLE software_files ADD COLUMN source_url TEXT;

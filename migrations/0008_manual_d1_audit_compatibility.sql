-- Compatibility repair for the manually initialized development D1 database.
-- The initial tables were created in the dashboard with slightly different audit column names.
-- Add the column names used by the current Pages Functions without deleting existing audit data.
ALTER TABLE audit_events ADD COLUMN object_type TEXT;
ALTER TABLE audit_events ADD COLUMN object_id TEXT;

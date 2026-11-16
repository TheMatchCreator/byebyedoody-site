-- Compatibility repair for the manually initialized development D1 database.
-- The owner created several foundation tables manually with a few different column names.
-- Add the current application column names without deleting the original values.
-- Run exactly once, after migrations 0002-0007.

ALTER TABLE audit_events ADD COLUMN object_type TEXT;
ALTER TABLE audit_events ADD COLUMN object_id TEXT;

ALTER TABLE location_events ADD COLUMN accuracy_m REAL;
ALTER TABLE location_events ADD COLUMN captured_at TEXT;
ALTER TABLE location_events ADD COLUMN retention_until TEXT;

ALTER TABLE agreement_acceptances ADD COLUMN agreement_key TEXT;
ALTER TABLE agreement_acceptances ADD COLUMN ip_truncated TEXT;
ALTER TABLE agreement_acceptances ADD COLUMN user_agent_summary TEXT;

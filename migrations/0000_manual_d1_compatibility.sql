-- One-time compatibility repair for this owner's manually initialized development D1 database.
-- This must run BEFORE 0001 because the original manual location_events table
-- does not yet contain retention_until, which 0001 indexes.
-- This file is specific to the already-created byebyedoody-marketplace-dev database.

ALTER TABLE audit_events ADD COLUMN object_type TEXT;
ALTER TABLE audit_events ADD COLUMN object_id TEXT;

ALTER TABLE location_events ADD COLUMN accuracy_m REAL;
ALTER TABLE location_events ADD COLUMN captured_at TEXT;
ALTER TABLE location_events ADD COLUMN retention_until TEXT;

ALTER TABLE agreement_acceptances ADD COLUMN agreement_key TEXT;
ALTER TABLE agreement_acceptances ADD COLUMN ip_truncated TEXT;
ALTER TABLE agreement_acceptances ADD COLUMN user_agent_summary TEXT;

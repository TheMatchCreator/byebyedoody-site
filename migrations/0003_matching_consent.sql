-- ByeByeDoody explicit consent for opt-in referral matching.
-- Apply after migrations 0001 and 0002 in a non-production D1 database.
ALTER TABLE service_requests ADD COLUMN matching_consent_at TEXT;
ALTER TABLE service_requests ADD COLUMN matching_consent_version TEXT;
CREATE INDEX IF NOT EXISTS idx_requests_matching_consent
  ON service_requests(status, service_zip, matching_consent_at);

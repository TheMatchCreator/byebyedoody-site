-- ByeByeDoody 0009: provider job alerts, AI price suggestions on quotes, job progress for
-- permission-based location sharing (only while a provider chooses to share during a paid job).
-- Consent records use location_consents from 0001; points live in job_location_points (0010).

ALTER TABLE provider_profiles ADD COLUMN job_alerts_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_profiles ADD COLUMN alert_email_ciphertext TEXT;
ALTER TABLE provider_profiles ADD COLUMN job_alerts_updated_at TEXT;

ALTER TABLE referrals ADD COLUMN on_the_way_at TEXT;
ALTER TABLE referrals ADD COLUMN arrived_at TEXT;
ALTER TABLE referrals ADD COLUMN completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_location_events_referral ON location_events(referral_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_location_events_retention ON location_events(retention_until);
CREATE INDEX IF NOT EXISTS idx_location_consents_referral ON location_consents(referral_id, user_id);
CREATE INDEX IF NOT EXISTS idx_service_areas_zip ON provider_service_areas(zip_code, active);

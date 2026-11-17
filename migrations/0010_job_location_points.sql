-- ByeByeDoody 0010: dedicated table for optional, job-only provider location points.
-- (Some databases were initialized with an older location_events layout, so job tracking uses its own table.)
-- Points exist only while a provider chooses to share during a paid job and are deleted after 7 days.
CREATE TABLE IF NOT EXISTS job_location_points (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m REAL,
  captured_at TEXT NOT NULL,
  retention_until TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_location_points_referral ON job_location_points(referral_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_job_location_points_retention ON job_location_points(retention_until);

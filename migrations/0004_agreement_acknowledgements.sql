-- ByeByeDoody legal-draft acknowledgement tracking.
-- Acknowledging receipt of a draft is not acceptance of a contract or waiver.
-- Apply after migrations 0001, 0002, and 0003 in a non-production D1 database.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agreement_acknowledgements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  agreement_key TEXT NOT NULL CHECK (agreement_key IN ('customer_referral_draft','provider_referral_draft')),
  agreement_version TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, agreement_key, agreement_version)
);

CREATE INDEX IF NOT EXISTS idx_agreement_ack_user
  ON agreement_acknowledgements(user_id, acknowledged_at);

-- ByeByeDoody referral invitation workflow (D1 / SQLite)
-- Apply after migrations 0001 and 0002 in a non-production database.
-- This records a customer-selected quote and a provider's response only.
-- It does not create a booking, charge, payout, work assignment, or dispatch.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS referral_invitations (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES provider_quotes(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES app_users(id),
  provider_id TEXT NOT NULL REFERENCES provider_profiles(user_id),
  status TEXT NOT NULL DEFAULT 'awaiting_provider'
    CHECK (status IN ('awaiting_provider','accepted_by_provider','declined_by_provider','cancelled_by_customer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TEXT,
  UNIQUE(quote_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_invitations_customer
  ON referral_invitations(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_invitations_provider
  ON referral_invitations(provider_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_invitation_per_request
  ON referral_invitations(request_id)
  WHERE status = 'awaiting_provider';

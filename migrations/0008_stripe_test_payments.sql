-- Stripe Connect (TEST MODE) payments, owner-approved 2026-11-16.
-- Fee: platform fee = 20% of the customer total; provider receives their full rate.
-- Replaces the unused draft `referrals` table, whose CHECK constraints hard-coded a 25% fee.
-- No code ever wrote to that table; the setup script refuses to run this file if it holds rows.
PRAGMA defer_foreign_keys = true;

DROP TABLE IF EXISTS referrals;

CREATE TABLE referrals (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES referral_invitations(id),
  request_id TEXT NOT NULL REFERENCES service_requests(id),
  quote_id TEXT NOT NULL REFERENCES provider_quotes(id),
  customer_id TEXT NOT NULL REFERENCES app_users(id),
  provider_id TEXT NOT NULL REFERENCES provider_profiles(user_id),
  customer_total_cents INTEGER NOT NULL CHECK (customer_total_cents > 0),
  provider_rate_cents INTEGER NOT NULL CHECK (provider_rate_cents > 0),
  platform_fee_cents INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
  platform_fee_rate_basis_points INTEGER NOT NULL DEFAULT 2000 CHECK (platform_fee_rate_basis_points = 2000),
  fee_disclosure_version TEXT NOT NULL,
  customer_fee_acknowledged_at TEXT NOT NULL,
  provider_rate_acknowledged_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'referred' CHECK (status IN ('referred','accepted','in_progress','completed','cancelled','disputed')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','checkout_open','paid','failed','refunded')),
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (customer_total_cents = provider_rate_cents + platform_fee_cents),
  -- total = ceil(rate / 0.8): rate*5 <= total*4 < rate*5 + 4
  CHECK (provider_rate_cents * 5 <= customer_total_cents * 4),
  CHECK (customer_total_cents * 4 < provider_rate_cents * 5 + 4)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_invitation ON referrals(invitation_id);
CREATE INDEX IF NOT EXISTS idx_referrals_customer ON referrals(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_provider ON referrals(provider_id, created_at);

ALTER TABLE provider_profiles ADD COLUMN stripe_account_id TEXT;
ALTER TABLE provider_profiles ADD COLUMN stripe_charges_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_profiles ADD COLUMN stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

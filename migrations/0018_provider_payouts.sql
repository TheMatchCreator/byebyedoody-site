-- ByeByeDoody 0018: pay pros after the work is done (owner request 2026-11-20).
-- New checkouts charge the customer on the ByeByeDoody platform account (no instant transfer).
-- The pro's full quoted rate is transferred to their Stripe account when they mark the job "Job done"
-- (Stripe "separate charges and transfers", tied to the original charge with source_transaction).
-- Jobs paid before this change used destination charges and were already paid out; they have no row here.
CREATE TABLE IF NOT EXISTS provider_payouts (
  referral_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment','held','releasing','paid','failed','cancelled')),
  stripe_transfer_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  held_at TEXT,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_provider_payouts_status ON provider_payouts(status);
CREATE INDEX IF NOT EXISTS idx_provider_payouts_provider ON provider_payouts(provider_id, status);

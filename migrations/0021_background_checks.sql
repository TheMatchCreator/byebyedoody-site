-- Background checks for pros through Checkr (owner request 2026-11-23).
-- The pro pays the check fee through Stripe Checkout; Checkr's own hosted form collects the
-- legally required disclosure, consent and the pro's personal details (never this site).
-- A "clear" result approves a waiting application automatically; anything else waits for the owner.
CREATE TABLE IF NOT EXISTS background_checks (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment','paid','invited','expired','in_progress','clear','consider','suspended',
    'canceled','approved','not_approved','refunded','error')),
  fee_cents INTEGER NOT NULL,
  package TEXT,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  checkr_candidate_id TEXT,
  checkr_invitation_id TEXT,
  checkr_invitation_url TEXT,
  checkr_report_id TEXT,
  checkr_result TEXT,
  admin_note TEXT,
  decided_by TEXT REFERENCES app_users(id),
  decided_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_background_checks_provider ON background_checks (provider_id, created_at);
CREATE INDEX IF NOT EXISTS idx_background_checks_candidate ON background_checks (checkr_candidate_id);
CREATE INDEX IF NOT EXISTS idx_background_checks_status ON background_checks (status);
CREATE TABLE IF NOT EXISTS checkr_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ByeByeDoody 0013: repeat bookings (reminders, book again) and referral rewards.
-- Referral credits only reduce ByeByeDoody's own platform fee; providers always get their full rate.
ALTER TABLE customer_profiles ADD COLUMN contact_email_ciphertext TEXT;
ALTER TABLE customer_profiles ADD COLUMN reminders_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_profiles ADD COLUMN referral_code TEXT;
ALTER TABLE customer_profiles ADD COLUMN referred_by_code TEXT;
ALTER TABLE customer_profiles ADD COLUMN credit_cents INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_referral_code ON customer_profiles(referral_code);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id TEXT PRIMARY KEY,
  referrer_id TEXT NOT NULL,
  referee_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','earned','void')),
  amount_cents INTEGER NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  earned_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id, status);

-- Credit applied to a specific checkout; consumed from the customer's balance when payment succeeds.
CREATE TABLE IF NOT EXISTS checkout_credits (
  referral_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  credit_cents INTEGER NOT NULL CHECK (credit_cents >= 0),
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rebook_reminders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  due_at TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id)
);
CREATE INDEX IF NOT EXISTS idx_rebook_due ON rebook_reminders(sent_at, due_at);

-- One-time tokens the scheduled reminder job uses to call the site.
CREATE TABLE IF NOT EXISTS cron_nonces (
  nonce TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

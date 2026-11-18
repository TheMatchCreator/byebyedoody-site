-- Owner request 2026-11-18: ByeByeDoody's platform fee goes from 20% to 15% of the customer total.
-- The provider still receives their full rate; total = ceil(rate / (1 - fee rate)).
--
-- 0008 hard-coded 20% in the referrals CHECK constraints, so the table is rebuilt with checks
-- that accept any fee rate from 0% to 50% while still enforcing:
--   total = provider rate + platform fee, and total = ceil(rate * 10000 / (10000 - basis points)).
-- Rows already paid at 20% (2000 basis points) satisfy the new checks unchanged.
--
-- Safe rebuild on D1 (foreign keys are enforced; defer_foreign_keys does not stop ON DELETE actions):
-- rows that DROP TABLE would cascade-delete (job_events, location_consents, location_events) or
-- null out (notification_events.referral_id) are copied aside first and put back afterwards.
-- The table is recreated under the same name before its rows are re-inserted, so deferred
-- foreign-key checks from payment_ledger and service_issues are satisfied again before commit.
PRAGMA defer_foreign_keys = true;

CREATE TABLE bk_fee_referrals AS SELECT * FROM referrals;
CREATE TABLE bk_fee_job_events AS SELECT * FROM job_events;
CREATE TABLE bk_fee_location_consents AS SELECT * FROM location_consents WHERE referral_id IS NOT NULL;
CREATE TABLE bk_fee_location_events AS SELECT * FROM location_events;
CREATE TABLE bk_fee_notification_links AS SELECT id, referral_id FROM notification_events WHERE referral_id IS NOT NULL;

DROP TABLE referrals;

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
  platform_fee_rate_basis_points INTEGER NOT NULL DEFAULT 1500 CHECK (platform_fee_rate_basis_points BETWEEN 0 AND 5000),
  fee_disclosure_version TEXT NOT NULL,
  customer_fee_acknowledged_at TEXT NOT NULL,
  provider_rate_acknowledged_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'referred' CHECK (status IN ('referred','accepted','in_progress','completed','cancelled','disputed')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','checkout_open','paid','failed','refunded')),
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  on_the_way_at TEXT,
  arrived_at TEXT,
  completed_at TEXT,
  CHECK (customer_total_cents = provider_rate_cents + platform_fee_cents),
  -- total = ceil(rate / (1 - bp/10000)):  rate*10000 <= total*(10000-bp) < rate*10000 + (10000-bp)
  CHECK (provider_rate_cents * 10000 <= customer_total_cents * (10000 - platform_fee_rate_basis_points)),
  CHECK (customer_total_cents * (10000 - platform_fee_rate_basis_points) < provider_rate_cents * 10000 + (10000 - platform_fee_rate_basis_points))
);

INSERT INTO referrals (id, invitation_id, request_id, quote_id, customer_id, provider_id,
    customer_total_cents, provider_rate_cents, platform_fee_cents, platform_fee_rate_basis_points,
    fee_disclosure_version, customer_fee_acknowledged_at, provider_rate_acknowledged_at, status,
    payment_status, stripe_checkout_session_id, stripe_payment_intent_id, paid_at, created_at,
    on_the_way_at, arrived_at, completed_at)
  SELECT id, invitation_id, request_id, quote_id, customer_id, provider_id,
    customer_total_cents, provider_rate_cents, platform_fee_cents, platform_fee_rate_basis_points,
    fee_disclosure_version, customer_fee_acknowledged_at, provider_rate_acknowledged_at, status,
    payment_status, stripe_checkout_session_id, stripe_payment_intent_id, paid_at, created_at,
    on_the_way_at, arrived_at, completed_at
  FROM bk_fee_referrals;

INSERT INTO job_events SELECT * FROM bk_fee_job_events WHERE id NOT IN (SELECT id FROM job_events);
INSERT INTO location_consents SELECT * FROM bk_fee_location_consents WHERE id NOT IN (SELECT id FROM location_consents);
INSERT INTO location_events SELECT * FROM bk_fee_location_events WHERE id NOT IN (SELECT id FROM location_events);
UPDATE notification_events
   SET referral_id = (SELECT b.referral_id FROM bk_fee_notification_links b WHERE b.id = notification_events.id)
 WHERE referral_id IS NULL AND id IN (SELECT id FROM bk_fee_notification_links);

DROP TABLE bk_fee_referrals;
DROP TABLE bk_fee_job_events;
DROP TABLE bk_fee_location_consents;
DROP TABLE bk_fee_location_events;
DROP TABLE bk_fee_notification_links;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_invitation ON referrals(invitation_id);
CREATE INDEX IF NOT EXISTS idx_referrals_customer ON referrals(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_provider ON referrals(provider_id, created_at);

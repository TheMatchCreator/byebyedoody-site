-- ByeByeDoody marketplace expansion (D1 / SQLite)
-- Apply only after reviewing 0001 and creating a non-production D1 database.
-- This migration stores application metadata only. Do not store identity images,
-- SSNs, payment-card data, bank credentials, or unencrypted service addresses here.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  display_name TEXT,
  preferred_contact_method TEXT NOT NULL DEFAULT 'email'
    CHECK (preferred_contact_method IN ('email','phone')),
  marketing_opt_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  nickname TEXT,
  service_zip TEXT NOT NULL CHECK (length(service_zip) = 5),
  address_ciphertext TEXT NOT NULL,
  access_notes_ciphertext TEXT,
  animal_safety_notes_ciphertext TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_properties_customer_active
  ON properties(customer_id, active);

CREATE TABLE IF NOT EXISTS provider_availability (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','unavailable','withdrawn')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_provider_availability_window
  ON provider_availability(provider_id, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS provider_document_metadata (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  document_type TEXT NOT NULL
    CHECK (document_type IN ('business_registration','insurance_certificate','other')),
  storage_object_key TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected','expired')),
  expires_at TEXT,
  reviewed_by TEXT REFERENCES app_users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Upload bytes must live in a private object store with short-lived access.
-- Do not permit arbitrary public URLs or place identity documents in email.

CREATE TABLE IF NOT EXISTS payment_ledger (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL REFERENCES referrals(id),
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('customer_charge','platform_fee','provider_transfer','refund','adjustment')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  processor TEXT NOT NULL DEFAULT 'stripe' CHECK (processor = 'stripe'),
  processor_object_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','succeeded','failed','reversed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(processor, processor_object_id, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_payment_ledger_referral
  ON payment_ledger(referral_id, created_at);

CREATE TABLE IF NOT EXISTS service_issues (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL REFERENCES referrals(id),
  opened_by TEXT NOT NULL REFERENCES app_users(id),
  issue_type TEXT NOT NULL
    CHECK (issue_type IN ('service_quality','property_access','animal_safety','payment','late_or_missed','other')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','resolved','closed')),
  resolution_summary TEXT,
  resolved_by TEXT REFERENCES app_users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_issues_status
  ON service_issues(status, created_at);

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
  referral_id TEXT REFERENCES referrals(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','in_app')),
  template_key TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (delivery_status IN ('queued','sent','delivered','failed','cancelled')),
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_events_user
  ON notification_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('access','correction','deletion','location_revocation')),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','verifying','in_progress','completed','denied')),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_status
  ON privacy_requests(status, received_at);

-- Prevent duplicate active quotes from the same provider for the same request,
-- including concurrent submissions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_one_active_per_provider_request
  ON provider_quotes(request_id, provider_id)
  WHERE status IN ('offered','accepted_by_customer');

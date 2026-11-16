-- ByeByeDoody marketplace foundation (D1 / SQLite)
-- Schema only. Not deployed or connected to production.
-- Auth identities must be issued by a managed authentication provider.
-- Never store passwords, SSNs, government-ID images, card data, or bank credentials here.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY, -- opaque subject from managed auth provider
  role TEXT NOT NULL CHECK (role IN ('customer','provider','admin')),
  email_verified_at TEXT,
  phone_verified_at TEXT,
  account_status TEXT NOT NULL DEFAULT 'pending' CHECK (account_status IN ('pending','active','suspended','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  independent_business_name TEXT NOT NULL,
  business_registration_attested INTEGER NOT NULL DEFAULT 0 CHECK (business_registration_attested IN (0,1)),
  own_tools_attested INTEGER NOT NULL DEFAULT 0 CHECK (own_tools_attested IN (0,1)),
  independent_clients_attested INTEGER NOT NULL DEFAULT 0 CHECK (independent_clients_attested IN (0,1)),
  provider_sets_rates_attested INTEGER NOT NULL DEFAULT 0 CHECK (provider_sets_rates_attested IN (0,1)),
  provider_sets_hours_attested INTEGER NOT NULL DEFAULT 0 CHECK (provider_sets_hours_attested IN (0,1)),
  accepts_or_rejects_freely_attested INTEGER NOT NULL DEFAULT 0 CHECK (accepts_or_rejects_freely_attested IN (0,1)),
  onboarding_status TEXT NOT NULL DEFAULT 'incomplete' CHECK (onboarding_status IN ('incomplete','submitted','under_review','approved','rejected','suspended')),
  reviewed_by TEXT REFERENCES app_users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_service_areas (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  zip_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(provider_id, zip_code)
);

CREATE TABLE IF NOT EXISTS service_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES app_users(id),
  service_zip TEXT NOT NULL,
  service_address_ciphertext TEXT, -- encrypt in application; avoid exposing to unassigned providers
  service_type TEXT NOT NULL CHECK (service_type IN ('one_time','weekly','twice_weekly','custom')),
  dog_count INTEGER NOT NULL CHECK (dog_count > 0),
  yard_size TEXT NOT NULL CHECK (yard_size IN ('small','medium','large','unknown')),
  scope_notes_ciphertext TEXT,
  requested_window_start TEXT,
  requested_window_end TEXT,
  waste_handling_mode TEXT NOT NULL DEFAULT 'customer_container' CHECK (waste_handling_mode IN ('customer_container','authorized_hauler','unresolved')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','quoted','open_for_referral','matched','in_progress','completed','cancelled','disputed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_quotes (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES provider_profiles(user_id),
  provider_service_rate_cents INTEGER NOT NULL CHECK (provider_service_rate_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  terms_summary TEXT,
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted_by_customer','declined','expired','withdrawn')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id),
  quote_id TEXT NOT NULL REFERENCES provider_quotes(id),
  customer_id TEXT NOT NULL REFERENCES app_users(id),
  provider_id TEXT NOT NULL REFERENCES provider_profiles(user_id),
  customer_total_cents INTEGER NOT NULL CHECK (customer_total_cents > 0),
  provider_rate_cents INTEGER NOT NULL CHECK (provider_rate_cents > 0),
  platform_fee_cents INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
  platform_fee_rate_basis_points INTEGER NOT NULL DEFAULT 2500 CHECK (platform_fee_rate_basis_points = 2500),
  fee_disclosure_version TEXT NOT NULL,
  customer_fee_acknowledged_at TEXT NOT NULL,
  provider_rate_acknowledged_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'referred' CHECK (status IN ('referred','accepted','in_progress','completed','cancelled','disputed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (customer_total_cents = provider_rate_cents + platform_fee_cents),
  CHECK (platform_fee_cents * 4 = customer_total_cents)
);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES app_users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('provider_accepted','provider_declined','arrival_confirmed','work_started','work_completed','customer_confirmed','issue_reported','cancelled')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS location_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  referral_id TEXT REFERENCES referrals(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS location_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  referral_id TEXT NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  captured_at TEXT NOT NULL,
  retention_until TEXT NOT NULL,
  CHECK (latitude BETWEEN -90 AND 90),
  CHECK (longitude BETWEEN -180 AND 180)
);

CREATE TABLE IF NOT EXISTS agreement_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  agreement_key TEXT NOT NULL,
  agreement_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  ip_truncated TEXT,
  user_agent_summary TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES app_users(id),
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_requests_status_zip ON service_requests(status, service_zip);
CREATE INDEX IF NOT EXISTS idx_quotes_provider_status ON provider_quotes(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_provider_status ON referrals(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_location_retention ON location_events(retention_until);

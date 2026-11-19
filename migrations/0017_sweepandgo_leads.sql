-- ByeByeDoody 0017: Sweep&Go lead integration.
-- Leads from the owner's Sweep&Go account (pulled with the Sweep&Go Open API; webhooks only trigger a
-- pull, so a forged webhook cannot create a lead). Contact details are AES-GCM encrypted in the app.
-- In-service-area leads become on-demand "Book now" jobs for approved pros. When a pro accepts, the
-- customer is emailed a one-time link to sign in, confirm and pay (only a SHA-256 hash of it is kept).
CREATE TABLE IF NOT EXISTS sweepandgo_leads (
  id TEXT PRIMARY KEY,
  sg_key TEXT NOT NULL UNIQUE,            -- Sweep&Go lead id (rld_...) or "fq:" + email hash for free quotes
  source TEXT NOT NULL CHECK (source IN ('lead','free_quote')),
  sg_type TEXT,
  sg_status TEXT,
  in_service_area INTEGER NOT NULL DEFAULT 1 CHECK (in_service_area IN (0,1)),
  zip TEXT,
  name_ciphertext TEXT,
  email_ciphertext TEXT,
  email_hash TEXT,
  phone_ciphertext TEXT,
  address_ciphertext TEXT,
  dog_count INTEGER,
  service_type TEXT CHECK (service_type IS NULL OR service_type IN ('one_time','weekly','twice_weekly','custom')),
  marketing_allowed INTEGER,
  baseline INTEGER NOT NULL DEFAULT 0 CHECK (baseline IN (0,1)),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','sent_to_pros','customer_emailed','needs_contact','claimed','skipped','error')),
  status_note TEXT,
  request_id TEXT,
  placeholder_user_id TEXT,
  claim_token_hash TEXT,
  claim_expires_at TEXT,
  claimed_by TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  customer_emailed_at TEXT,
  claimed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sg_leads_status ON sweepandgo_leads(status, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_sg_leads_request ON sweepandgo_leads(request_id);
CREATE INDEX IF NOT EXISTS idx_sg_leads_email ON sweepandgo_leads(email_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sg_leads_claim ON sweepandgo_leads(claim_token_hash) WHERE claim_token_hash IS NOT NULL;

-- Webhook deliveries received (event type only; no payload or personal data is stored).
CREATE TABLE IF NOT EXISTS sweepandgo_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sg_events_received ON sweepandgo_events(received_at);

-- Small key/value store for integration state (last sync time and result, baseline flag, sync lock).
CREATE TABLE IF NOT EXISTS integration_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

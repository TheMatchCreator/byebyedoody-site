-- ByeByeDoody 0012: on-demand "Book now" jobs and providers' "Go live" status.
-- A customer may post a job at an up-front AI price; approved providers who serve that ZIP see it
-- live and the first one who CHOOSES to accept gets it. Nobody is assigned work or penalized.
ALTER TABLE service_requests ADD COLUMN booking_mode TEXT NOT NULL DEFAULT 'quotes';
ALTER TABLE service_requests ADD COLUMN instant_rate_cents INTEGER;
ALTER TABLE service_requests ADD COLUMN instant_provider_id TEXT;
ALTER TABLE service_requests ADD COLUMN instant_accepted_at TEXT;
ALTER TABLE provider_profiles ADD COLUMN live_until TEXT;
CREATE INDEX IF NOT EXISTS idx_requests_instant_open ON service_requests(booking_mode, instant_accepted_at, service_zip);

-- ByeByeDoody 0019: both sides confirm the job is done before the pro is paid (owner request 2026-11-20).
-- Pro taps "Job done" -> the customer has 1 hour to confirm or report a problem. No answer in 1 hour
-- counts as confirmed and the payout is released. A reported problem holds the payout for admin review.
ALTER TABLE provider_payouts ADD COLUMN pro_done_at TEXT;
ALTER TABLE provider_payouts ADD COLUMN auto_release_at TEXT;
ALTER TABLE provider_payouts ADD COLUMN customer_confirmed_at TEXT;
ALTER TABLE provider_payouts ADD COLUMN disputed_at TEXT;
ALTER TABLE provider_payouts ADD COLUMN dispute_note_ciphertext TEXT;
ALTER TABLE provider_payouts ADD COLUMN resolved_at TEXT;
ALTER TABLE provider_payouts ADD COLUMN resolution TEXT;
ALTER TABLE provider_payouts ADD COLUMN customer_email_ciphertext TEXT;
CREATE INDEX IF NOT EXISTS idx_provider_payouts_release ON provider_payouts(status, auto_release_at);

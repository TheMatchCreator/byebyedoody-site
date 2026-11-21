-- ByeByeDoody 0020: AI suggestion for disputed payouts (owner decides; the AI only advises).
ALTER TABLE provider_payouts ADD COLUMN ai_review_json TEXT;
ALTER TABLE provider_payouts ADD COLUMN ai_review_at TEXT;

-- ByeByeDoody 0011: provider-controlled AI auto-quote.
-- A provider may opt in to have their own AI-suggested price (plus their own adjustment) sent
-- automatically as a quote on new requests in their ZIP codes. They can turn it off or withdraw
-- any quote at any time; ByeByeDoody never assigns work.
ALTER TABLE provider_profiles ADD COLUMN auto_quote_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_profiles ADD COLUMN auto_quote_adjust_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_profiles ADD COLUMN auto_quote_terms TEXT;
ALTER TABLE provider_profiles ADD COLUMN auto_quote_updated_at TEXT;
ALTER TABLE provider_quotes ADD COLUMN quote_source TEXT NOT NULL DEFAULT 'manual';

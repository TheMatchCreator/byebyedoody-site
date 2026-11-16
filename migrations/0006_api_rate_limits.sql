-- Per-account API rate limits for marketplace write operations.
-- One compact row per account/route bucket; counters reset by fixed UTC windows.
-- No IP addresses, email addresses, or request bodies are stored.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

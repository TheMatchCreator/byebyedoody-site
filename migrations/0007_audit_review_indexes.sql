-- Efficient retrieval for administrator audit review.
CREATE INDEX IF NOT EXISTS idx_audit_events_created
  ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON audit_events(actor_id, created_at DESC);

-- In-app notification read state. Apply after migrations 0001-0004.
PRAGMA foreign_keys = ON;
ALTER TABLE notification_events ADD COLUMN read_at TEXT;
CREATE INDEX IF NOT EXISTS idx_notification_unread
  ON notification_events(user_id, read_at, created_at);

ALTER TABLE participants ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_participants_deleted_at ON participants(deleted_at);

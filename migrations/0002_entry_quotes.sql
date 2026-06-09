ALTER TABLE entries ADD COLUMN current_price REAL CHECK (current_price IS NULL OR current_price > 0);
ALTER TABLE entries ADD COLUMN current_price_at TEXT;
ALTER TABLE entries ADD COLUMN current_price_source TEXT;
ALTER TABLE entries ADD COLUMN current_price_symbol TEXT;
ALTER TABLE entries ADD COLUMN current_return_percent REAL;
ALTER TABLE entries ADD COLUMN current_price_error TEXT;

CREATE INDEX IF NOT EXISTS idx_entries_current_price_at ON entries(current_price_at);

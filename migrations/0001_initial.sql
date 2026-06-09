PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  memo TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contest_months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'finalized')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL REFERENCES contest_months(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  stock_name TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  buy_date TEXT NOT NULL,
  buy_close REAL NOT NULL CHECK (buy_close > 0),
  end_close REAL CHECK (end_close IS NULL OR end_close > 0),
  sell_date TEXT,
  sell_close REAL CHECK (sell_close IS NULL OR sell_close > 0),
  idea_memo TEXT NOT NULL DEFAULT '',
  final_exit_date TEXT,
  final_exit_close REAL CHECK (final_exit_close IS NULL OR final_exit_close > 0),
  final_return_percent REAL,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (month_id, participant_id),
  CHECK (
    (sell_date IS NULL AND sell_close IS NULL)
    OR (sell_date IS NOT NULL AND sell_close IS NOT NULL)
  ),
  CHECK (
    (finalized_at IS NULL AND final_exit_date IS NULL AND final_exit_close IS NULL AND final_return_percent IS NULL)
    OR (finalized_at IS NOT NULL AND final_exit_date IS NOT NULL AND final_exit_close IS NOT NULL AND final_return_percent IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_entries_month_id ON entries(month_id);
CREATE INDEX IF NOT EXISTS idx_entries_participant_id ON entries(participant_id);
CREATE INDEX IF NOT EXISTS idx_entries_finalized_at ON entries(finalized_at);

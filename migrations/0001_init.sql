-- Disposable inbox schema. Timestamps are Unix epoch milliseconds.

CREATE TABLE IF NOT EXISTS inboxes (
  address    TEXT PRIMARY KEY,          -- full address, lowercase, e.g. seller1@example.com
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL           -- created_at + 24h
);

CREATE INDEX IF NOT EXISTS idx_inboxes_expires_at ON inboxes (expires_at);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  address      TEXT NOT NULL REFERENCES inboxes (address) ON DELETE CASCADE,
  from_address TEXT,
  subject      TEXT,
  text_body    TEXT,
  html_body    TEXT,
  otp_code     TEXT,
  received_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_address_received_at ON messages (address, received_at DESC);

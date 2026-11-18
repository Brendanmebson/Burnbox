-- Burnbox schema for Postgres (Supabase). Timestamps are Unix epoch milliseconds (BIGINT).
-- Run once on a new database: `npm run db:migrate`, or paste into the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,      -- lowercase
  name          TEXT,
  password_hash TEXT NOT NULL,             -- "pbkdf2$<iterations>$<salt>$<hash>", or "env" for the admin
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  trial_ends_at BIGINT NOT NULL,
  pro_until     BIGINT,                    -- paid access until this time; set by the admin
  disabled      INTEGER NOT NULL DEFAULT 0,
  country       TEXT,                      -- two-letter country at signup, from Vercel's geolocation
  created_at    BIGINT NOT NULL,
  last_login_at BIGINT
);

-- Only a SHA-256 of the session token is stored, so a database leak can't be replayed as a login.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS inboxes (
  address    TEXT PRIMARY KEY,             -- full address, lowercase, e.g. seller1@example.com
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,              -- created_at + 24h
  user_id    BIGINT REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inboxes_expires_at ON inboxes (expires_at);
CREATE INDEX IF NOT EXISTS idx_inboxes_user_expires ON inboxes (user_id, expires_at);

CREATE TABLE IF NOT EXISTS messages (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address      TEXT NOT NULL REFERENCES inboxes (address) ON DELETE CASCADE,
  from_address TEXT,
  subject      TEXT,
  text_body    TEXT,
  html_body    TEXT,
  otp_code     TEXT,
  received_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_address_received_at ON messages (address, received_at DESC);

-- Devices seen at signup or login, used to stop one device making account after account.
-- ip_hash is a salted SHA-256 of the IP address; raw IPs are never stored.
CREATE TABLE IF NOT EXISTS devices (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT REFERENCES users (id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('signup', 'login')),
  device_id   TEXT,
  fingerprint TEXT,
  ip_hash     TEXT,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices (device_id);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint_ip ON devices (fingerprint, ip_hash);
CREATE INDEX IF NOT EXISTS idx_devices_ip_created ON devices (ip_hash, kind, created_at);

-- Signups that were refused, so the admin page can show how often it happens.
CREATE TABLE IF NOT EXISTS signup_blocks (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reason     TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

-- Supabase exposes tables in the public schema through its REST API. Row Level Security
-- with no policies shuts that door completely. The app connects as the postgres role,
-- which bypasses RLS, so it is unaffected.
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inboxes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_blocks ENABLE ROW LEVEL SECURITY;

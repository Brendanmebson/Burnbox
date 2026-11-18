-- Accounts, sessions, plans and repeat-signup protection.
-- Timestamps are Unix epoch milliseconds.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,      -- lowercase
  name          TEXT,
  password_hash TEXT NOT NULL,             -- "pbkdf2$<iterations>$<salt>$<hash>", or "env" for the admin
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  trial_ends_at INTEGER NOT NULL,
  pro_until     INTEGER,                   -- paid access until this time; set by the admin
  disabled      INTEGER NOT NULL DEFAULT 0,
  country       TEXT,                      -- two-letter country at signup, from Cloudflare
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Only a SHA-256 of the session token is stored, so a database leak can't be replayed as a login.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- Devices seen at signup or login, used to stop one device making account after account.
-- ip_hash is a salted SHA-256 of the IP address; raw IPs are never stored.
CREATE TABLE IF NOT EXISTS devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('signup', 'login')),
  device_id   TEXT,
  fingerprint TEXT,
  ip_hash     TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices (device_id);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint_ip ON devices (fingerprint, ip_hash);
CREATE INDEX IF NOT EXISTS idx_devices_ip_created ON devices (ip_hash, kind, created_at);

-- Signups that were refused, so the admin page can show how often it happens.
CREATE TABLE IF NOT EXISTS signup_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Inboxes now belong to an account. Inboxes created before this migration have no owner
-- and simply expire.
ALTER TABLE inboxes ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_inboxes_user_expires ON inboxes (user_id, expires_at);

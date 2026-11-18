import { SESSION_TTL_MS, SIGNUP_NETWORK_WINDOW_MS, SIGNUPS_PER_NETWORK } from "./config";
import { randomToken, sha256Hex } from "./crypto";
import type { Role, User } from "./types";

const COLUMNS = "id, email, name, role, trial_ends_at, pro_until, disabled, country, created_at, last_login_at";
const U_COLUMNS = COLUMNS.split(", ").map((c) => `u.${c}`).join(", ");

// ---------- Users ----------

export const findUserByEmail = (db: D1Database, email: string) =>
  db.prepare(`SELECT ${COLUMNS}, password_hash FROM users WHERE email = ?`).bind(email).first<User & { password_hash: string }>();

export const getUser = (db: D1Database, id: number) =>
  db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).bind(id).first<User>();

type NewUser = { email: string; name: string | null; passwordHash: string; role: Role; trialEndsAt: number; country: string | null };

/** Returns null if the email is already registered. */
export const createUser = (db: D1Database, u: NewUser) =>
  db
    .prepare(
      `INSERT INTO users (email, name, password_hash, role, trial_ends_at, country, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${COLUMNS}`,
    )
    .bind(u.email, u.name, u.passwordHash, u.role, u.trialEndsAt, u.country, Date.now())
    .first<User>();

/** The admin row is created on first admin sign-in; its password lives in the ADMIN_PASSWORD secret. */
export const upsertAdmin = (db: D1Database, email: string) =>
  db
    .prepare(
      `INSERT INTO users (email, name, password_hash, role, trial_ends_at, created_at)
       VALUES (?1, 'Admin', 'env', 'admin', 0, ?2)
       ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = 'env', disabled = 0
       RETURNING ${COLUMNS}`,
    )
    .bind(email, Date.now())
    .first<User>();

// ---------- Sessions ----------

/** Creates a session and returns the raw token for the cookie. */
export const createSession = async (db: D1Database, userId: number): Promise<string> => {
  const token = randomToken();
  const now = Date.now();
  await db.batch([
    db
      .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(token), userId, now, now + SESSION_TTL_MS),
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, userId),
  ]);
  return token;
};

export const userForSession = async (db: D1Database, token: string) =>
  db
    .prepare(`SELECT ${U_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`)
    .bind(await sha256Hex(token), Date.now())
    .first<User>();

export const deleteSession = async (db: D1Database, token: string) =>
  db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();

// ---------- Devices (repeat-signup protection) ----------

export type DeviceSignals = {
  /** Device IDs from the cookie and from browser storage. Either can be missing or cleared. */
  deviceIds: string[];
  /** Hash of stable browser traits, computed in the browser. */
  fingerprint: string | null;
  /** Salted hash of the IP address. */
  ipHash: string | null;
};

export type BlockReason = "device" | "network";

/**
 * Decides whether a signup looks like a repeat from the same device:
 * - a device ID that already signed up or signed in, or
 * - the same browser fingerprint on the same network as an earlier account, or
 * - too many new accounts from one network recently (offices and shared Wi-Fi get a few).
 */
export const signupBlockReason = async (db: D1Database, s: DeviceSignals): Promise<BlockReason | null> => {
  if (s.deviceIds.length) {
    const placeholders = s.deviceIds.map(() => "?").join(", ");
    const seen = await db
      .prepare(`SELECT 1 FROM devices WHERE device_id IN (${placeholders}) LIMIT 1`)
      .bind(...s.deviceIds)
      .first();
    if (seen) return "device";
  }
  if (s.fingerprint && s.ipHash) {
    const seen = await db
      .prepare("SELECT 1 FROM devices WHERE fingerprint = ? AND ip_hash = ? LIMIT 1")
      .bind(s.fingerprint, s.ipHash)
      .first();
    if (seen) return "device";
  }
  if (s.ipHash) {
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM devices WHERE ip_hash = ? AND kind = 'signup' AND created_at > ?")
      .bind(s.ipHash, Date.now() - SIGNUP_NETWORK_WINDOW_MS)
      .first<{ n: number }>();
    if ((row?.n ?? 0) >= SIGNUPS_PER_NETWORK) return "network";
  }
  return null;
};

export const recordDevice = async (db: D1Database, userId: number, kind: "signup" | "login", s: DeviceSignals) => {
  const now = Date.now();
  const ids = s.deviceIds.length ? s.deviceIds : [null];
  await db.batch(
    ids.map((deviceId) =>
      db
        .prepare("INSERT INTO devices (user_id, kind, device_id, fingerprint, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(userId, kind, deviceId, s.fingerprint, s.ipHash, now),
    ),
  );
};

export const recordBlockedSignup = (db: D1Database, reason: BlockReason) =>
  db.prepare("INSERT INTO signup_blocks (reason, created_at) VALUES (?, ?)").bind(reason, Date.now()).run();

import { SESSION_TTL_MS, SIGNUP_NETWORK_WINDOW_MS, SIGNUPS_PER_NETWORK } from "./config";
import { randomToken, sha256Hex } from "./crypto";
import { db } from "./sql";
import type { Role, User } from "./types";

const COLUMNS = ["id", "email", "name", "role", "trial_ends_at", "pro_until", "disabled", "country", "created_at", "last_login_at"];
const U_COLUMNS = COLUMNS.map((column) => `u.${column}`);

const first = <T>(rows: T[]): T | null => rows[0] ?? null;

// ---------- Users ----------

export const findUserByEmail = async (email: string) => {
  const sql = db();
  return first(await sql<(User & { password_hash: string })[]>`
    SELECT ${sql(COLUMNS)}, password_hash FROM users WHERE email = ${email}`);
};

export const getUser = async (id: number) => {
  const sql = db();
  return first(await sql<User[]>`SELECT ${sql(COLUMNS)} FROM users WHERE id = ${id}`);
};

type NewUser = { email: string; name: string | null; passwordHash: string; role: Role; trialEndsAt: number; country: string | null };

/** Returns null if the email is already registered. */
export const createUser = async (u: NewUser) => {
  const sql = db();
  return first(await sql<User[]>`
    INSERT INTO users (email, name, password_hash, role, trial_ends_at, country, created_at)
    VALUES (${u.email}, ${u.name}, ${u.passwordHash}, ${u.role}, ${u.trialEndsAt}, ${u.country}, ${Date.now()})
    ON CONFLICT (email) DO NOTHING
    RETURNING ${sql(COLUMNS)}`);
};

/** The admin row is created on first admin sign-in; its password lives in the ADMIN_PASSWORD setting. */
export const upsertAdmin = async (email: string) => {
  const sql = db();
  return first(await sql<User[]>`
    INSERT INTO users (email, name, password_hash, role, trial_ends_at, created_at)
    VALUES (${email}, 'Admin', 'env', 'admin', 0, ${Date.now()})
    ON CONFLICT (email) DO UPDATE SET role = 'admin', password_hash = 'env', disabled = 0
    RETURNING ${sql(COLUMNS)}`);
};

// ---------- Sessions ----------

/** Creates a session and returns the raw token for the cookie. */
export const createSession = async (userId: number): Promise<string> => {
  const token = randomToken();
  const id = await sha256Hex(token);
  const now = Date.now();
  await db().begin(async (sql) => {
    await sql`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (${id}, ${userId}, ${now}, ${now + SESSION_TTL_MS})`;
    await sql`UPDATE users SET last_login_at = ${now} WHERE id = ${userId}`;
  });
  return token;
};

export const userForSession = async (token: string) => {
  const sql = db();
  return first(await sql<User[]>`
    SELECT ${sql(U_COLUMNS)} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ${await sha256Hex(token)} AND s.expires_at > ${Date.now()}`);
};

export const deleteSession = async (token: string) => {
  await db()`DELETE FROM sessions WHERE id = ${await sha256Hex(token)}`;
};

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
export const signupBlockReason = async (s: DeviceSignals): Promise<BlockReason | null> => {
  const sql = db();
  if (s.deviceIds.length) {
    const seen = await sql`SELECT 1 FROM devices WHERE device_id IN ${sql(s.deviceIds)} LIMIT 1`;
    if (seen.length) return "device";
  }
  if (s.fingerprint && s.ipHash) {
    const seen = await sql`SELECT 1 FROM devices WHERE fingerprint = ${s.fingerprint} AND ip_hash = ${s.ipHash} LIMIT 1`;
    if (seen.length) return "device";
  }
  if (s.ipHash) {
    const [row] = await sql<{ n: number }[]>`
      SELECT COUNT(*) AS n FROM devices
       WHERE ip_hash = ${s.ipHash} AND kind = 'signup' AND created_at > ${Date.now() - SIGNUP_NETWORK_WINDOW_MS}`;
    if ((row?.n ?? 0) >= SIGNUPS_PER_NETWORK) return "network";
  }
  return null;
};

export const recordDevice = async (userId: number, kind: "signup" | "login", s: DeviceSignals) => {
  const sql = db();
  const now = Date.now();
  const ids = s.deviceIds.length ? s.deviceIds : [null];
  const rows = ids.map((deviceId) => ({
    user_id: userId,
    kind,
    device_id: deviceId,
    fingerprint: s.fingerprint,
    ip_hash: s.ipHash,
    created_at: now,
  }));
  await sql`INSERT INTO devices ${sql(rows)}`;
};

export const recordBlockedSignup = async (reason: BlockReason) => {
  await db()`INSERT INTO signup_blocks (reason, created_at) VALUES (${reason}, ${Date.now()})`;
};

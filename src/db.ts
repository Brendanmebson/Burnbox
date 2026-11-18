import { INBOX_TTL_MS, MAX_MESSAGES_PER_INBOX } from "./config";

export type Inbox = { address: string; created_at: number; expires_at: number };
type OwnedInbox = Inbox & { user_id: number | null };
export type InboxSummary = Inbox & { message_count: number; last_received_at: number | null };
export type MessageSummary = {
  id: number;
  from_address: string | null;
  subject: string | null;
  otp_code: string | null;
  received_at: number;
  snippet: string | null;
};
export type Message = MessageSummary & {
  address: string;
  text_body: string | null;
  html_body: string | null;
};
export type NewMessage = Omit<Message, "id" | "snippet">;

/** Returns the inbox, or null if the address is already taken by an active inbox. */
export const createInbox = async (db: D1Database, address: string, userId: number): Promise<Inbox | null> => {
  const now = Date.now();
  const inbox: Inbox = { address, created_at: now, expires_at: now + INBOX_TTL_MS };
  const results = await db.batch([
    // An expired inbox that the hourly cron hasn't removed yet doesn't block the name.
    db
      .prepare("DELETE FROM messages WHERE address = ?1 AND EXISTS (SELECT 1 FROM inboxes WHERE address = ?1 AND expires_at <= ?2)")
      .bind(address, now),
    db.prepare("DELETE FROM inboxes WHERE address = ? AND expires_at <= ?").bind(address, now),
    db
      .prepare("INSERT INTO inboxes (address, created_at, expires_at, user_id) VALUES (?, ?, ?, ?) ON CONFLICT (address) DO NOTHING")
      .bind(inbox.address, inbox.created_at, inbox.expires_at, userId),
  ]);
  return results[2]?.meta.changes === 1 ? inbox : null;
};

export const listActiveInboxes = async (db: D1Database, userId: number): Promise<InboxSummary[]> => {
  const { results } = await db
    .prepare(
      `SELECT i.address, i.created_at, i.expires_at,
              COUNT(m.id) AS message_count, MAX(m.received_at) AS last_received_at
         FROM inboxes i LEFT JOIN messages m ON m.address = i.address
        WHERE i.user_id = ? AND i.expires_at > ?
        GROUP BY i.address
        ORDER BY i.created_at DESC`,
    )
    .bind(userId, Date.now())
    .all<InboxSummary>();
  return results;
};

/** Any active inbox, whoever owns it. Used when mail arrives. */
export const getActiveInbox = (db: D1Database, address: string): Promise<OwnedInbox | null> =>
  db
    .prepare("SELECT address, created_at, expires_at, user_id FROM inboxes WHERE address = ? AND expires_at > ?")
    .bind(address, Date.now())
    .first<OwnedInbox>();

/** An active inbox, only if it belongs to this user. */
export const getOwnedInbox = (db: D1Database, address: string, userId: number): Promise<Inbox | null> =>
  db
    .prepare("SELECT address, created_at, expires_at FROM inboxes WHERE address = ? AND user_id = ? AND expires_at > ?")
    .bind(address, userId, Date.now())
    .first<Inbox>();

export const countActiveInboxes = async (db: D1Database, userId: number): Promise<number> => {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM inboxes WHERE user_id = ? AND expires_at > ?")
    .bind(userId, Date.now())
    .first<{ n: number }>();
  return row?.n ?? 0;
};

export const deleteInbox = async (db: D1Database, address: string, userId: number): Promise<boolean> => {
  const results = await db.batch([
    db
      .prepare("DELETE FROM messages WHERE address = ?1 AND EXISTS (SELECT 1 FROM inboxes WHERE address = ?1 AND user_id = ?2)")
      .bind(address, userId),
    db.prepare("DELETE FROM inboxes WHERE address = ? AND user_id = ?").bind(address, userId),
  ]);
  return (results[1]?.meta.changes ?? 0) > 0;
};

/** Deletes every inbox and message a user owns. */
export const deleteUserInboxes = (db: D1Database, userId: number) =>
  db.batch([
    db.prepare("DELETE FROM messages WHERE address IN (SELECT address FROM inboxes WHERE user_id = ?)").bind(userId),
    db.prepare("DELETE FROM inboxes WHERE user_id = ?").bind(userId),
  ]);

export const listMessages = async (db: D1Database, address: string): Promise<MessageSummary[]> => {
  const { results } = await db
    .prepare(
      `SELECT id, from_address, subject, otp_code, received_at,
              substr(text_body, 1, 220) AS snippet
         FROM messages
        WHERE address = ?
        ORDER BY received_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(address, MAX_MESSAGES_PER_INBOX)
    .all<MessageSummary>();
  return results;
};

export const getMessage = (db: D1Database, id: number, userId: number): Promise<Message | null> =>
  db
    .prepare(
      `SELECT m.id, m.address, m.from_address, m.subject, m.text_body, m.html_body,
              m.otp_code, m.received_at, NULL AS snippet
         FROM messages m JOIN inboxes i ON i.address = m.address
        WHERE m.id = ? AND i.user_id = ? AND i.expires_at > ?`,
    )
    .bind(id, userId, Date.now())
    .first<Message>();

/** Stores a message and trims the inbox to its newest MAX_MESSAGES_PER_INBOX. */
export const insertMessage = async (db: D1Database, msg: NewMessage): Promise<void> => {
  await db.batch([
    db
      .prepare(
        `INSERT INTO messages (address, from_address, subject, text_body, html_body, otp_code, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(msg.address, msg.from_address, msg.subject, msg.text_body, msg.html_body, msg.otp_code, msg.received_at),
    db
      .prepare(
        `DELETE FROM messages
          WHERE address = ?1
            AND id NOT IN (SELECT id FROM messages WHERE address = ?1 ORDER BY received_at DESC, id DESC LIMIT ?2)`,
      )
      .bind(msg.address, MAX_MESSAGES_PER_INBOX),
  ]);
};

export const purgeExpired = async (db: D1Database): Promise<{ inboxes: number; messages: number }> => {
  const now = Date.now();
  const [messages, inboxes] = await db.batch([
    db.prepare("DELETE FROM messages WHERE address IN (SELECT address FROM inboxes WHERE expires_at <= ?)").bind(now),
    db.prepare("DELETE FROM inboxes WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
  ]);
  return { inboxes: inboxes?.meta.changes ?? 0, messages: messages?.meta.changes ?? 0 };
};

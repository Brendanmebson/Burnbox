import { INBOX_TTL_MS, MAX_MESSAGES_PER_INBOX } from "./config";
import { db } from "./sql";

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

// Deleting an inbox deletes its messages too (ON DELETE CASCADE in the schema).

/** Returns the inbox, or null if the address is already taken by an active inbox. */
export const createInbox = async (address: string, userId: number): Promise<Inbox | null> => {
  const now = Date.now();
  const inbox: Inbox = { address, created_at: now, expires_at: now + INBOX_TTL_MS };
  const inserted = await db().begin(async (sql) => {
    // An expired inbox that the cleanup cron hasn't removed yet doesn't block the name.
    await sql`DELETE FROM inboxes WHERE address = ${address} AND expires_at <= ${now}`;
    const result = await sql`
      INSERT INTO inboxes (address, created_at, expires_at, user_id)
      VALUES (${inbox.address}, ${inbox.created_at}, ${inbox.expires_at}, ${userId})
      ON CONFLICT (address) DO NOTHING`;
    return result.count;
  });
  return inserted === 1 ? inbox : null;
};

export const listActiveInboxes = (userId: number): Promise<InboxSummary[]> =>
  db()<InboxSummary[]>`
    SELECT i.address, i.created_at, i.expires_at,
           COUNT(m.id) AS message_count, MAX(m.received_at) AS last_received_at
      FROM inboxes i LEFT JOIN messages m ON m.address = i.address
     WHERE i.user_id = ${userId} AND i.expires_at > ${Date.now()}
     GROUP BY i.address
     ORDER BY i.created_at DESC`;

/** Any active inbox, whoever owns it. Used when mail arrives. */
export const getActiveInbox = async (address: string): Promise<OwnedInbox | null> => {
  const [row] = await db()<OwnedInbox[]>`
    SELECT address, created_at, expires_at, user_id FROM inboxes
     WHERE address = ${address} AND expires_at > ${Date.now()}`;
  return row ?? null;
};

/** An active inbox, only if it belongs to this user. */
export const getOwnedInbox = async (address: string, userId: number): Promise<Inbox | null> => {
  const [row] = await db()<Inbox[]>`
    SELECT address, created_at, expires_at FROM inboxes
     WHERE address = ${address} AND user_id = ${userId} AND expires_at > ${Date.now()}`;
  return row ?? null;
};

export const countActiveInboxes = async (userId: number): Promise<number> => {
  const [row] = await db()<{ n: number }[]>`
    SELECT COUNT(*) AS n FROM inboxes WHERE user_id = ${userId} AND expires_at > ${Date.now()}`;
  return row?.n ?? 0;
};

export const deleteInbox = async (address: string, userId: number): Promise<boolean> => {
  const result = await db()`DELETE FROM inboxes WHERE address = ${address} AND user_id = ${userId}`;
  return result.count > 0;
};

export const listMessages = (address: string): Promise<MessageSummary[]> =>
  db()<MessageSummary[]>`
    SELECT id, from_address, subject, otp_code, received_at,
           substr(text_body, 1, 220) AS snippet
      FROM messages
     WHERE address = ${address}
     ORDER BY received_at DESC, id DESC
     LIMIT ${MAX_MESSAGES_PER_INBOX}`;

export const getMessage = async (id: number, userId: number): Promise<Message | null> => {
  const [row] = await db()<Message[]>`
    SELECT m.id, m.address, m.from_address, m.subject, m.text_body, m.html_body,
           m.otp_code, m.received_at, NULL AS snippet
      FROM messages m JOIN inboxes i ON i.address = m.address
     WHERE m.id = ${id} AND i.user_id = ${userId} AND i.expires_at > ${Date.now()}`;
  return row ?? null;
};

/** Stores a message and trims the inbox to its newest MAX_MESSAGES_PER_INBOX. */
export const insertMessage = async (msg: NewMessage): Promise<void> => {
  await db().begin(async (sql) => {
    await sql`
      INSERT INTO messages (address, from_address, subject, text_body, html_body, otp_code, received_at)
      VALUES (${msg.address}, ${msg.from_address}, ${msg.subject}, ${msg.text_body}, ${msg.html_body},
              ${msg.otp_code}, ${msg.received_at})`;
    await sql`
      DELETE FROM messages
       WHERE address = ${msg.address}
         AND id NOT IN (SELECT id FROM messages WHERE address = ${msg.address}
                         ORDER BY received_at DESC, id DESC LIMIT ${MAX_MESSAGES_PER_INBOX})`;
  });
};

export const purgeExpired = async (): Promise<{ inboxes: number; messages: number }> => {
  const now = Date.now();
  return db().begin(async (sql) => {
    const messages = await sql`
      DELETE FROM messages WHERE address IN (SELECT address FROM inboxes WHERE expires_at <= ${now})`;
    const inboxes = await sql`DELETE FROM inboxes WHERE expires_at <= ${now}`;
    await sql`DELETE FROM sessions WHERE expires_at <= ${now}`;
    return { inboxes: inboxes.count, messages: messages.count };
  });
};

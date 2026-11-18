const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const INBOX_TTL_MS = 24 * HOUR;
export const MAX_EMAIL_BYTES = 256 * 1024;
export const MAX_MESSAGES_PER_INBOX = 50;
export const RANDOM_NAME_LENGTH = 6;

export const SESSION_TTL_MS = 30 * DAY;
export const TRIAL_MS = 7 * DAY;
export const TRIAL_MAX_INBOXES = 4;
/** How long one "Grant a month of Pro" click in the admin page adds. */
export const PRO_GRANT_MS = 31 * DAY;

/** A network (IP address) can create at most this many accounts in the window below. */
export const SIGNUPS_PER_NETWORK = 3;
export const SIGNUP_NETWORK_WINDOW_MS = 30 * DAY;

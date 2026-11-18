import { RANDOM_NAME_LENGTH } from "./config.js";
import { env } from "./env.js";

const NAME_CHARS = /^[a-z0-9.-]+$/;
const ALPHANUMERIC = "abcdefghijklmnopqrstuvwxyz0123456789";

export const getDomain = (): string => env.DOMAIN;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * Custom names: lowercase letters, digits, dots and hyphens, 3-30 chars.
 * Also rejects a leading/trailing dot or hyphen and "..", which mail servers
 * treat as invalid local parts and would silently fail to deliver.
 */
export const validateName = (input: string): NameCheck => {
  const name = input.trim().toLowerCase();
  if (name.length < 3 || name.length > 30) {
    return { ok: false, error: "Name must be 3 to 30 characters" };
  }
  if (!NAME_CHARS.test(name)) {
    return { ok: false, error: "Use only lowercase letters, numbers, dots and hyphens" };
  }
  if (/^[.-]|[.-]$/.test(name) || name.includes("..")) {
    return { ok: false, error: "Name can't start or end with a dot or hyphen, or contain '..'" };
  }
  return { ok: true, name };
};

export const randomName = (length = RANDOM_NAME_LENGTH): string => {
  const chars: string[] = [];
  const bytes = new Uint8Array(length * 2);
  while (chars.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 252 is the largest multiple of 36 below 256, so there is no modulo bias.
      if (byte < 252 && chars.length < length) chars.push(ALPHANUMERIC[byte % 36]!);
    }
  }
  return chars.join("");
};

/**
 * Maps an incoming envelope recipient to a stored inbox address.
 * Lowercases it and strips "+tag" so seller1+test@domain lands in seller1@domain.
 */
export const normalizeRecipient = (recipient: string, domain: string): string | null => {
  const at = recipient.lastIndexOf("@");
  if (at < 1) return null;
  const recipientDomain = recipient.slice(at + 1).toLowerCase();
  if (recipientDomain !== domain) return null;
  const local = recipient.slice(0, at).toLowerCase().split("+")[0] ?? "";
  if (!local || !NAME_CHARS.test(local)) return null;
  return `${local}@${domain}`;
};

/** Validates an address taken from a URL path segment. */
export const parseAddressParam = (param: string, domain: string): string | null => {
  const address = param.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1 || address.slice(at + 1) !== domain) return null;
  const local = address.slice(0, at);
  return local.length <= 64 && NAME_CHARS.test(local) ? address : null;
};

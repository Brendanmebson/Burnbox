// Password hashing and tokens, using only the Web Crypto API built into Workers.

// Workers caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const derive = async (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const expected = fromBase64(hash);
  const actual = await derive(password, fromBase64(salt), Number(iterations));
  return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);
};

/** Constant-time comparison of two strings of any length. */
export const stringsMatch = async (a: string, b: string): Promise<boolean> => {
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(x, y);
};

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** URL-safe random token. */
export const randomToken = (bytes = 32): string =>
  toBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

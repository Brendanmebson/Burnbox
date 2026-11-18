/**
 * A standalone 4-8 digit run: not glued to letters/digits, and not part of
 * something that is clearly not a code (prices, phone numbers, dates,
 * decimals, URLs, order numbers like #12345).
 */
const CODE_PATTERN = /(?<![\w.,\-\/#$€£=?&+@%])\d{4,8}(?![\w\-\/@%]|[.,]\d)/g;
const CODE_CONTEXT = /code|otp|pin\b|passcode|password|verif|confirm|token|one[\s-]?time|2fa|mfa|security|login|sign[\s-]?in/i;

type Candidate = { code: string; nearKeyword: boolean };

const candidatesIn = (text: string): Candidate[] =>
  [...text.matchAll(CODE_PATTERN)].map((match) => {
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - 48), start);
    const after = text.slice(start + match[0].length, start + match[0].length + 24);
    return { code: match[0], nearKeyword: CODE_CONTEXT.test(before) || CODE_CONTEXT.test(after) };
  });

/**
 * Finds the OTP: the first standalone 4-8 digit code in the subject, then the
 * text body. A code next to a word like "code" or "verification" wins over an
 * earlier bare number, so a year or ticket number in a greeting isn't picked
 * by mistake.
 */
export const detectOtp = (subject: string, text: string): string | null => {
  const candidates = [...candidatesIn(subject), ...candidatesIn(text)];
  return (candidates.find((c) => c.nearKeyword) ?? candidates[0])?.code ?? null;
};

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", zwnj: "", zwj: "" };

/** Rough HTML to plain text, used when an email has no text/plain part. */
export const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

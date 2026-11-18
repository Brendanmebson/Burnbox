import PostalMime from "postal-mime";
import { getDomain, normalizeRecipient } from "./address";
import { MAX_EMAIL_BYTES } from "./config";
import { getActiveInbox, insertMessage } from "./db";
import { detectOtp, htmlToText } from "./otp";

export type IngestResult = "stored" | "unknown_recipient" | "too_large";

/**
 * Stores one incoming email, sent here by the Cloudflare relay Worker.
 * Mail is only accepted for inboxes that exist and haven't expired; the relay
 * turns anything else into an SMTP rejection, so spam never reaches the database.
 */
export const ingestEmail = async (raw: ArrayBuffer, envelopeTo: string, envelopeFrom: string | null): Promise<IngestResult> => {
  const address = normalizeRecipient(envelopeTo, getDomain());
  if (!address) return "unknown_recipient";
  if (raw.byteLength > MAX_EMAIL_BYTES) return "too_large";
  if (!(await getActiveInbox(address))) return "unknown_recipient";

  // Attachments are parsed by postal-mime but never stored.
  const email = await PostalMime.parse(raw);

  const subject = (email.subject ?? "").trim();
  const html = email.html?.trim() || null;
  const text = email.text?.trim() || (html ? htmlToText(html) : "") || null;

  await insertMessage({
    address,
    from_address: email.from?.address || envelopeFrom || null,
    subject: subject || null,
    text_body: text,
    html_body: html,
    otp_code: detectOtp(subject, text ?? ""),
    received_at: Date.now(),
  });
  return "stored";
};

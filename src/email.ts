import PostalMime from "postal-mime";
import { getDomain, normalizeRecipient } from "./address";
import { MAX_EMAIL_BYTES } from "./config";
import { getActiveInbox, insertMessage } from "./db";
import { detectOtp, htmlToText } from "./otp";
import type { Env } from "./types";

/**
 * Email Routing catch-all handler. Mail is only accepted for inboxes that
 * exist and haven't expired; everything else is rejected at SMTP time so
 * spam never reaches the database.
 */
export const handleEmail = async (message: ForwardableEmailMessage, env: Env): Promise<void> => {
  const address = normalizeRecipient(message.to, getDomain(env));
  if (!address) {
    message.setReject("Unknown recipient");
    return;
  }
  if (message.rawSize > MAX_EMAIL_BYTES) {
    message.setReject("Message too large (limit is 256 KB)");
    return;
  }
  if (!(await getActiveInbox(env.DB, address))) {
    message.setReject("Unknown recipient");
    return;
  }

  try {
    const raw = await new Response(message.raw).arrayBuffer();
    // Attachments are parsed by postal-mime but never stored.
    const email = await PostalMime.parse(raw);

    const subject = (email.subject ?? "").trim();
    const html = email.html?.trim() || null;
    const text = email.text?.trim() || (html ? htmlToText(html) : "") || null;

    await insertMessage(env.DB, {
      address,
      from_address: email.from?.address || message.from || null,
      subject: subject || null,
      text_body: text,
      html_body: html,
      otp_code: detectOtp(subject, text ?? ""),
      received_at: Date.now(),
    });
  } catch (error) {
    console.error("Failed to store email", { address, error: String(error) });
    message.setReject("Temporary failure storing message");
  }
};

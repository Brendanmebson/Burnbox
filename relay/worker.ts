// Cloudflare Email Routing → Burnbox on Vercel.
//
// Vercel can't receive email, so the domain's mail still arrives at Cloudflare.
// Email Routing hands every message to this Worker, which posts the raw email to
// the app's /api/inbound webhook and turns the reply into accept or reject.
// It stores nothing itself.

type Env = {
  /** The app's public URL, e.g. "https://burnbox.sbs". */
  APP_URL: string;
  /** Worker secret, the same value as INBOUND_SECRET in Vercel. */
  INBOUND_SECRET: string;
};

// Keep in step with MAX_EMAIL_BYTES in src/config.ts.
const MAX_EMAIL_BYTES = 256 * 1024;

export default {
  async email(message, env) {
    if (message.rawSize > MAX_EMAIL_BYTES) {
      message.setReject("Message too large (limit is 256 KB)");
      return;
    }

    const url = new URL("/api/inbound", env.APP_URL);
    url.searchParams.set("to", message.to);
    url.searchParams.set("from", message.from);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.INBOUND_SECRET}`, "Content-Type": "message/rfc822" },
        body: await new Response(message.raw).arrayBuffer(),
      });
    } catch (error) {
      console.error("Couldn't reach the app", { to: message.to, error: String(error) });
      message.setReject("Temporary failure storing message");
      return;
    }

    if (response.ok) return;
    if (response.status === 404) {
      message.setReject("Unknown recipient");
    } else if (response.status === 413) {
      message.setReject("Message too large (limit is 256 KB)");
    } else {
      console.error("The app refused the message", { to: message.to, status: response.status });
      message.setReject("Temporary failure storing message");
    }
  },
} satisfies ExportedHandler<Env>;

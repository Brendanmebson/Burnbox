import { Hono, type Context } from "hono";
import { api } from "./api";
import { stringsMatch } from "./crypto";
import { purgeExpired } from "./db";
import { ingestEmail } from "./email";
import { env } from "./env";
import type { AppEnv } from "./types";

// Vercel serves the files in public/ itself. Everything else reaches this app.
const app = new Hono<AppEnv>();

/** True when the request carries `Authorization: Bearer <secret>` and the secret is set. */
const hasBearer = async (c: Context<AppEnv>, secret: string): Promise<boolean> => {
  const header = c.req.header("Authorization") ?? "";
  return Boolean(secret) && header.startsWith("Bearer ") && (await stringsMatch(header.slice(7), secret));
};

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

/**
 * Incoming mail, posted by the Cloudflare relay Worker (relay/worker.ts) as the raw
 * message, with the SMTP envelope in the query string. The status code tells the
 * relay whether to accept or reject the message at SMTP time.
 */
app.post("/api/inbound", async (c) => {
  if (!(await hasBearer(c, env.INBOUND_SECRET))) return c.json({ error: "Unauthorized" }, 401);
  const to = c.req.query("to") ?? "";
  const from = c.req.query("from") || null;
  const result = await ingestEmail(await c.req.arrayBuffer(), to, from);
  if (result === "unknown_recipient") return c.json({ error: "Unknown recipient" }, 404);
  if (result === "too_large") return c.json({ error: "Message too large" }, 413);
  return c.json({ ok: true });
});

/** Removes expired inboxes, their mail and old sessions. Called by Vercel Cron (vercel.json). */
app.get("/api/cron/purge", async (c) => {
  if (!(await hasBearer(c, env.CRON_SECRET))) return c.json({ error: "Unauthorized" }, 401);
  const removed = await purgeExpired();
  console.log("Purged expired inboxes", removed);
  return c.json({ ok: true, ...removed });
});

app.route("/api", api);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error, c) => {
  console.error("Unhandled error", { path: c.req.path, error: String(error) });
  return c.json({ error: "Internal error" }, 500);
});

export default app;

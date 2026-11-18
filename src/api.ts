import { Hono } from "hono";
import { getDomain, parseAddressParam, randomName, validateName } from "./address";
import { admin } from "./admin";
import { authRoutes, requireAdmin, requireUser, sameOriginGuard } from "./auth";
import { INBOX_TTL_MS, TRIAL_MAX_INBOXES } from "./config";
import * as db from "./db";
import { env } from "./env";
import { PRICES, currencyFor, inboxLimit, planOf, requestCountry } from "./plans";
import type { AppEnv } from "./types";

const withTimeLeft = <T extends db.Inbox>(inbox: T, now: number) => ({
  ...inbox,
  expires_in_ms: Math.max(0, inbox.expires_at - now),
});

export const api = new Hono<AppEnv>();

api.use("*", sameOriginGuard);
api.use("*", requireUser); // skips signup, login, logout and pricing
api.route("/", authRoutes);
api.use("/admin/*", requireAdmin);
api.route("/admin", admin);

/** Public: the price in the visitor's currency, plus the other currencies for a switcher. */
api.get("/pricing", (c) => {
  const country = requestCountry(c.req.raw);
  return c.json({
    country,
    currency: currencyFor(country),
    prices: PRICES,
    trial: { days: 7, max_inboxes: TRIAL_MAX_INBOXES },
  });
});

api.get("/session", async (c) => {
  const user = c.get("user");
  const plan = planOf(user);
  const country = requestCountry(c.req.raw) ?? user.country;
  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    plan,
    trial_ends_at: user.trial_ends_at,
    pro_until: user.pro_until,
    inbox_limit: inboxLimit(plan),
    active_inboxes: await db.countActiveInboxes(user.id),
    price: PRICES[currencyFor(country)],
    support_email: env.SUPPORT_EMAIL || null,
    domain: getDomain(),
    ttl_ms: INBOX_TTL_MS,
    now: Date.now(),
  });
});

api.post("/inboxes", async (c) => {
  const user = c.get("user");
  const plan = planOf(user);
  if (plan === "expired") {
    return c.json({ error: "Your free trial has ended. Upgrade to Pro to keep creating inboxes.", code: "upgrade" }, 402);
  }
  const limit = inboxLimit(plan);
  if (limit !== null && (await db.countActiveInboxes(user.id)) >= limit) {
    return c.json(
      { error: `The free trial allows ${limit} inboxes at a time. Delete one, or upgrade to Pro for unlimited.`, code: "limit" },
      403,
    );
  }

  const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown });
  const domain = getDomain();
  const requested = typeof body.name === "string" ? body.name.trim() : "";

  if (requested) {
    const check = validateName(requested);
    if (!check.ok) return c.json({ error: check.error }, 400);
    const inbox = await db.createInbox(`${check.name}@${domain}`, user.id);
    if (!inbox) return c.json({ error: `${check.name}@${domain} is already in use` }, 409);
    return c.json({ inbox: withTimeLeft(inbox, Date.now()) }, 201);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const inbox = await db.createInbox(`${randomName()}@${domain}`, user.id);
    if (inbox) return c.json({ inbox: withTimeLeft(inbox, Date.now()) }, 201);
  }
  return c.json({ error: "Couldn't find a free random address. Try again." }, 500);
});

api.get("/inboxes", async (c) => {
  const now = Date.now();
  const inboxes = await db.listActiveInboxes(c.get("user").id);
  return c.json({ now, inboxes: inboxes.map((inbox) => withTimeLeft(inbox, now)) });
});

api.get("/inboxes/:address/messages", async (c) => {
  const address = parseAddressParam(c.req.param("address"), getDomain());
  const inbox = address ? await db.getOwnedInbox(address, c.get("user").id) : null;
  if (!address || !inbox) return c.json({ error: "Inbox not found or expired" }, 404);

  const now = Date.now();
  const messages = await db.listMessages(address);
  return c.json({ now, inbox: withTimeLeft(inbox, now), messages });
});

api.delete("/inboxes/:address", async (c) => {
  const address = parseAddressParam(c.req.param("address"), getDomain());
  if (!address) return c.json({ error: "Invalid address" }, 400);
  const deleted = await db.deleteInbox(address, c.get("user").id);
  return c.json({ ok: true, deleted });
});

api.get("/messages/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "Invalid message id" }, 400);
  const message = await db.getMessage(id, c.get("user").id);
  if (!message) return c.json({ error: "Message not found" }, 404);
  return c.json({ message });
});

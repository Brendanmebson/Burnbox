import { Hono } from "hono";
import { PRO_GRANT_MS, PRO_YEAR_GRANT_MS, TRIAL_MS } from "./config.js";
import { planOf } from "./plans.js";
import { db } from "./sql.js";
import type { AppEnv, User } from "./types.js";
import { getUser } from "./users.js";

const DAY = 24 * 60 * 60 * 1000;

type UserRow = User & { active_inboxes: number; last_inbox_at: number | null };
type Totals = { active_inboxes: number; emails_24h: number; blocked_signups_30d: number };

const present = (u: UserRow | User, now: number) => ({ ...u, plan: planOf(u, now) });

export const admin = new Hono<AppEnv>();

admin.get("/overview", async (c) => {
  const now = Date.now();
  const sql = db();
  const usersResult = await sql<UserRow[]>`
    SELECT u.id, u.email, u.name, u.role, u.trial_ends_at, u.pro_until, u.disabled, u.country,
           u.created_at, u.last_login_at,
           COUNT(i.address) AS active_inboxes, MAX(i.created_at) AS last_inbox_at
      FROM users u LEFT JOIN inboxes i ON i.user_id = u.id AND i.expires_at > ${now}
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT 1000`;
  const [totals] = await sql<Totals[]>`
    SELECT (SELECT COUNT(*) FROM inboxes WHERE expires_at > ${now}) AS active_inboxes,
           (SELECT COUNT(*) FROM messages WHERE received_at > ${now - DAY}) AS emails_24h,
           (SELECT COUNT(*) FROM signup_blocks WHERE created_at > ${now - 30 * DAY}) AS blocked_signups_30d`;

  const rows = usersResult.map((u) => present(u, now));
  const customers = rows.filter((u) => u.role !== "admin");
  const count = (plan: string) => customers.filter((u) => u.plan === plan && !u.disabled).length;

  return c.json({
    now,
    stats: {
      users: customers.length,
      trial: count("trial"),
      pro: count("pro"),
      expired: count("expired"),
      disabled: customers.filter((u) => u.disabled).length,
      signups_7d: customers.filter((u) => u.created_at > now - 7 * DAY).length,
      active_inboxes: totals?.active_inboxes ?? 0,
      emails_24h: totals?.emails_24h ?? 0,
      blocked_signups_30d: totals?.blocked_signups_30d ?? 0,
    },
    users: rows,
  });
});

const ACTIONS = ["grant_pro", "grant_pro_year", "revoke_pro", "extend_trial", "end_trial", "disable", "enable"] as const;
type Action = (typeof ACTIONS)[number];

admin.post("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ action?: unknown }>().catch(() => ({}) as { action?: unknown });
  const action = ACTIONS.find((a) => a === body.action) as Action | undefined;
  if (!Number.isSafeInteger(id) || !action) return c.json({ error: "Invalid request" }, 400);

  const user = await getUser(id);
  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.role === "admin") return c.json({ error: "The admin account can't be changed here." }, 400);

  const now = Date.now();
  await db().begin(async (sql) => {
    switch (action) {
      case "grant_pro":
        await sql`UPDATE users SET pro_until = ${Math.max(now, user.pro_until ?? 0) + PRO_GRANT_MS} WHERE id = ${id}`;
        break;
      case "grant_pro_year":
        await sql`UPDATE users SET pro_until = ${Math.max(now, user.pro_until ?? 0) + PRO_YEAR_GRANT_MS} WHERE id = ${id}`;
        break;
      case "revoke_pro":
        await sql`UPDATE users SET pro_until = NULL WHERE id = ${id}`;
        break;
      case "extend_trial":
        await sql`UPDATE users SET trial_ends_at = ${Math.max(now, user.trial_ends_at) + TRIAL_MS} WHERE id = ${id}`;
        break;
      case "end_trial":
        await sql`UPDATE users SET trial_ends_at = ${now} WHERE id = ${id}`;
        break;
      case "disable":
        await sql`UPDATE users SET disabled = 1 WHERE id = ${id}`;
        await sql`DELETE FROM sessions WHERE user_id = ${id}`;
        break;
      case "enable":
        await sql`UPDATE users SET disabled = 0 WHERE id = ${id}`;
        break;
      default: {
        const unreachable: never = action;
        throw new Error(`Unknown action ${String(unreachable)}`);
      }
    }
  });
  const updated = await getUser(id);
  return c.json({ user: updated ? present(updated, Date.now()) : null });
});

admin.delete("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id)) return c.json({ error: "Invalid request" }, 400);
  const user = await getUser(id);
  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.role === "admin") return c.json({ error: "The admin account can't be deleted." }, 400);

  // Deleting the user removes their sessions, inboxes and messages (ON DELETE CASCADE).
  // Device records are kept (user_id becomes NULL) so deleting an account doesn't free the device for a new trial.
  await db()`DELETE FROM users WHERE id = ${id}`;
  return c.json({ ok: true });
});

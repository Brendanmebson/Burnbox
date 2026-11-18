import { Hono } from "hono";
import { PRO_GRANT_MS, TRIAL_MS } from "./config";
import { deleteUserInboxes } from "./db";
import { planOf } from "./plans";
import type { AppEnv, User } from "./types";
import { getUser } from "./users";

const DAY = 24 * 60 * 60 * 1000;

type UserRow = User & { active_inboxes: number; last_inbox_at: number | null };

const present = (u: UserRow | User, now: number) => ({ ...u, plan: planOf(u, now) });

export const admin = new Hono<AppEnv>();

admin.get("/overview", async (c) => {
  const now = Date.now();
  const db = c.env.DB;
  const [usersResult, inboxRow, messageRow, blockRow] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.trial_ends_at, u.pro_until, u.disabled, u.country,
                u.created_at, u.last_login_at,
                COUNT(i.address) AS active_inboxes, MAX(i.created_at) AS last_inbox_at
           FROM users u LEFT JOIN inboxes i ON i.user_id = u.id AND i.expires_at > ?1
          GROUP BY u.id
          ORDER BY u.created_at DESC
          LIMIT 1000`,
      )
      .bind(now),
    db.prepare("SELECT COUNT(*) AS n FROM inboxes WHERE expires_at > ?").bind(now),
    db.prepare("SELECT COUNT(*) AS n FROM messages WHERE received_at > ?").bind(now - DAY),
    db.prepare("SELECT COUNT(*) AS n FROM signup_blocks WHERE created_at > ?").bind(now - 30 * DAY),
  ]);

  const rows = ((usersResult?.results ?? []) as UserRow[]).map((u) => present(u, now));
  const customers = rows.filter((u) => u.role !== "admin");
  const count = (plan: string) => customers.filter((u) => u.plan === plan && !u.disabled).length;
  const n = (result: D1Result | undefined) => ((result?.results?.[0] as { n?: number } | undefined)?.n ?? 0);

  return c.json({
    now,
    stats: {
      users: customers.length,
      trial: count("trial"),
      pro: count("pro"),
      expired: count("expired"),
      disabled: customers.filter((u) => u.disabled).length,
      signups_7d: customers.filter((u) => u.created_at > now - 7 * DAY).length,
      active_inboxes: n(inboxRow),
      emails_24h: n(messageRow),
      blocked_signups_30d: n(blockRow),
    },
    users: rows,
  });
});

const ACTIONS = ["grant_pro", "revoke_pro", "extend_trial", "end_trial", "disable", "enable"] as const;
type Action = (typeof ACTIONS)[number];

admin.post("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ action?: unknown }>().catch(() => ({}) as { action?: unknown });
  const action = ACTIONS.find((a) => a === body.action) as Action | undefined;
  if (!Number.isSafeInteger(id) || !action) return c.json({ error: "Invalid request" }, 400);

  const db = c.env.DB;
  const user = await getUser(db, id);
  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.role === "admin") return c.json({ error: "The admin account can't be changed here." }, 400);

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  switch (action) {
    case "grant_pro":
      statements.push(db.prepare("UPDATE users SET pro_until = ? WHERE id = ?").bind(Math.max(now, user.pro_until ?? 0) + PRO_GRANT_MS, id));
      break;
    case "revoke_pro":
      statements.push(db.prepare("UPDATE users SET pro_until = NULL WHERE id = ?").bind(id));
      break;
    case "extend_trial":
      statements.push(db.prepare("UPDATE users SET trial_ends_at = ? WHERE id = ?").bind(Math.max(now, user.trial_ends_at) + TRIAL_MS, id));
      break;
    case "end_trial":
      statements.push(db.prepare("UPDATE users SET trial_ends_at = ? WHERE id = ?").bind(now, id));
      break;
    case "disable":
      statements.push(
        db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").bind(id),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
      );
      break;
    case "enable":
      statements.push(db.prepare("UPDATE users SET disabled = 0 WHERE id = ?").bind(id));
      break;
    default: {
      const unreachable: never = action;
      return c.json({ error: `Unknown action ${String(unreachable)}` }, 400);
    }
  }
  await db.batch(statements);
  const updated = await getUser(db, id);
  return c.json({ user: updated ? present(updated, Date.now()) : null });
});

admin.delete("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id)) return c.json({ error: "Invalid request" }, 400);
  const db = c.env.DB;
  const user = await getUser(db, id);
  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.role === "admin") return c.json({ error: "The admin account can't be deleted." }, 400);

  await deleteUserInboxes(db, id);
  // Device records are kept (user_id becomes NULL) so deleting an account doesn't free the device for a new trial.
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    db.prepare("UPDATE devices SET user_id = NULL WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

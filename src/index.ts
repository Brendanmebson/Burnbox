import { Hono } from "hono";
import { api } from "./api";
import { purgeExpired } from "./db";
import { handleEmail } from "./email";
import type { AppEnv, Env } from "./types";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});
app.route("/api", api);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error, c) => {
  console.error("Unhandled error", { path: c.req.path, error: String(error) });
  return c.json({ error: "Internal error" }, 500);
});

export default {
  fetch: app.fetch,

  async email(message, env) {
    await handleEmail(message, env);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      purgeExpired(env.DB).then((removed) => console.log("Purged expired inboxes", removed)),
    );
  },
} satisfies ExportedHandler<Env>;

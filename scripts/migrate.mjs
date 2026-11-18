// Applies the SQL files in migrations/ that haven't run yet, in filename order.
// Usage: npm run db:migrate   (reads DATABASE_URL from the environment or .env)
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first (in .env, or in your shell).");
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { prepare: false, ssl: local ? false : "require", max: 1, onnotice: () => {} });
const dir = new URL("../migrations/", import.meta.url);

try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY`;
  const applied = new Set((await sql`SELECT name FROM schema_migrations`).map((row) => row.name));
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();

  let ran = 0;
  for (const name of files) {
    if (applied.has(name)) continue;
    const text = await readFile(new URL(name, dir), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    console.log(`Applied ${name}`);
    ran++;
  }
  console.log(ran ? `Done: ${ran} migration(s) applied.` : "Database is up to date.");
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

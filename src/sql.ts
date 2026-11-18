import postgres from "postgres";
import { env } from "./env.js";

let client: postgres.Sql | undefined;

/**
 * The shared Postgres client, created on first use. Connect through Supabase's
 * transaction pooler (port 6543), which suits serverless functions.
 */
export const db = (): postgres.Sql => {
  if (client) return client;
  const url = env.DATABASE_URL;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  client = postgres(url, {
    // The transaction pooler doesn't support prepared statements.
    prepare: false,
    ssl: local ? false : "require",
    max: 5,
    idle_timeout: 20,
    // Timestamps and counts are BIGINT. Return them as numbers, not strings.
    types: {
      bigint: { to: 20, from: [20], serialize: (value: number) => String(value), parse: (value: string) => Number(value) },
    },
  });
  return client;
};

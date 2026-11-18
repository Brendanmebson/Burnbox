export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Domain that Email Routing sends to this Worker, e.g. "example.com". */
  DOMAIN: string;
  /** Email address that signs in as the admin. Nobody can sign up with it. */
  ADMIN_EMAIL: string;
  /** Worker secret: `wrangler secret put ADMIN_PASSWORD`. The admin's password. */
  ADMIN_PASSWORD: string;
  /** Optional address shown to users who want to upgrade, while online payment isn't live. */
  SUPPORT_EMAIL?: string;
};

export type Role = "user" | "admin";

export type User = {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  trial_ends_at: number;
  pro_until: number | null;
  disabled: number;
  country: string | null;
  created_at: number;
  last_login_at: number | null;
};

export type AppEnv = { Bindings: Env; Variables: { user: User } };

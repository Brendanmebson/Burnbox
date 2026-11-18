// Settings come from environment variables: Vercel project settings in production, .env locally.

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const optional = (name: string): string => process.env[name]?.trim() ?? "";

export const env = {
  /** Supabase Postgres connection string (the transaction pooler URI). */
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  /** The domain whose mail reaches this app, e.g. "example.com". */
  get DOMAIN() {
    return required("DOMAIN").toLowerCase();
  },
  /** Signs in as the admin, with ADMIN_PASSWORD as its password. Nobody can sign up with it. */
  get ADMIN_EMAIL() {
    return optional("ADMIN_EMAIL").toLowerCase();
  },
  get ADMIN_PASSWORD() {
    return optional("ADMIN_PASSWORD");
  },
  /** Shown to users who want to upgrade while online payment isn't live. Empty hides it. */
  get SUPPORT_EMAIL() {
    return optional("SUPPORT_EMAIL");
  },
  /** Shared with the Cloudflare email relay Worker. Required for mail to be accepted. */
  get INBOUND_SECRET() {
    return optional("INBOUND_SECRET");
  },
  /** Vercel sends this as a bearer token on cron requests. */
  get CRON_SECRET() {
    return optional("CRON_SECRET");
  },
};

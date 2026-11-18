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

export type AppEnv = { Variables: { user: User } };

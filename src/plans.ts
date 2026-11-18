import { TRIAL_MAX_INBOXES } from "./config";
import type { User } from "./types";

export type Plan = "admin" | "pro" | "trial" | "expired";

export const planOf = (user: User, now = Date.now()): Plan => {
  if (user.role === "admin") return "admin";
  if ((user.pro_until ?? 0) > now) return "pro";
  if (user.trial_ends_at > now) return "trial";
  return "expired";
};

/** Active inboxes allowed at once. null means no limit. */
export const inboxLimit = (plan: Plan): number | null => {
  if (plan === "trial") return TRIAL_MAX_INBOXES;
  if (plan === "expired") return 0;
  return null;
};

// ---------- Pricing ----------

export type Currency = "USD" | "GBP" | "EUR";
export type Price = { currency: Currency; symbol: string; amount: number };

export const PRICES: Record<Currency, Price> = {
  USD: { currency: "USD", symbol: "$", amount: 5 },
  GBP: { currency: "GBP", symbol: "£", amount: 4 },
  EUR: { currency: "EUR", symbol: "€", amount: 5 },
};

const POUND_COUNTRIES = new Set(["GB", "GG", "JE", "IM"]);
// Eurozone members, plus the microstates and territories that use the euro.
const EURO_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU",
  "MT", "NL", "PT", "SK", "SI", "ES", "AD", "MC", "SM", "VA", "ME", "XK",
]);

export const currencyFor = (country: string | null | undefined): Currency => {
  const code = (country ?? "").toUpperCase();
  if (POUND_COUNTRIES.has(code)) return "GBP";
  if (EURO_COUNTRIES.has(code)) return "EUR";
  return "USD";
};

/** Two-letter country of the visitor, as reported by Cloudflare (null in some local setups). */
export const requestCountry = (request: Request): string | null => {
  const country = (request as Request & { cf?: { country?: unknown } }).cf?.country;
  return typeof country === "string" && /^[A-Z]{2}$/.test(country) ? country : null;
};

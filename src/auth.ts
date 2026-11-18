import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SESSION_TTL_MS, TRIAL_MS } from "./config.js";
import { hashPassword, randomToken, sha256Hex, stringsMatch, verifyPassword } from "./crypto.js";
import { requestCountry } from "./plans.js";
import { env } from "./env.js";
import type { AppEnv } from "./types.js";
import * as users from "./users.js";

const SESSION_COOKIE = "tb_session";
const DEVICE_COOKIE = "tb_device";
const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers allow
const PUBLIC_PATHS = new Set(["/api/signup", "/api/login", "/api/logout", "/api/pricing"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

/**
 * The origin the browser used. Behind Vercel's proxy the forwarded headers are
 * the reliable source; the request URL is the fallback for local development.
 */
const requestOrigin = (c: Context<AppEnv>): string => {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  const host = c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host") || url.host;
  return `${proto}://${host}`;
};
const isHttps = (c: Context<AppEnv>): boolean => requestOrigin(c).startsWith("https:");
/** Vercel sets x-real-ip to the visitor's address. */
const clientIp = (c: Context<AppEnv>): string =>
  c.req.header("x-real-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "";
const slowDown = () => new Promise((resolve) => setTimeout(resolve, 600));

type Body = Record<string, unknown>;
const readBody = (c: Context<AppEnv>) => c.req.json<Body>().catch(() => ({}) as Body);
const str = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

const setSession = async (c: Context<AppEnv>, userId: number) => {
  const token = await users.createSession(userId);
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Strict",
    maxAge: SESSION_TTL_MS / 1000,
  });
};

/** Collects the signals used to spot repeat signups, and makes sure the device cookie is set. */
const deviceSignals = async (c: Context<AppEnv>, body: Body): Promise<users.DeviceSignals> => {
  const fromCookie = getCookie(c, DEVICE_COOKIE) ?? "";
  const fromStorage = str(body.device_id, 64);
  const deviceIds = [...new Set([fromCookie, fromStorage].filter((id) => DEVICE_ID_RE.test(id)))];

  const fingerprint = str(body.fingerprint, 64).toLowerCase();
  const ip = clientIp(c);
  // Salted with the admin password so the stored hashes can't be reversed with a list of all IPs.
  const ipHash = ip ? await sha256Hex(`ip:${ip}:${env.ADMIN_PASSWORD}`) : null;

  const cookieId = deviceIds[0] ?? randomToken(18);
  setCookie(c, DEVICE_COOKIE, cookieId, {
    path: "/",
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
  return {
    deviceIds: deviceIds.length ? deviceIds : [cookieId],
    fingerprint: FINGERPRINT_RE.test(fingerprint) ? fingerprint : null,
    ipHash,
  };
};

/** Blocks cross-site state-changing requests (on top of SameSite cookies). */
export const sameOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin && origin !== requestOrigin(c)) {
      return c.json({ error: "Cross-origin request blocked" }, 403);
    }
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  const token = getCookie(c, SESSION_COOKIE);
  const user = token ? await users.userForSession(token) : null;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (user.disabled) {
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(c) });
    return c.json({ error: "This account has been disabled." }, 401);
  }
  c.set("user", user);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "admin") return c.json({ error: "Admins only" }, 403);
  await next();
};

export const authRoutes = new Hono<AppEnv>()
  .post("/signup", async (c) => {
    const body = await readBody(c);
    const email = str(body.email, 254).toLowerCase();
    const name = str(body.name, 60) || null;
    const password = typeof body.password === "string" ? body.password : "";

    if (!EMAIL_RE.test(email)) return c.json({ error: "Enter a valid email address.", field: "email" }, 400);
    if (password.length < 8) return c.json({ error: "Use at least 8 characters.", field: "password" }, 400);
    if (password.length > 200) return c.json({ error: "That password is too long.", field: "password" }, 400);
    if (email === env.ADMIN_EMAIL) return c.json({ error: "This email can't be used to sign up.", field: "email" }, 400);

    const signals = await deviceSignals(c, body);
    const blocked = await users.signupBlockReason(signals);
    if (blocked) {
      await users.recordBlockedSignup(blocked);
      return c.json(
        {
          error:
            blocked === "device"
              ? "An account was already created on this device. Sign in to it instead."
              : "Too many accounts have been created from this network. Sign in to an existing account instead.",
          code: "repeat_signup",
        },
        429,
      );
    }

    const user = await users.createUser({
      email,
      name,
      passwordHash: await hashPassword(password),
      role: "user",
      trialEndsAt: Date.now() + TRIAL_MS,
      country: requestCountry(c.req.raw),
    });
    if (!user) return c.json({ error: "An account with this email already exists. Sign in instead.", field: "email" }, 409);

    await users.recordDevice(user.id, "signup", signals);
    await setSession(c, user.id);
    return c.json({ ok: true, role: user.role }, 201);
  })
  .post("/login", async (c) => {
    const body = await readBody(c);
    const email = str(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const wrong = async () => {
      await slowDown();
      return c.json({ error: "Wrong email or password." }, 401);
    };
    if (!email || !password) return wrong();

    // The admin signs in with ADMIN_EMAIL and the ADMIN_PASSWORD setting.
    if (env.ADMIN_EMAIL && email === env.ADMIN_EMAIL) {
      if (!env.ADMIN_PASSWORD || !(await stringsMatch(password, env.ADMIN_PASSWORD))) return wrong();
      const admin = await users.upsertAdmin(email);
      if (!admin) return c.json({ error: "Couldn't create the admin account." }, 500);
      await setSession(c, admin.id);
      return c.json({ ok: true, role: "admin" });
    }

    const user = await users.findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) return wrong();
    if (user.disabled) return c.json({ error: "This account has been disabled." }, 403);

    await users.recordDevice(user.id, "login", await deviceSignals(c, body));
    await setSession(c, user.id);
    return c.json({ ok: true, role: user.role });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await users.deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(c) });
    return c.json({ ok: true });
  });

# Burnbox: disposable test inboxes on Cloudflare

A test email inbox for developers, run as a small paid service. People sign up, get a 7-day free trial (up to 4 inboxes at a time), then need Pro ($5 / £4 / €5 a month, shown in their local currency) for unlimited inboxes. Online payment isn't wired up yet: the admin switches Pro on from the admin page.

Generate an address like `x7k2p9@YOURDOMAIN.com` (or pick a name like `seller1@…`), point your app at it, and the email shows up in a web inbox within seconds. OTP codes are pulled out for one-click copying, and verification links are listed first. Each inbox and all its mail are deleted 24 hours after it was created.

Everything runs on Cloudflare's free plan: one Worker (Hono + postal-mime), Email Routing, D1 and a Cron Trigger.

```
Sender ──SMTP──▶ Cloudflare Email Routing ──catch-all──▶ Worker email()  ──▶ D1
                                                          Worker fetch()  ◀──▶ Browser (UI + /api)
                                                          Worker scheduled() hourly: purge expired
```

## Project layout

```
wrangler.toml              Worker config: D1 binding, DOMAIN var, hourly cron, static assets
migrations/0001_init.sql   D1 schema (inboxes, messages, indexes)
migrations/0002_accounts.sql  Accounts, sessions, devices, inbox ownership
src/index.ts               Entry: fetch (Hono), email, scheduled handlers
src/api.ts                 JSON API routes (inboxes are scoped to the signed-in account)
src/auth.ts                Sign-up, sign-in, sessions, repeat-signup blocking, auth middleware
src/admin.ts               Admin API: totals, accounts, plan actions
src/users.ts               Account, session and device queries
src/plans.ts               Trial/Pro rules and local-currency pricing
src/crypto.ts              PBKDF2 password hashing, tokens
src/email.ts               Incoming mail: accept/reject, parse, store
src/otp.ts                 OTP detection and HTML-to-text
src/db.ts                  D1 queries
src/address.ts             Name validation, random names, recipient normalization
public/index.html          Landing page at /  (landing.css, landing.js)
public/app/index.html      The inbox app at /app/  (styles.css, app.js)
public/login/, signup/     Sign-in and sign-up pages (auth.js)
public/admin/index.html    Admin dashboard at /admin/  (admin.js)
```

## Behaviour

- **Accepts mail only for active inboxes.** Mail to unknown or expired addresses is rejected during the SMTP conversation, so the sender gets a bounce and nothing is stored.
- **Size and volume limits.** Emails over 256 KB are rejected. Attachments are never stored. Each inbox keeps its newest 50 messages and older ones are dropped.
- **OTP detection.** The Worker looks for the first standalone 4–8 digit code in the subject, then in the text body. A code next to a word like "code", "verification" or "2FA" beats an earlier bare number, and prices, phone numbers, dates, `#order` numbers and URL digits are skipped.
- **Plus addressing.** `seller1+anything@YOURDOMAIN.com` is delivered to `seller1@…`, which helps when an app needs a unique email for each signup.
- **Expiry.** The API and email handler treat an inbox as gone the moment it expires. The hourly cron then deletes the rows, and expired sessions.
- **Accounts and plans.** Each inbox belongs to the account that created it. A new account gets a 7-day trial with up to 4 active inboxes. After the trial, the account can still read its existing inboxes but can't create new ones until the admin gives it Pro (no inbox limit).
- **Pricing by location.** `/api/pricing` uses Cloudflare's visitor country: £4 for the UK, €5 for the eurozone, $5 everywhere else. The landing page also has a currency switch.
- **Repeat-signup blocking.** A signup is refused when (a) the browser's device ID (kept in a cookie and in local storage) already signed up or signed in, (b) the same browser fingerprint signed up from the same network, or (c) the network already created 3 accounts in the last 30 days. IPs are stored only as salted hashes. Someone determined can still get around this (a different browser and network), so it's a speed bump, not a wall.
- **Admin.** Signing in with `ADMIN_EMAIL` and the `ADMIN_PASSWORD` secret opens `/admin/`: totals, every account, and buttons to give a month of Pro, remove Pro, add 7 trial days, disable, enable or delete an account. Nobody can sign up with the admin email.

## API

All routes are JSON and require the session cookie, except signup, login, logout and pricing.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/signup` | `{ email, password, name?, device_id?, fingerprint? }`. `400` invalid, `409` email taken, `429` repeat signup |
| POST | `/api/login` | `{ email, password }`. Sets a 30-day HTTP-only session cookie |
| POST | `/api/logout` | Ends the session |
| GET | `/api/pricing` | Public. `{ country, currency, prices, trial }` |
| GET | `/api/session` | `{ user, plan, trial_ends_at, pro_until, inbox_limit, active_inboxes, price, support_email, domain, ttl_ms, now }` |
| POST | `/api/inboxes` | `{ "name"?: "seller1" }`. Random 6-character name if omitted. `400` invalid, `409` in use, `403` trial limit reached, `402` trial ended |
| GET | `/api/inboxes` | Active inboxes with `expires_in_ms` and `message_count` |
| GET | `/api/inboxes/:address/messages` | Newest first, max 50 |
| GET | `/api/messages/:id` | Full message (text and HTML) |
| DELETE | `/api/inboxes/:address` | Deletes the inbox and its messages now |
| GET | `/api/admin/overview` | Admin only. Totals and every account |
| POST | `/api/admin/users/:id` | Admin only. `{ action }`: `grant_pro`, `revoke_pro`, `extend_trial`, `end_trial`, `disable`, `enable` |
| DELETE | `/api/admin/users/:id` | Admin only. Deletes the account, its inboxes and emails |

Custom names must be 3–30 characters of `a–z 0–9 . -`. They also can't start or end with `.` or `-` or contain `..`, because mail servers reject those addresses.

---

## Setup (step by step)

You need a Cloudflare account (free), a domain you control, and Node.js 18 or newer.

> **Use a domain (or subdomain) that doesn't receive real email.** Turning on Email Routing replaces the domain's MX records, so mail for an existing mailbox on that domain (Google Workspace, Fastmail and so on) would stop arriving. A cheap spare domain is the simplest option.

### 1. Add your domain to Cloudflare

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com) and click **Add a domain** (sometimes labelled **Add site**).
2. Enter your domain, choose the **Free** plan, and continue through the DNS record scan.
3. Cloudflare shows you two nameservers. At your registrar (where you bought the domain), replace the existing nameservers with those two.
4. Wait until the domain shows **Active** in Cloudflare. This usually takes minutes but can take up to 24 hours, and Cloudflare emails you when it's done.

### 2. Install the project and log in to Wrangler

```bash
cd disposable-inbox
npm install
npx wrangler login        # opens a browser to authorize Wrangler
```

### 3. Create the D1 database

```bash
npx wrangler d1 create disposable-inbox
```

The output includes a `database_id`. Open `wrangler.toml` and paste it in:

```toml
[[d1_databases]]
binding = "DB"
database_name = "disposable-inbox"
database_id = "paste-the-id-here"
```

### 4. Set your domain

Still in `wrangler.toml`, replace the placeholder:

```toml
[vars]
DOMAIN = "yourdomain.com"
ADMIN_EMAIL = "you@yourdomain.com"     # signs in as the admin
SUPPORT_EMAIL = "help@yourdomain.com"  # shown to users who want to upgrade; "" hides it
```

### 5. Run the migration

```bash
npm run db:migrate:remote
# same as: npx wrangler d1 migrations apply disposable-inbox --remote
```

Type `y` when prompted. You should see `0001_init.sql ✅` and `0002_accounts.sql ✅`.

### 6. Set the admin password

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Type a long password when prompted. This is the admin's password: you sign in with `ADMIN_EMAIL` and this password. If Wrangler says the Worker doesn't exist yet and offers to create it, answer **yes**.

### 7. Deploy

```bash
npm run deploy
```

Wrangler prints a URL like `https://disposable-inbox.<your-subdomain>.workers.dev`. Open `/login/` and sign in with `ADMIN_EMAIL` and your admin password. You land on `/admin/`.

Optional: to serve the UI from your own domain, go to **Workers & Pages → disposable-inbox → Settings → Domains & Routes → Add → Custom domain** and enter something like `inbox.yourdomain.com`.

### 8. Turn on Email Routing

1. In the dashboard, select your domain, then go to **Email → Email Routing**.
2. Click **Get started** or **Enable Email Routing**. If the wizard asks you to create a first custom address with a destination mailbox, you can skip it (look for **Skip getting started**). A Worker is the only destination this setup needs.
3. When Cloudflare offers to add its **MX** and **TXT (SPF)** records, click **Add records and enable**. Under **Settings** the status should change to **Enabled** and the DNS records should show as configured.

### 9. Create the catch-all rule pointing to the Worker

1. Go to **Email → Email Routing → Routing rules**.
2. Find **Catch-all address** and click **Edit**.
3. Set **Action** to **Send to a Worker** and **Destination** to `disposable-inbox`.
4. Click **Save** and make sure the catch-all is toggled **on** (Active).

Mail to any address `@yourdomain.com` now goes to the Worker. The Worker accepts only addresses you created in the UI and rejects everything else.

### 10. Done. Run the test checklist below.

To watch live logs while testing:

```bash
npm run tail
```

---

## Test checklist

**☐ Email arrives**
1. Sign in (as the admin, or with a test account from `/signup/`), open **Your inboxes**, and click **Generate address**. The address is copied automatically.
2. From any real mailbox (Gmail, etc.), send an email to it.
3. Within a few seconds it appears in the message list ("Live · every 5s" in the header). Open it and check that the HTML renders and that **Load images** shows remote images.

**☐ OTP is detected**
1. Send an email with the subject `Your verification code` and the body `Your code is 482913.`
2. The list row shows a yellow `482913` chip, and the opened message shows the code large at the top with **Copy code**.
3. Optional: trigger a real OTP or verification email from your app and confirm the code or link shows at the top.

**☐ Unknown addresses are rejected**
1. Send an email to `doesnotexist123@yourdomain.com` (an address you never created).
2. You get a bounce back with "Unknown recipient". In the dashboard, **Email → Email Routing → Overview / Activity log** shows the message as **Rejected**, and nothing appears in the UI.
3. Optional: send an attachment over 256 KB to a valid address. It bounces with "Message too large".

**☐ Expired inboxes are removed**

Rather than waiting 24 hours, force an inbox to expire:

```bash
npx wrangler d1 execute disposable-inbox --remote \
  --command "UPDATE inboxes SET expires_at = 0 WHERE address = 'seller1@yourdomain.com'"
```

1. Within 5 seconds the inbox disappears from the UI, and new mail to it is rejected.
2. After the next full hour (the cron runs at `:00`), confirm the rows are gone:
   ```bash
   npx wrangler d1 execute disposable-inbox --remote \
     --command "SELECT COUNT(*) AS n FROM messages WHERE address = 'seller1@yourdomain.com'"
   ```
   `n` should be `0`. While `npm run tail` is running you'll also see `Purged expired inboxes { inboxes: 1, messages: … }`. Recent cron runs are listed under **Workers & Pages → disposable-inbox → Settings → Trigger Events**.

---

## Local development

```bash
cp .dev.vars.example .dev.vars          # sets ADMIN_PASSWORD for local use (admin email is ADMIN_EMAIL in wrangler.toml)
npm run db:migrate:local
npm run dev                             # http://localhost:8787
```

Simulate an incoming email. The message must include a `Message-ID` header, and the inbox must exist, so create `seller1` in the UI first:

```bash
cat > test.eml <<'EOF'
From: App <no-reply@example.com>
To: seller1@yourdomain.com
Message-ID: <test-1@example.com>
Date: Mon, 16 Nov 2026 10:00:00 +0000
Subject: Your verification code

Your code is 482913.
EOF

curl -X POST "http://localhost:8787/cdn-cgi/handler/email?from=no-reply%40example.com&to=seller1%40yourdomain.com" \
  --data-binary @test.eml
```

Trigger the cleanup cron locally:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"
```

Typecheck with `npm run typecheck`.

---

## Security notes

- **Accounts.** Passwords are hashed with PBKDF2-SHA256 (100,000 iterations, random salt). Sessions are random 256-bit tokens in a 30-day `HttpOnly`, `Secure`, `SameSite=Strict` cookie; only their SHA-256 is stored, so a database leak can't be used to sign in. Failed sign-ins are delayed, and cross-origin POST/DELETE requests are refused. The admin password is the `ADMIN_PASSWORD` secret, compared in constant time.
- **Privacy.** Repeat-signup blocking stores a random device ID, a hash of browser traits and a salted hash of the IP address. If you have users in the UK or EU, mention this in your privacy policy.
- **Brute force.** For extra protection, add a free Cloudflare rate-limiting rule (**Security → WAF → Rate limiting rules**) on `POST /api/login` and `POST /api/signup`, for example 5 requests per 10 seconds per IP. This needs the Worker on a custom domain (step 7).
- **HTML emails** render in an iframe with `sandbox="allow-popups allow-popups-to-escape-sandbox"`. Scripts and forms are disabled, and the frame has an opaque origin, so it can't touch the app or its cookies. Links open in a new tab with no referrer. A Content-Security-Policy inside the frame blocks remote images, CSS and fonts (and so tracking pixels) until you click **Load images**.
- **Static files.** The HTML/CSS/JS under `public/` is served without auth. It contains no data, and all mail goes through the authenticated API. `public/_headers` sets a strict CSP and `noindex`.

## Free plan limits

| Resource | Free allowance | This app |
| --- | --- | --- |
| Worker requests | 100,000 / day | An open, visible tab polls about 2 requests every 5 s (≈ 35k/day if left open all day). Polling stops when the tab is hidden |
| D1 | 5 GB storage, 5M row reads/day, 100k writes/day | At most 50 messages × 256 KB per inbox, deleted after 24 h |
| Cron Triggers | Included | 1 (hourly) |
| Email Routing | Free | Catch-all to Worker |

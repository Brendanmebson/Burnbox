# Burnbox

**Test email inboxes for developers.** Generate a real, working email address, sign up with it in the app you're building, and the email lands in a web inbox within seconds. OTP codes are pulled out for one-click copying, verification links are listed first, and every inbox deletes itself after 24 hours.

Burnbox runs as a small paid service: new accounts get a **7-day free trial** (up to 4 inboxes at a time), then **Pro** costs **$5 / £4 / €5 a month** or **$50 / £40 / €50 a year** (two months free), shown in the visitor's local currency, for unlimited inboxes.

It runs on three services: **Vercel** hosts the website and API, **Supabase** holds the data in Postgres, and **Cloudflare** receives the email. There's no build step.

---

## Contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Pages](#pages)
4. [Plans and pricing](#plans-and-pricing)
5. [What you need](#what-you-need)
6. [Run it locally](#run-it-locally)
7. [Deploy it live](#deploy-it-live)
8. [Configuration reference](#configuration-reference)
9. [Using the admin dashboard](#using-the-admin-dashboard)
10. [Test checklist](#test-checklist)
11. [How mail is handled](#how-mail-is-handled)
12. [Repeat-signup protection](#repeat-signup-protection)
13. [API reference](#api-reference)
14. [Database](#database)
15. [Project layout](#project-layout)
16. [Customising](#customising)
17. [Security](#security)
18. [Plan limits](#plan-limits)
19. [Troubleshooting](#troubleshooting)
20. [FAQ](#faq)

---

## Features

**For users**
- Random addresses like `x7k2p9@yourdomain.com`, or custom ones like `seller1@yourdomain.com`
- **Plus addressing:** `seller1+anything@…` lands in `seller1@…`, so one inbox covers unlimited unique signups
- **OTP detection:** 4–8 digit codes are shown large with a copy button
- **Verification links** found and listed first, with copy and open buttons
- **Safe HTML preview:** sandboxed, no scripts, remote images (tracking pixels) blocked until you allow them
- Live inbox that checks for new mail every 5 seconds while the tab is open
- Every inbox and its mail are deleted 24 hours after creation
- Works on phones, tablets and desktop

**For you, the operator**
- Accounts with email and password
- 7-day trial, then Pro, with prices shown in local currency (USD, GBP or EUR)
- Admin dashboard: totals, every account, and one-click plan controls
- Blocks people from making account after account on the same device to get more free trials
- No servers to manage: Vercel, Supabase and Cloudflare run everything

---

## How it works

```
 Someone's app ──SMTP──▶  Cloudflare Email Routing ──▶ relay Worker
                                                            │
                                                            │ HTTPS  POST /api/inbound
                                                            ▼
 Browser ◀──HTTPS──────▶  Vercel   public/ pages + /api  ◀──────▶  Supabase Postgres
                                   daily cron: /api/cron/purge
```

| Piece | Where | What it does |
| --- | --- | --- |
| Website | Vercel | Serves the static pages in `public/` straight from Vercel's CDN |
| API | Vercel | The [Hono](https://hono.dev) app in [src/index.ts](src/index.ts) answers everything under `/api` |
| Incoming mail | Cloudflare | Email Routing passes every message for your domain to the relay Worker ([relay/worker.ts](relay/worker.ts)), which posts it to `/api/inbound`. The app accepts mail for active inboxes, parses it with [postal-mime](https://github.com/postalsys/postal-mime), detects the OTP and stores it. The relay rejects everything else during delivery |
| Cleanup | Vercel Cron | Once a day, `/api/cron/purge` deletes expired inboxes, their messages and expired sessions |
| Data | Supabase | Users, sessions, inboxes and messages in Postgres |

Vercel can't receive email, which is why mail goes through Cloudflare. The relay Worker stores nothing. It only forwards mail.

**A typical session:**
1. A developer signs up at `/signup/` and lands on `/app/`.
2. They click **Generate address** and get `x7k2p9@yourdomain.com` (copied automatically).
3. They sign up with that address in the app they're building.
4. Their app sends a welcome email. Cloudflare hands it to the relay, the relay posts it to the app, and the app stores it.
5. Within 5 seconds it appears in Burnbox, with the code ready to copy.
6. 24 hours later the address and its mail are gone.

---

## Pages

| Path | Page | Who can see it |
| --- | --- | --- |
| `/` | Landing page: hero with the animated rocket, features, how it works, security, pricing | Everyone |
| `/signup/` | Create an account and start the free trial | Everyone |
| `/login/` | Sign in | Everyone |
| `/app/` | The inbox app: create addresses, read mail, see your plan | Signed-in users |
| `/admin/` | Admin dashboard | The admin only |

All pages are plain HTML, CSS and JavaScript in [public/](public/). There's no framework and no build step.

---

## Plans and pricing

| Plan | Price | Inboxes at a time | How someone gets it |
| --- | --- | --- | --- |
| **Free trial** | Free for 7 days | 4 | Automatically on signup |
| **Pro, monthly** | $5 / £4 / €5 per month | Unlimited | The admin grants it (see below) |
| **Pro, yearly** | $50 / £40 / €50 per year (two months free) | Unlimited | The admin grants it (see below) |
| **Trial ended** | – | 0 new ones | After 7 days without Pro. Existing inboxes stay readable until they expire |

**Currency by location.** Vercel tells the app which country each visitor is in:
- **£4 a month or £40 a year** for the UK, Guernsey, Jersey and the Isle of Man
- **€5 a month or €50 a year** for the eurozone, plus Andorra, Monaco, San Marino, Vatican City, Montenegro and Kosovo
- **$5 a month or $50 a year** everywhere else

The landing page also has a $/£/€ switch.

> **Online payment isn't set up yet.** Users who want Pro see an "Email us to upgrade" button that goes to your `SUPPORT_EMAIL`. You then give them Pro from the admin dashboard. Adding Stripe later only needs a checkout page and a webhook that sets each account's `pro_until` date, because the plan logic already uses it.

---

## What you need

| Requirement | Why |
| --- | --- |
| A [Vercel account](https://vercel.com/signup) | Hosts the website and API |
| A [Supabase account](https://supabase.com/dashboard) | Hosts the Postgres database |
| A [Cloudflare account](https://dash.cloudflare.com/sign-up) | Receives email for your domain and runs the relay Worker |
| **A domain added to Cloudflare** | Email Routing only works on a domain whose DNS is on Cloudflare. Without one, the site works but can't receive email |
| Node.js 20 or newer | To run the migration script, Wrangler (Cloudflare's command-line tool) and the Vercel CLI |

> **Use a domain that doesn't already receive real email.** Turning on Email Routing replaces the domain's mail (MX) records, so mail to an existing mailbox on it (Gmail/Google Workspace, Outlook and so on) would stop arriving. A cheap spare domain, or a subdomain like `test.yourdomain.com`, is the simplest option.

> **Vercel's free Hobby plan is for non-commercial use only.** Burnbox charges for Pro, so once you take payments, Vercel's terms require the Pro plan. See [Plan limits](#plan-limits).

**Don't have a domain yet?** You can still [run everything locally](#run-it-locally) and fake incoming emails. When you're ready to go live, buy a cheap domain. Cloudflare sells them at cost under **Domain Registration** in the dashboard, and a domain bought there is already set up on Cloudflare.

---

## Run it locally

This runs the full app on your computer and simulates incoming emails. No domain or Cloudflare setup needed. You do need a database: either a free Supabase project (step 1 of [Deploy it live](#deploy-it-live)) or a local Postgres.

```bash
npm install
npm i -g vercel                    # the Vercel CLI, once
cp .env.example .env               # then fill in DATABASE_URL, ADMIN_PASSWORD and INBOUND_SECRET
npm run db:migrate                 # creates the database tables
vercel dev                         # starts http://localhost:3000
```

The first time, `vercel dev` asks to link the folder to a Vercel project. Say yes; it creates one if needed.

- **Sign in as the admin** at `http://localhost:3000/login/` with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.
- **Or try it as a user:** create an account at `/signup/`.

**Simulate an incoming email.** First create an inbox called `seller1` in the app. Then post a raw email to the inbound webhook, the way the relay Worker does. The message must include a `Message-ID` header, the address must use your `DOMAIN`, and the secret must be your `INBOUND_SECRET`:

```bash
cat > test.eml <<'EOF'
From: App <no-reply@example.com>
To: seller1@yourdomain.com
Message-ID: <test-1@example.com>
Date: Mon, 16 Nov 2026 10:00:00 +0000
Subject: Your verification code

Your code is 482913.
EOF

curl -X POST "http://localhost:3000/api/inbound?from=no-reply%40example.com&to=seller1%40yourdomain.com" \
  -H "Authorization: Bearer YOUR_INBOUND_SECRET" \
  --data-binary @test.eml
```

The email appears in the inbox within 5 seconds, with `482913` as the detected code.

**Run the cleanup by hand** (with your `CRON_SECRET` from `.env`):
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/purge
```

**Type-check the app and the relay:**
```bash
npm run typecheck
```

> **Testing signups locally:** repeat-signup protection applies here too. After 3 test accounts from your machine, new signups are refused. Reset it by running `DELETE FROM devices;` in Supabase's **SQL Editor** (or with `psql` against your local database).

---

## Deploy it live

### 1. Create the database

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard). Choose a region near your users, and save the database password somewhere safe.
2. Click **Connect** at the top of the project, and copy the **Transaction pooler** connection string (port **6543**). Replace `[YOUR-PASSWORD]` in it with your database password.
3. Put it in `.env` as `DATABASE_URL`, then create the tables:

   ```bash
   npm install
   npm run db:migrate
   ```

   You should see `Applied 001_schema.sql`. If you'd rather not run anything locally, paste [migrations/001_schema.sql](migrations/001_schema.sql) into Supabase's **SQL Editor** and click **Run**.

### 2. Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, click **Add New → Project** and import it. Vercel detects Hono by itself, so leave the build settings alone.
3. Before deploying, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | The transaction pooler string from step 1 |
   | `DOMAIN` | The domain that receives the test emails, e.g. `yourdomain.com` |
   | `ADMIN_EMAIL` | The email you sign in with as admin |
   | `ADMIN_PASSWORD` | A long password |
   | `SUPPORT_EMAIL` | Where "Email us to upgrade" goes. Leave it out to hide the button |
   | `INBOUND_SECRET` | A random value: run `openssl rand -hex 32` |
   | `CRON_SECRET` | A different random value: run `openssl rand -hex 32` again |

4. Click **Deploy**. Vercel gives you a live URL like `https://your-project.vercel.app`.

If you add or change variables later, redeploy (**Deployments → ⋯ → Redeploy**) for them to take effect.

### 3. Add your domain to Cloudflare

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), click **Add a domain** (sometimes labelled **Add site**).
2. Enter your domain, choose the **Free** plan, and continue through the DNS scan.
3. Cloudflare shows two nameservers. At your registrar (where you bought the domain), replace the existing nameservers with those two.
4. Wait until the domain shows **Active**. Usually minutes, sometimes up to 24 hours. Cloudflare emails you when it's done.

If you bought the domain from Cloudflare, skip this step.

### 4. Point the domain at Vercel

The domain's DNS stays on Cloudflare; only the website records point at Vercel.

1. In Vercel, open your project's **Settings → Domains** and add your domain (or a subdomain like `burnbox.yourdomain.com`).
2. Vercel shows the DNS record to create. In Cloudflare, go to **your domain → DNS → Records** and add it. For the bare domain, it's an `A` record pointing to `76.76.21.21`. For a subdomain, it's a `CNAME` to `cname.vercel-dns.com`.
3. Set the record's proxy status to **DNS only** (grey cloud). If Cloudflare proxies it, Vercel can't issue the HTTPS certificate.

Within a few minutes, Vercel's **Domains** page shows the domain as valid.

### 5. Deploy the email relay

The relay is a tiny Cloudflare Worker in [relay/](relay/). First set `APP_URL` in [relay/wrangler.toml](relay/wrangler.toml) to your site's address, for example `https://yourdomain.com`. Then:

```bash
npx wrangler login                                                   # opens your browser to authorise Wrangler
npx wrangler secret put INBOUND_SECRET --config relay/wrangler.toml  # paste the same INBOUND_SECRET as in Vercel
npm run relay:deploy
```

If Wrangler says the Worker doesn't exist yet and offers to create it, answer **yes**.

### 6. Turn on Email Routing

1. In the Cloudflare dashboard, select your domain, then **Email → Email Routing**.
2. Click **Get started** or **Enable Email Routing**. If it asks you to create a first address with a destination mailbox, skip it (look for **Skip getting started**). The relay Worker is the only destination needed.
3. When Cloudflare offers to add its **MX** and **TXT (SPF)** records, click **Add records and enable**. Under **Settings**, the status should show **Enabled**.

These email records sit alongside the website record from step 4. Web and mail traffic don't conflict.

### 7. Send all mail to the relay

1. Go to **Email → Email Routing → Routing rules**.
2. Find **Catch-all address** and click **Edit**.
3. Set **Action** to **Send to a Worker** and **Destination** to `burnbox-email-relay`.
4. Save, and make sure the catch-all is switched **on**.

Mail to any address at your domain now reaches the relay, which passes it to the app. The app accepts only addresses that exist in Burnbox, and the relay rejects the rest.

### 8. Check it works

1. Open `/login/` on your site and sign in with `ADMIN_EMAIL` and your password. You land on `/admin/`.
2. Click **Your inboxes**, generate an address, and send it an email from Gmail.
3. Run through the [test checklist](#test-checklist).

To watch the relay while testing:
```bash
npm run relay:tail
```
The app's own logs are under **your project → Logs** in Vercel.

### Updating after changes

```bash
git push                       # Vercel redeploys the site and API automatically
npm run relay:deploy           # only when relay/ changed
npm run db:migrate             # only when a new file was added to migrations/
```

---

## Configuration reference

### Environment variables (Vercel → Settings → Environment Variables, or `.env` locally)

| Name | Example | What it does |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres.abc:…@aws-0-eu-west-2.pooler.supabase.com:6543/postgres` | The Supabase transaction pooler connection string |
| `DOMAIN` | `yourdomain.com` | The domain inboxes are created on and mail is accepted for |
| `ADMIN_EMAIL` | `you@youremail.com` | Signs in as the admin. Nobody can sign up with it |
| `ADMIN_PASSWORD` | – | The admin's password. Also used to scramble stored IP addresses (see the note under [Repeat-signup protection](#repeat-signup-protection)) |
| `SUPPORT_EMAIL` | `help@yourdomain.com` | Shown to users who want to upgrade. Empty hides the button |
| `INBOUND_SECRET` | – | Shared with the relay Worker. Mail is refused without it |
| `CRON_SECRET` | – | Vercel sends it with each cron request, so nobody else can trigger the cleanup |

`.env` is for local development (copied from [.env.example](.env.example)). Never commit it.

### Relay settings in [relay/wrangler.toml](relay/wrangler.toml)

| Name | Kind | What it does |
| --- | --- | --- |
| `APP_URL` | Variable | Where the site is hosted. Mail is posted to `APP_URL/api/inbound` |
| `INBOUND_SECRET` | Secret (`npx wrangler secret put INBOUND_SECRET --config relay/wrangler.toml`) | Must match `INBOUND_SECRET` in Vercel |

### Cleanup schedule in [vercel.json](vercel.json)

The cleanup runs daily at 04:00 UTC (`0 4 * * *`). That's the most often the Hobby plan allows, and it's enough, because an inbox counts as gone the moment it expires. On Vercel Pro you can make it hourly (`0 * * * *`).

### Limits and timings in [src/config.ts](src/config.ts)

| Constant | Default | Meaning |
| --- | --- | --- |
| `INBOX_TTL_MS` | 24 hours | How long an inbox lives |
| `MAX_EMAIL_BYTES` | 256 KB | Larger emails bounce. Keep the copy in [relay/worker.ts](relay/worker.ts) in step |
| `MAX_MESSAGES_PER_INBOX` | 50 | Older messages are dropped |
| `RANDOM_NAME_LENGTH` | 6 | Length of random addresses |
| `SESSION_TTL_MS` | 30 days | How long someone stays signed in |
| `TRIAL_MS` | 7 days | Free trial length |
| `TRIAL_MAX_INBOXES` | 4 | Inboxes at a time on the trial |
| `PRO_GRANT_MS` | 31 days | What one "Give 1 month Pro" click adds |
| `PRO_YEAR_GRANT_MS` | 365 days | What one "Give 1 year Pro" click adds |
| `SIGNUPS_PER_NETWORK` | 3 | Max new accounts per network… |
| `SIGNUP_NETWORK_WINDOW_MS` | 30 days | …within this window |

---

## Using the admin dashboard

Sign in at `/login/` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, and you land on `/admin/`.

**Totals at the top:** customers (and new in the last 7 days), on trial, Pro, trial ended, active inboxes (and emails in the last 24 hours), and signups blocked as repeats in the last 30 days.

**Accounts list:** search by email or name, and filter by All, Trial, Pro, Ended or Disabled. Each account shows its plan, active inboxes, join date, last sign-in and country. On phones and tablets each account becomes a card.

**Actions per account:**

| Button | What it does |
| --- | --- |
| **Give 1 month Pro** / **+1 month Pro** | Adds 31 days of Pro, on top of any Pro they already have |
| **Give 1 year Pro** / **+1 year Pro** | Adds 365 days of Pro, on top of any Pro they already have. For customers who pay yearly |
| **Remove Pro** | Ends Pro immediately |
| **+7 days trial** | Adds 7 days to their trial |
| **Disable** / **Enable** | Disabling signs them out and blocks sign-in. Their data stays |
| **Delete** | Deletes the account, its inboxes and emails. Can't be undone |

**Upgrading someone who emailed you:** search for their email, then click **Give 1 month Pro** if they pay monthly, or **Give 1 year Pro** if they pay for a year. Click again each time they renew. Clicks add up, so you can also give several months at once.

The **Your inboxes** link opens `/app/`, so you can use Burnbox yourself. The admin account has no inbox limit.

---

## Test checklist

**☐ Signing up works**
1. Open `/signup/` in a private window and create an account.
2. You land on `/app/` showing **Free trial · 7 days left · 0 of 4 inboxes**.

**☐ Email arrives**
1. Click **Generate address** (it's copied automatically).
2. Send an email to it from Gmail or any real mailbox.
3. Within a few seconds it appears ("Live · every 5s" in the header). Open it, check the HTML renders, and check **Load images** shows remote images.

**☐ OTP is detected**
1. Send an email with the subject `Your verification code` and the body `Your code is 482913.`
2. The list row shows a yellow `482913` chip, and the opened email shows the code large with **Copy code**.

**☐ The trial limit applies**
1. Create 4 inboxes, then try a 5th. You get a message about the limit and the upgrade popup.
2. In the admin dashboard, give that account a month of Pro. It can now create more.

**☐ Unknown addresses are rejected**
1. Send an email to `doesnotexist123@yourdomain.com`.
2. You get a bounce saying "Unknown recipient", and **Email → Email Routing → Activity log** in Cloudflare shows it as **Rejected**.
3. Optional: send an attachment over 256 KB to a real inbox. It bounces with "Message too large".

**☐ Expired inboxes are removed**

Rather than waiting 24 hours, force an inbox to expire. In Supabase's **SQL Editor**, run:
```sql
UPDATE inboxes SET expires_at = 0 WHERE address = 'seller1@yourdomain.com';
```
1. Within 5 seconds it disappears from the app, and new mail to it bounces.
2. Run the cleanup now instead of waiting for the daily run: in Vercel, open **Settings → Cron Jobs** and click **Run** next to `/api/cron/purge`. Then confirm the rows are gone:
   ```sql
   SELECT COUNT(*) AS n FROM messages WHERE address = 'seller1@yourdomain.com';
   ```
   `n` should be `0`.

---

## How mail is handled

- **Only active inboxes accept mail.** Mail to unknown or expired addresses is refused during delivery, so the sender gets a bounce and nothing is stored. This also keeps spam out of the database.
- **The relay.** Cloudflare passes each message to [relay/worker.ts](relay/worker.ts), which posts the raw email to `/api/inbound` with the `INBOUND_SECRET`. The app answers `200` (stored), `404` (unknown recipient) or `413` (too large), and the relay turns anything other than `200` into a rejection. If the app can't be reached, the message is rejected rather than lost silently.
- **Size limits.** Emails over 256 KB are refused. Attachments are never stored. Each inbox keeps its newest 50 messages.
- **Plus addressing.** `seller1+anything@yourdomain.com` is delivered to `seller1@…`, so one inbox can take any number of unique signups.
- **OTP detection** ([src/otp.ts](src/otp.ts)). Burnbox looks for a standalone 4–8 digit code in the subject, then the body. A code next to a word like "code", "verification" or "2FA" wins over an earlier bare number. Prices, phone numbers, dates, `#order` numbers and digits inside links are skipped.
- **Verification links.** Links are listed with the most likely verification link first, judged by words like `verify`, `confirm`, `activate`, `token` and `magic`.
- **Expiry.** An inbox counts as gone the moment it expires. The daily cron then deletes the rows.
- **Address rules.** Custom names are 3–30 characters of `a–z 0–9 . -`, and can't start or end with `.` or `-` or contain `..`, because mail servers reject those.

---

## Repeat-signup protection

The free trial is one per person. To stop someone making account after account on the same device, a signup is refused when **any** of these is true:

1. **Same device.** This browser already signed up or signed in. Burnbox keeps a random device ID in both a cookie and browser storage, so clearing one isn't enough.
2. **Same browser on the same network.** A fingerprint of the browser (screen, timezone, graphics, fonts and so on) matches an earlier account *and* the network matches too.
3. **Too many from one network.** 3 accounts were already created from this network in the last 30 days. Offices and shared Wi-Fi get a few.

The person sees "An account was already created on this device. Sign in to it instead." The admin dashboard counts blocked attempts.

**Good to know:**
- **It's a speed bump, not a wall.** A different browser on a different network gets through.
- **What's stored.** Raw IP addresses are never stored. They're hashed with `ADMIN_PASSWORD` mixed in, so the hashes can't be reversed.
- **Changing `ADMIN_PASSWORD`** changes those hashes, so earlier signups stop counting towards a network's limit of 3.
- **Deleting an account** keeps its device records, so it doesn't free up that device for a new trial.
- **Privacy law.** If you have users in the UK or EU, mention device identifiers and fingerprinting in your privacy policy.

---

## API reference

All routes are JSON. Everything except signup, login, logout and pricing needs the session cookie. Requests that change something (POST, DELETE) from another website are refused.

### Accounts

| Method | Path | Body | Responses |
| --- | --- | --- | --- |
| POST | `/api/signup` | `{ email, password, name?, device_id?, fingerprint? }` | `201`; `400` invalid; `409` email taken; `429` repeat signup |
| POST | `/api/login` | `{ email, password }` | `200` and a 30-day session cookie; `401` wrong details; `403` disabled |
| POST | `/api/logout` | – | Ends the session |
| GET | `/api/session` | – | `{ user, plan, trial_ends_at, pro_until, inbox_limit, active_inboxes, price, support_email, domain, ttl_ms, now }` |
| GET | `/api/pricing` | – | Public. `{ country, currency, prices, trial }` |

### Inboxes and mail (scoped to the signed-in account)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/inboxes` | `{ "name"?: "seller1" }`. Random name if omitted. `400` invalid, `409` taken, `403` trial limit, `402` trial ended |
| GET | `/api/inboxes` | Your active inboxes, with `expires_in_ms` and `message_count` |
| GET | `/api/inboxes/:address/messages` | Newest first, max 50 |
| GET | `/api/messages/:id` | Full message, text and HTML |
| DELETE | `/api/inboxes/:address` | Deletes the inbox and its mail now |

### Admin (admin account only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/admin/overview` | Totals and every account |
| POST | `/api/admin/users/:id` | `{ action }`: `grant_pro` (1 month), `grant_pro_year` (1 year), `revoke_pro`, `extend_trial`, `end_trial`, `disable`, `enable` |
| DELETE | `/api/admin/users/:id` | Deletes the account, its inboxes and mail |

### Internal (secret required, not for browsers)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/inbound?to=…&from=…` | The raw email as the body, `Authorization: Bearer INBOUND_SECRET`. `200` stored, `404` unknown recipient, `413` too large, `401` wrong secret |
| GET | `/api/cron/purge` | `Authorization: Bearer CRON_SECRET`. Returns how many inboxes and messages were deleted |

---

## Database

Postgres on Supabase. The tables are created by the files in [migrations/](migrations/), applied with `npm run db:migrate`, which records each file it has run in a `schema_migrations` table. All times are Unix milliseconds, stored as `BIGINT`.

| Table | Holds |
| --- | --- |
| `users` | Email, name, password hash, role (`user`/`admin`), trial end, Pro end, disabled flag, country |
| `sessions` | SHA-256 of each session token, owner, expiry |
| `inboxes` | Address, owner, created and expiry times |
| `messages` | Sender, subject, text and HTML body, detected OTP, received time |
| `devices` | Device IDs, browser fingerprints and hashed IPs seen at signup and sign-in |
| `signup_blocks` | One row per refused repeat signup, for the dashboard count |

Deleting a user deletes their sessions, inboxes and messages; deleting an inbox deletes its messages. Device records are kept, with the owner cleared.

Every table has Row Level Security switched on with no policies. That blocks Supabase's public REST API from reading the data, password hashes included. The app connects as the `postgres` role, which RLS doesn't apply to, so it's unaffected. Don't add policies unless you mean to expose a table.

**Running SQL directly:** open **SQL Editor** in the Supabase dashboard, for example:
```sql
SELECT email, trial_ends_at, pro_until FROM users;
```
The **Table Editor** shows the same data as spreadsheets.

---

## Project layout

```
vercel.json                    Daily cleanup cron and security headers
.env.example                   The environment variables, for local development
migrations/
  001_schema.sql               All tables, indexes and Row Level Security
scripts/
  migrate.mjs                  Applies new migration files (npm run db:migrate)
relay/
  worker.ts                    Cloudflare Worker: forwards incoming mail to /api/inbound
  wrangler.toml                The relay's settings (APP_URL)
src/
  index.ts                     Entry: the Hono app, inbound mail webhook, cleanup cron route
  api.ts                       JSON API routes
  auth.ts                      Sign-up, sign-in, sessions, repeat-signup blocking
  admin.ts                     Admin API
  users.ts                     Account, session and device queries
  db.ts                        Inbox and message queries
  sql.ts                       The Postgres connection
  env.ts                       Reads the environment variables
  plans.ts                     Trial/Pro rules and local-currency prices
  crypto.ts                    Password hashing and tokens
  email.ts                     Incoming mail: check the recipient, parse, store
  otp.ts                       OTP detection and HTML-to-text
  address.ts                   Address validation, random names, plus addressing
  config.ts                    Limits and timings
  types.ts                     Shared types
public/
  index.html, landing.css, landing.js     Landing page (/)
  signup/, login/, auth.js                Sign-up and sign-in pages
  app/, app.js                            The inbox app (/app/)
  admin/, admin.js                        Admin dashboard (/admin/)
  styles.css                              Shared styles: colours, buttons, cards, the app and admin
  img/people/                             The six illustrated people
  favicon.svg, robots.txt
```

---

## Customising

| To change… | Edit |
| --- | --- |
| **Prices** | `PRICES` in [src/plans.ts](src/plans.ts): `amount` is the monthly price and `yearly` the yearly one. Also update the fallback prices in [public/landing.js](public/landing.js) and the default `$5` and `$50` text in [public/index.html](public/index.html), [public/signup/index.html](public/signup/index.html) and [public/app/index.html](public/app/index.html), which show before the real price loads |
| **Which countries get £ or €** | `POUND_COUNTRIES` and `EURO_COUNTRIES` in [src/plans.ts](src/plans.ts) |
| **Trial length, trial inbox limit, inbox lifetime** | [src/config.ts](src/config.ts). Then update the wording on the landing, signup and pricing pages to match |
| **Colours and fonts** | The variables at the top of [public/styles.css](public/styles.css) (`--accent` is the orange) |
| **The rocket's flight** | The timings (`ENTRY`, `POWER_DOWN`, `LOOP`, `RELIGHT`, `EXIT`, `REST`) and path in [public/landing.js](public/landing.js). Its size is `--rk` in [public/landing.css](public/landing.css) |
| **The name** | Search for "Burnbox" in `public/` and this README |

---

## Security

- **Passwords** are hashed with PBKDF2-SHA256 (100,000 iterations, random salt per user).
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie that lasts 30 days. Only a SHA-256 of each token is stored, so a database leak can't be used to sign in.
- **Sign-in attempts** are slowed down after failures. The admin password and the inbound and cron secrets are compared in constant time.
- **Cross-site requests:** POST and DELETE requests coming from other websites are refused.
- **Isolation:** each account sees only its own inboxes and mail.
- **Database:** Row Level Security keeps Supabase's public API out of every table (see [Database](#database)). The connection string in `DATABASE_URL` is the only way in, so keep it secret.
- **Incoming mail** is only accepted with the `INBOUND_SECRET`, so nobody can post fake emails into inboxes.
- **HTML emails** render in a sandboxed iframe with scripts and forms disabled, and an opaque origin, so they can't reach the app or its cookies. Links open in a new tab with no referrer. Remote images, CSS and fonts (and so tracking pixels) stay blocked until you click **Load images**.
- **Static files** in `public/` contain no data; everything personal goes through the signed-in API. [vercel.json](vercel.json) sets a strict Content-Security-Policy and asks search engines not to index the site.
- **Extra protection:** in Vercel, add a rate-limiting rule under **your project → Firewall** for `POST /api/login` and `POST /api/signup`, for example 5 requests per 10 seconds per IP.

---

## Plan limits

| Service | Free plan | Burnbox's use |
| --- | --- | --- |
| **Vercel** (Hobby) | Non-commercial use only. A monthly allowance of function invocations and CPU time | An open, visible inbox tab makes about 2 requests every 5 seconds (about 35,000 a day if left open all day). It stops when the tab is hidden. One daily cron job |
| **Supabase** (Free) | 500 MB database. Projects pause after a week without activity | At most 50 messages × 256 KB per inbox, deleted after 24 hours |
| **Cloudflare** (Free) | Email Routing is free. Workers get 100,000 requests a day | One relay request per incoming email |

Two things to plan for:
- **Vercel Pro** is required once Burnbox makes money, because Hobby is non-commercial. Pro also raises the request allowance and allows an hourly cleanup.
- **Supabase's free plan pauses** an inactive project. A live service with regular users stays active. If it pauses, restore it from the Supabase dashboard, or move to Supabase Pro to stop pausing altogether.

Allowances change; check [vercel.com/pricing](https://vercel.com/pricing) and [supabase.com/pricing](https://supabase.com/pricing) for current numbers.

---

## Troubleshooting

**Emails never arrive**
- Check **Email → Email Routing → Settings** in Cloudflare shows **Enabled** and the MX records are configured.
- Check the **Catch-all** rule is on and set to **Send to a Worker → burnbox-email-relay**.
- Run `npm run relay:tail` and send again. The relay logs each message the app refuses, with its status code:

  | Status | Meaning | Fix |
  | --- | --- | --- |
  | `401` | The secrets don't match | Set the same `INBOUND_SECRET` in Vercel and on the relay, then redeploy both |
  | `404` | No active inbox at that address | See "Unknown recipient" below |
  | `500` | App error | Check **Logs** in Vercel. Often a wrong `DATABASE_URL` |
  | "Couldn't reach the app" | Wrong `APP_URL` | Fix it in [relay/wrangler.toml](relay/wrangler.toml) and run `npm run relay:deploy` |

**Emails bounce with "Unknown recipient"**
- The inbox doesn't exist, has expired, or was created under a different `DOMAIN`. Check `DOMAIN` in Vercel matches the domain you're sending to exactly, then generate a fresh inbox.

**The site shows "Internal error" or won't sign in**
- Check **Logs** in Vercel. "Missing environment variable" means a variable from step 2 isn't set (redeploy after adding it). A connection error means `DATABASE_URL` is wrong: use the **Transaction pooler** string on port 6543, with your password filled in.
- If the Supabase project was paused, restore it from the Supabase dashboard.

**I can't sign in as admin**
- Use exactly the `ADMIN_EMAIL` set in Vercel, and redeploy after changing it or `ADMIN_PASSWORD`.

**Vercel says the domain is misconfigured**
- The Cloudflare record must be **DNS only** (grey cloud), and must match the record Vercel shows exactly.

**"An account was already created on this device" while testing**
- That's the [repeat-signup protection](#repeat-signup-protection). Clear it by running `DELETE FROM devices;` in Supabase's SQL Editor. This clears it for everyone, so only do it while testing.

**Prices show in dollars when I expected pounds or euros**
- The currency comes from Vercel's country lookup for your connection. VPNs change it. Locally there's no lookup, so it always shows dollars.

**Changes don't show up after deploying**
- Hard-refresh the page (Cmd+Shift+R or Ctrl+Shift+R). Browsers cache CSS and JavaScript.

---

## FAQ

**Is there a backend?**
Yes. The Hono app in [src/](src/) is the backend: API, accounts, mail handling and cleanup. Vercel runs it as a serverless function and serves the pages in `public/` alongside it.

**Why are there three services?**
Each does one job: Vercel hosts the site, Supabase stores the data, and Cloudflare receives the email, because Vercel can't. The Cloudflare part is one small Worker that never needs changing.

**Could it run on Cloudflare alone?**
Yes. An earlier version of Burnbox ran entirely on Cloudflare, with Workers and a D1 database. That's in this repository's git history if you want it back.

**Can I use it without a domain?**
Locally, yes ([Run it locally](#run-it-locally)). Live, you need a domain on Cloudflare to receive email.

**Can people use it to sign up for other websites?**
Technically yes, but every inbox deletes itself after 24 hours. Password resets and "verify it's you" emails won't reach them after that, so it's only suitable for accounts nobody minds losing. Burnbox is built for testing your own apps.

**How do I take real payments?**
Not built yet. The simplest route is Stripe Checkout with two prices, $5/£4/€5 monthly and $50/£40/€50 yearly, plus a webhook that sets `pro_until` on the account when a payment succeeds (a month or a year ahead). The admin dashboard and plan logic already work from `pro_until`.

# LeePlugsHub: Technical Documentation

Inventory, point of sale, credit ledger and customer messaging for a multi-branch gadget retailer.

This document covers what the system does, how it is built, how to install it on your own computer, and how to put it on the internet. Three hosting options are covered: managed cloud, a VPS and shared hosting. It ends with operating notes, troubleshooting and a command reference.

The quick tour is the project's `README.md`. This file is the complete reference.

---

## Contents

1. [What the system does](#1-what-the-system-does)
2. [How it is built](#2-how-it-is-built)
3. [Requirements](#3-requirements)
4. [Installing on your own computer](#4-installing-on-your-own-computer)
5. [Configuration reference](#5-configuration-reference)
6. [Choosing where to host it](#6-choosing-where-to-host-it)
7. [Option A: Vercel and a managed database (recommended)](#7-option-a-vercel-and-a-managed-database-recommended)
8. [Option B: a VPS (Ubuntu, Nginx, systemd)](#8-option-b-a-vps-ubuntu-nginx-systemd)
9. [Option C: shared hosting (cPanel with Node.js)](#9-option-c-shared-hosting-cpanel-with-nodejs)
10. [After installing: first owner, branches, staff, messaging](#10-after-installing-first-owner-branches-staff-messaging)
11. [Scheduled jobs](#11-scheduled-jobs)
12. [Running it: backups, monitoring, updates](#12-running-it-backups-monitoring-updates)
13. [Security model](#13-security-model)
14. [Using the app, by role](#14-using-the-app-by-role)
15. [Troubleshooting](#15-troubleshooting)
16. [Command reference](#16-command-reference)
17. [Limits and things not built](#17-limits-and-things-not-built)

---

## 1. What the system does

| Area | What it covers |
|---|---|
| **Branches and stock** | Several stores and a warehouse. Devices (phones, laptops, consoles, watches) are tracked one by one by IMEI or serial number, and accessories by quantity per branch. Low-stock and 60-day aging alerts are raised automatically. |
| **Stock intake and suppliers** | Receive stock against a supplier with payment terms (paid, deposit, Net 7/15/30). Supplier balances come from the records, and barcode labels can be printed. |
| **Transfers** | Move stock between branches: Draft → In transit → Received. A printable waybill lists every IMEI. Stock in transit can't be sold. |
| **Point of sale** | One search box for product, SKU, barcode or IMEI, built to work with barcode scanners. Supports discounts, VAT, trade-ins, split payments (cash, transfer, POS card) and instalment plans with schedule preview and manager approval. |
| **Documents** | A4 PDF invoice, 80 mm thermal receipt, PDF warranty certificate and a public warranty-check page reached by QR code. |
| **Credit ledger** | Repayments at any branch, oldest instalment first. Balances are always recomputed from the payment records. Owners can reverse payments and waive debt. Aging reports cover both receivables and payables. |
| **Returns, swaps, voids** | Returns restock or quarantine items and refund the customer. A swap is a return plus a new sale. Voiding cancels a sale made in error. |
| **Stock adjustments and counts** | Damage, loss, theft, finds and repairs, each with a reason. A stock count compares the shelf with the system and records the differences. |
| **Cash-up** | Each person counts their own drawer without seeing the expected figure first (a blind count). The figures then lock, and a manager signs off. |
| **Customer messages** | Receipts, warranty cards, instalment reminders (3 days before, on the day, then 1, 7 and 14 days late) and payment confirmations. Sent by WhatsApp, falling back to SMS, with a full delivery log. |
| **Dashboard and reports** | Sales, cash collected, profit (owner only), receivables, payables, inventory value and alerts, for one branch or all. |
| **Administration** | Users and roles, branches, VAT, message templates, provider keys, an audit log, system health, and two-factor sign-in. |
| **Privacy** | Public privacy notice. Each customer's notice is recorded, and customer data can be exported or erased (Nigeria Data Protection Act 2023). |

**Roles:** Owner (everything, every branch), Branch manager (their own branch), Cashier (sell, collect and look up stock at their own branch). Section 13 lists the exact rules.

---

## 2. How it is built

### Stack

| Layer | Technology |
|---|---|
| Web framework | Next.js 16 (App Router, Cache Components) with React 19 and TypeScript (strict) |
| UI | Tailwind CSS 4, shadcn/ui, lucide-react icons, TanStack Table, Recharts |
| Forms | react-hook-form and Zod; the same Zod schema validates in the browser and on the server |
| Database | PostgreSQL through Prisma ORM 7 (`@prisma/adapter-pg`, no native query engine) |
| Sign-in | next-auth v4 with email and password (bcrypt hashes), JWT sessions, and TOTP two-factor |
| PDFs and codes | `@react-pdf/renderer`, `bwip-js` (Code 128 labels), `qrcode` |
| Messaging | Adapters for WhatsApp Cloud API, Twilio (WhatsApp and SMS), Termii (SMS), and a console adapter for development |
| Tests | Vitest (282 unit and integration tests against a real database) and a Playwright checkout smoke test |
| Package manager | pnpm (version pinned in `package.json` → `packageManager`) |

### How a request flows

```
Browser ──> proxy.ts (sign-in redirect only) ──> page or server action
                                               │  validates input (Zod), gets the session
                                               ▼
                                      src/server/services/*   ← all business rules live here
                                      can(ctx, action) check · one database transaction
                                      ledger maths · audit row · stock moves
                                               │
                                               ▼
                                      PostgreSQL (CHECK constraints, append-only triggers)
                                               │ after commit
                                               ▼
                                      notifications queue → WhatsApp / SMS providers
```

### Rules the code never breaks

1. **Money is never a floating-point number.** Amounts are stored as `Decimal(14,2)` and calculated with decimal.js.
2. **Every stock or money change runs in one database transaction, together with its audit row.** If the audit row fails, the change fails too.
3. **A device is in exactly one place with exactly one status.** Selling uses a conditional update, so two tills can't sell the same IMEI.
4. **Balances are rebuilt from the records.** Invoice and plan totals are recomputed from payment, waiver and return rows, and database CHECK constraints make them add up.
5. **Financial records are never deleted.** Invoices are voided or returned, and payments are reversed with an offsetting row. The audit log, stock adjustments and submitted cash-ups can't be changed, and the database enforces that.
6. **Permissions are enforced on the server.** Branch limits and cost-price hiding happen in the services, not just in the screens.
7. **Messages never block a sale.** The sale is saved first, then messages are queued. Repeats are harmless because each message has a unique key.

### Folder layout

```
prisma/                 schema.prisma, migrations/ (SQL incl. triggers & CHECKs), seed.ts
src/app/                pages (App Router) and API routes
  (auth)/login          sign-in
  (account)/account     own password, two-factor, devices
  (app)/…               the signed-in app: dashboard, pos, invoices, customers, inventory,
                        transfers, suppliers, ledger, cash-up, reports, notifications, audit, settings
  (print)/print/…       thermal receipt, barcode labels
  api/cron/*            scheduled jobs (Bearer CRON_SECRET)
  api/pdf/*             invoice / warranty / waybill PDFs (session or signed link)
  api/webhooks/*        message delivery callbacks
  api/health            health check
  w/[publicId]          public warranty check
  privacy               public privacy notice
src/server/
  services/             business logic (one file per area)
  auth/                 session, permissions (can()), TOTP
  notifications/        message queue, templates, provider adapters
  ops/                  logging, alerts, job tracking, integrity checks
  pdf/                  PDF documents
src/lib/                money, dates (Africa/Lagos), phone (E.164), validators
scripts/                cron-local, create-owner, reset-two-factor, db-grant-app-role,
                        verify-ledger, backup.sh, restore-drill.sh
server.cjs              startup file for hosts that run a Node file (cPanel/Passenger, PM2)
```

---

## 3. Requirements

| Component | Requirement | Notes |
|---|---|---|
| **Node.js** | **24 LTS** (recommended), or 22.12+ or 20.19+ | Prisma 7 requires one of these. Development and CI use 24. |
| **pnpm** | the version in `package.json`, currently **12.21.0** | Get it with Corepack (`corepack enable`) or run it as `npx pnpm@12.21.0 …`. |
| **PostgreSQL** | **PostgreSQL** (MySQL and MariaDB won't work) | Tested on 18. A managed version 16 or newer should work. Run `pnpm db:verify` after migrating to confirm. |
| **Memory** | 2 GB+ free for `pnpm build`; about 300–500 MB while running | A smaller server should build on another machine and upload the result (section 9.6). |
| **Network** | Outbound HTTPS to messaging providers; inbound HTTPS for webhooks | |
| **Clock** | Server clock synchronised (NTP) | Two-factor codes and signed links depend on correct time. |
| Development only | Docker (for the local database), Git | Optional if you install PostgreSQL directly. |

---

## 4. Installing on your own computer

Works on macOS, Linux, and Windows inside **WSL2** (Ubuntu). On Windows, run every command in the WSL terminal, not PowerShell.

### 4.1 Install the tools

```bash
# Node 24 (via nvm; any installer is fine)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 24 && nvm use 24

# pnpm, at the version the project pins
corepack enable
corepack prepare pnpm@12.21.0 --activate

# Docker Desktop (or Docker Engine on Linux) for PostgreSQL
```

Without Docker, install PostgreSQL directly instead:
- **macOS:** `brew install postgresql@18`
- **Ubuntu:** the PostgreSQL apt repository

Then create a user and a database both named `gadgethub` with password `gadgethub`, or change `DATABASE_URL` to match yours.

### 4.2 Get the code and install dependencies

```bash
git clone <your-repository-url> leeplugshub
cd leeplugshub
pnpm install            # also generates the Prisma client (postinstall)
```

### 4.3 Configure

```bash
cp .env.example .env
```

Fill these in. The other variables can stay empty for local use.

```bash
AUTH_SECRET=<openssl rand -base64 32>
CRON_SECRET=<openssl rand -base64 32>
DOCUMENT_SIGNING_SECRET=<openssl rand -base64 32>
# DATABASE_URL already points at the Docker database; APP_URL is http://localhost:3000
```

`WHATSAPP_PROVIDER=console` and `SMS_PROVIDER=console` print messages to the terminal instead of sending them.

### 4.4 Start the database, create the tables, load sample data

```bash
docker compose up -d db          # PostgreSQL 18 on localhost:5432
pnpm prisma migrate dev          # creates every table, trigger and constraint
pnpm db:seed                     # sample branches, staff, products, sales, a plan, transfers
```

The seed prints the demo logins. The password for all of them is `GadgetHub!2026` unless you set `SEED_PASSWORD`.

| Email | Role |
|---|---|
| `owner@gadgethub.test` | Owner |
| `manager.ikj@gadgethub.test` | Branch manager, Ikeja |
| `cashier.ikj@gadgethub.test` | Cashier, Ikeja |

The seed refuses to run in production or on a database that already has real users. That is deliberate.

### 4.5 Run it

```bash
pnpm dev                         # http://localhost:3000
pnpm cron:local                  # optional, second terminal: runs the scheduled jobs on schedule
pnpm cron:local --run all        # or: run every job once, now
```

### 4.6 Check that everything works

```bash
pnpm lint && pnpm typecheck      # code quality
pnpm test                        # 282 tests; creates and uses a separate "<db>_test" database
pnpm test:e2e                    # browser smoke test: first time, run `pnpm exec playwright install chromium`
pnpm db:verify                   # ledger, stock and safeguard checks on your database
```

`pnpm test:e2e` builds the app and serves it on port 3100. It uses its own `<db>_e2e` database and runs the server as the restricted database login (section 13). It never touches your dev data.

> **After pulling changes that include a migration:** run `pnpm prisma migrate dev`, then **restart `pnpm dev`**.
> The running dev server keeps the old database client. Until you restart it, pages fail with "Unknown field … for select statement".

---

## 5. Configuration reference

Every variable lives in `.env` locally, or in the host's environment or secret settings. `.env.example` lists them all with comments. Never commit `.env`.

### Required

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://gadgethub_app:…@host:5432/gadgethub?sslmode=require` | The database login the **running app** uses. In production, this is the restricted login (section 13). |
| `APP_URL` | `https://shop.leeplugshub.com` | Public address. Used for message links, QR codes, webhooks and sign-in callbacks. Use https in production; it also turns on HSTS. |
| `AUTH_SECRET` | 32+ random bytes | Signs sign-in sessions. Changing it signs everyone out. |
| `CRON_SECRET` | 32+ random bytes | Every `/api/cron/*` call must send `Authorization: Bearer <this>`. |
| `DOCUMENT_SIGNING_SECRET` | 32+ random bytes | Signs the expiring PDF links sent to customers. Changing it breaks links already sent. |

Generate each secret with `openssl rand -base64 32`.

### Production database

| Variable | Purpose |
|---|---|
| `MIGRATION_DATABASE_URL` | The **owner** login, used by `prisma migrate deploy`, the seed and the `pnpm db:*` / `user:*` scripts. If empty, those use `DATABASE_URL`. |
| `APP_DB_PASSWORD`, `APP_DB_ROLE` | Used only by `pnpm db:grant-app`: the restricted login's password (16+ characters) and name (default `gadgethub_app`). |

### Security and behaviour

| Variable | Default | Purpose |
|---|---|---|
| `SETTINGS_ENCRYPTION_KEY` | derived from `AUTH_SECRET` | Encrypts provider keys saved in Settings (32 bytes, base64). If you change it, re-enter the saved keys. |
| `REQUIRE_OWNER_2FA` | on in production | Set to `true` or `false` to force two-factor for owners on or off. |
| `CLIENT_IP_HEADER` | empty | The header carrying the real client IP, e.g. `cf-connecting-ip` behind Cloudflare. Not needed on Vercel. |
| `TRUSTED_PROXY_COUNT` | `1` | Otherwise: how many proxies add to `X-Forwarded-For` (Nginx or LiteSpeed in front = 1). |
| `SEED_PASSWORD` | `GadgetHub!2026` | Password for the seeded demo logins. |
| `SEED_ALLOW_PRODUCTION`, `SEED_ALLOW_REAL_DATA` | empty | Overrides for the seed's safety checks. Use only for a throwaway demo. |

### Messaging

These can also be set in **Settings → Messaging providers**, where keys are stored encrypted. Settings take priority over environment variables.

| Variable | Purpose |
|---|---|
| `WHATSAPP_PROVIDER` | `whatsapp-cloud`, `twilio` or `console` |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_ACCESS_TOKEN` | Meta WhatsApp Cloud API credentials |
| `WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_CLOUD_APP_SECRET` | Webhook handshake and signature check |
| `WHATSAPP_CLOUD_API_VERSION` | Graph API version (default `v23.0`) |
| `SMS_PROVIDER` | `termii`, `twilio` or `console` |
| `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_BASE_URL`, `TERMII_CHANNEL`, `TERMII_WEBHOOK_TOKEN` | Termii SMS |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_SMS_FROM` | Twilio |

### Alerts to the people running the store

| Variable | Purpose |
|---|---|
| `ALERT_WEBHOOK_URL` | Slack- or Discord-compatible incoming webhook |
| `ALERT_PHONE` | Phone number for SMS alerts (uses the SMS provider) |

### Settings stored in the database (edited in the app)

| Setting | Where | Default |
|---|---|---|
| Store details, VAT rate, bank details for payment instructions | Settings → Business | seeded |
| Instalment approval threshold, minimum down payment % | Settings → Business | seeded |
| Message templates | Settings → Message templates | seeded |
| `privacy.messageRetentionDays` | database row | 365 |
| `cashup.startedAt` | set by migration | when cash-up was installed |

---

## 6. Choosing where to host it

The app is a **Node.js server** with a **PostgreSQL** database and **four scheduled jobs**. Before choosing a host, check all three:

| | **A. Vercel + managed Postgres** | **B. VPS** | **C. Shared hosting (cPanel)** |
|---|---|---|---|
| Effort | Lowest | Medium (you run Linux) | Medium, with surprises |
| Typical cost | Vercel Pro about $20/month; database free–$25 | $6–12/month | $3–10/month |
| Node.js 20.19+/22.12+/24 | ✅ | ✅ | Only if the plan has "Setup Node.js App" with a recent version |
| PostgreSQL | Separate provider (Neon, Supabase) | Install it yourself or use managed | Often **only MySQL** → then use an external Postgres |
| Build (2 GB+ RAM) | ✅ | ✅ | Often killed for using too much memory → build elsewhere and upload |
| 15-minute scheduled job | ✅ on Pro (Hobby allows daily only) | ✅ systemd timer / cron | ✅ cPanel Cron Jobs (if 15-minute schedules are allowed) |
| Backups with point-in-time recovery | ✅ via the database provider | Your job | Your job, or via an external database |
| Restricted database login (section 13) | ✅ | ✅ | Often impossible (you can't create database roles) |
| **Verdict** | **Recommended** | **Good value** if you're comfortable with Linux | **Possible**, if it meets every requirement in 9.1 |

**What to ask a shared host before you pay:**
- Does the plan include "Setup Node.js App"? Which Node versions does it offer?
- Can I create **PostgreSQL** databases and choose their users and permissions?
- Is there SSH access? How much memory can a process use?
- How often can cron jobs run?
- Do you have a Lagos or Europe location?

A "no" to Node.js or PostgreSQL means Option C won't work on that plan.

---

## 7. Option A: Vercel and a managed database (recommended)

1. **Create the database.** Use a managed PostgreSQL provider with automatic backups and **point-in-time recovery**, such as Neon or Supabase, in a Europe region close to Lagos. You get an **owner** connection string. Use the pooled connection for the app and the direct one for migrations if the provider gives both.
2. **Set up the schema.** On your computer, with the owner URL:
   ```bash
   MIGRATION_DATABASE_URL='postgresql://owner:…@…/db?sslmode=require' pnpm prisma migrate deploy
   MIGRATION_DATABASE_URL='…owner…' APP_DB_PASSWORD='<long random>' pnpm db:grant-app
   MIGRATION_DATABASE_URL='…owner…' pnpm db:verify
   ```
   `db:grant-app` creates `gadgethub_app`, the restricted login. Build `DATABASE_URL` from it: same host and database, user `gadgethub_app` with that password.

   On Supabase or Neon, if creating roles is refused, create the role in the provider's dashboard, then re-run `db:grant-app` with `APP_DB_ROLE` set to that role's name.
3. **Create the Vercel project.** Import the Git repository. The framework (Next.js) and build command are detected automatically.
4. **Set environment variables** (Production): `DATABASE_URL` (the restricted login), `MIGRATION_DATABASE_URL`, `APP_URL`, `AUTH_SECRET`, `CRON_SECRET`, `DOCUMENT_SIGNING_SECRET`, `SETTINGS_ENCRYPTION_KEY`, and the alert variables if you use them.
5. **Deploy.** `vercel.json` already schedules the four jobs, and Vercel sends `CRON_SECRET` automatically. The 15-minute job needs the **Pro** plan; on Hobby, see section 11.
6. **Add your domain** in Vercel. Set `APP_URL` to it and redeploy.
7. **Edge protection.** In Vercel Firewall, add a rate-limit rule for `/w/*`, `/api/pdf/*` and `/api/auth/*`.
8. Continue with [section 10](#10-after-installing-first-owner-branches-staff-messaging).

**For each later release:** run `prisma migrate deploy` and `db:grant-app` with the owner URL (from your computer or a CI step), then let Vercel deploy. Migrations always add to the database and never remove, so run them before the new code goes live.

---

## 8. Option B: a VPS (Ubuntu, Nginx, systemd)

These steps are for Ubuntu 24.04 LTS with 2 GB RAM or more. Run them as a sudo user.

### 8.1 System packages

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx git curl ufw
# Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt -y install nodejs
sudo corepack enable && sudo corepack prepare pnpm@12.21.0 --activate
# PostgreSQL (or skip and use a managed database)
sudo apt -y install postgresql
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

### 8.2 Database

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE gadgethub_owner LOGIN PASSWORD 'CHANGE-ME-owner-long-random';
CREATE DATABASE gadgethub OWNER gadgethub_owner;
SQL
```

### 8.3 App user, code, configuration

```bash
sudo adduser --system --group --home /srv/leeplugshub leeplugs
sudo -u leeplugs git clone <your-repository-url> /srv/leeplugshub/app
cd /srv/leeplugshub/app
sudo -u leeplugs cp .env.example .env && sudo chmod 600 .env && sudo -u leeplugs nano .env
```

In `.env`, set:
- `MIGRATION_DATABASE_URL=postgresql://gadgethub_owner:…@localhost:5432/gadgethub`
- `APP_URL=https://your-domain`
- the secrets (section 5)
- `APP_DB_PASSWORD`

Leave `DATABASE_URL` for step 8.4.

### 8.4 Build and prepare the database

```bash
sudo -u leeplugs pnpm install --frozen-lockfile
sudo -u leeplugs pnpm prisma migrate deploy
sudo -u leeplugs pnpm db:grant-app                    # creates gadgethub_app
# now set DATABASE_URL=postgresql://gadgethub_app:<APP_DB_PASSWORD>@localhost:5432/gadgethub in .env
sudo -u leeplugs pnpm build
sudo -u leeplugs pnpm db:verify
```

### 8.5 Run it as a service

`/etc/systemd/system/leeplugshub.service`:

```ini
[Unit]
Description=LeePlugsHub
After=network.target postgresql.service

[Service]
User=leeplugs
WorkingDirectory=/srv/leeplugshub/app
Environment=NODE_ENV=production PORT=3000 LISTEN_HOST=127.0.0.1 TZ=UTC
ExecStart=/usr/bin/node server.cjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now leeplugshub
curl -s http://127.0.0.1:3000/api/health          # {"status":"ok"|"degraded","database":"ok",…}
```

`server.cjs` loads `.env` from the app folder and listens on `LISTEN_HOST:PORT`, here only on localhost, behind Nginx. (It deliberately ignores `HOSTNAME`, which many systems set to the machine name.)

### 8.6 Nginx and HTTPS

`/etc/nginx/sites-available/leeplugshub`:

```nginx
server {
    server_name your-domain;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/leeplugshub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt -y install certbot python3-certbot-nginx && sudo certbot --nginx -d your-domain
```

With Nginx alone in front, keep `TRUSTED_PROXY_COUNT=1`. If Cloudflare is in front as well, set `CLIENT_IP_HEADER=cf-connecting-ip`.

### 8.7 Scheduled jobs and backups

Use the cron lines in [section 11.3](#113-cpanel-or-any-cron-curl-lines) in the `leeplugs` user's crontab (`sudo crontab -u leeplugs -e`). Add a daily backup as well:

```cron
30 1 * * * cd /srv/leeplugshub/app && ./scripts/backup.sh /srv/leeplugshub/backups >> /srv/leeplugshub/backup.log 2>&1
```

Then copy `/srv/leeplugshub/backups` off the server, for example with `rclone` to cloud storage.

### 8.8 Updating

```bash
cd /srv/leeplugshub/app
sudo -u leeplugs git pull
sudo -u leeplugs pnpm install --frozen-lockfile
sudo -u leeplugs pnpm prisma migrate deploy && sudo -u leeplugs pnpm db:grant-app
sudo -u leeplugs pnpm build
sudo systemctl restart leeplugshub
```

---

## 9. Option C: shared hosting (cPanel with Node.js)

> **Read 9.1 first.** Most cheap shared hosting can't run this app; it is built for PHP and MySQL.
> These steps are for plans that have cPanel's **Setup Node.js App** (CloudLinux Node.js Selector with Phusion Passenger).
> `server.cjs` has been tested here against a production build. These steps have **not** been tested on a specific host's cPanel, so check each result as you go.

### 9.1 Requirements checklist (all must be "yes")

- [ ] cPanel shows **Setup Node.js App**, offering Node **24** (or 22.12+ / 20.19+).
- [ ] **SSH access** (Terminal in cPanel counts).
- [ ] **PostgreSQL** (cPanel → *PostgreSQL Databases*), **or** you'll use an external managed PostgreSQL database (Neon or Supabase) reachable from the host.
- [ ] **Cron Jobs** can run every 15 minutes.
- [ ] **AutoSSL / Let's Encrypt** for your domain or subdomain.
- [ ] Either enough process memory to build (2 GB+), or you build elsewhere (9.6).

### 9.2 Database

**Option 1: cPanel PostgreSQL.** Go to *PostgreSQL Databases*:
- Create a database, for example `cpuser_leeplugs`.
- Create a user, for example `cpuser_owner`, and add it to the database with **ALL PRIVILEGES**.

The connection string is `postgresql://cpuser_owner:PASSWORD@localhost:5432/cpuser_leeplugs`.

**Option 2: external database** (more reliable, with backups included). Create a Neon or Supabase database and use its connection string with `?sslmode=require`.

**The restricted login (section 13):** cPanel doesn't let you create roles from SQL.
- Create a **second** user in cPanel, for example `cpuser_app`, and add it to the database with ALL PRIVILEGES.
- Then run `pnpm db:grant-app` with `APP_DB_ROLE=cpuser_app` (step 9.4). It tries to set that role's password, which a non-superuser can't do on some hosts.
- **If it fails:** skip it and use the owner login for `DATABASE_URL`. The app still works, and the triggers and CHECK constraints still protect the data. But compromised app code could then switch off those safeguards, because the owner login can drop them.

### 9.3 Create the Node.js application

cPanel → **Setup Node.js App** → *Create Application*:

| Field | Value |
|---|---|
| Node.js version | 24 (or the highest offered of 22.12+ / 20.19+) |
| Application mode | Production |
| Application root | `leeplugshub` (a folder **outside** `public_html`) |
| Application URL | your domain or a subdomain, e.g. `shop.leeplugshub.com` |
| Application startup file | `server.cjs` |

Click **Create**. Copy the command shown at the top, which looks like `source /home/cpuser/nodevenv/leeplugshub/24/bin/activate && cd /home/cpuser/leeplugshub`. You'll run it in the terminal to use the app's Node version.

### 9.4 Upload the code and install

In cPanel's Terminal or over SSH:

```bash
source /home/cpuser/nodevenv/leeplugshub/24/bin/activate && cd /home/cpuser/leeplugshub
git clone <your-repository-url> .            # or upload and extract a zip of the repository here
cp .env.example .env && chmod 600 .env
nano .env                                     # see below
npx --yes pnpm@12.21.0 install --frozen-lockfile
npx --yes pnpm@12.21.0 prisma migrate deploy
APP_DB_ROLE=cpuser_app npx --yes pnpm@12.21.0 db:grant-app   # optional, see 9.2
npx --yes pnpm@12.21.0 build                  # if this is killed for memory, use 9.6
npx --yes pnpm@12.21.0 db:verify
```

What to put in `.env`:
- `DATABASE_URL`: the app login, or the owner login if you skipped `db:grant-app`
- `MIGRATION_DATABASE_URL`: the owner login
- `APP_URL=https://shop.leeplugshub.com`
- `AUTH_SECRET`, `CRON_SECRET`, `DOCUMENT_SIGNING_SECRET`, `SETTINGS_ENCRYPTION_KEY`: section 5
- `TRUSTED_PROXY_COUNT=1`, because LiteSpeed or Apache is in front. Behind Cloudflare, set `CLIENT_IP_HEADER=cf-connecting-ip` instead.

> **About `node_modules` on CloudLinux.** The Node.js Selector may keep `node_modules` as a link into
> `~/nodevenv/…`. If `pnpm install` complains about it, remove the link (`rm node_modules`) and install again.
> Don't press cPanel's **Run NPM Install** button: it uses npm, ignores `pnpm-lock.yaml`, and can install different versions.

### 9.5 Start and check

- cPanel → Setup Node.js App → **Restart**.
- Open `https://your-domain/api/health`. You should see `"database":"ok"`.
- Open `https://your-domain/login`. You should see the sign-in page.

If you get "Incomplete response" or a 503, check `~/leeplugshub/stderr.log`. Passenger writes startup errors there.

### 9.6 If the build runs out of memory: build elsewhere and upload

Build on a Linux x64 machine with the same Node major version. A GitHub Actions run or a small VPS both work.

```bash
pnpm install --frozen-lockfile && pnpm build
tar czf release.tgz .next node_modules package.json pnpm-lock.yaml server.cjs next.config.ts prisma prisma.config.ts scripts src tsconfig.json
```

Upload `release.tgz` to the application root, extract it with `tar xzf release.tgz`, keep your `.env`, then run `prisma migrate deploy` and restart the app.

Build on Linux, not macOS or Windows, so any platform-specific packages match the server.

### 9.7 Scheduled jobs

cPanel → **Cron Jobs**: add the four lines from [section 11.3](#113-cpanel-or-any-cron-curl-lines). Then add the daily backup:

```cron
30 1 * * * cd $HOME/leeplugshub && ./scripts/backup.sh $HOME/backups >/dev/null 2>&1
```

`backup.sh` needs `pg_dump` on the server. If the host doesn't provide it, rely on your external database provider's backups, or on cPanel's backup feature, which includes PostgreSQL.

### 9.8 Updating

```bash
source /home/cpuser/nodevenv/leeplugshub/24/bin/activate && cd /home/cpuser/leeplugshub
git pull && npx --yes pnpm@12.21.0 install --frozen-lockfile
npx --yes pnpm@12.21.0 prisma migrate deploy
npx --yes pnpm@12.21.0 build
touch tmp/restart.txt        # or press Restart in Setup Node.js App
```

### 9.9 Known shared-hosting limits

- **Process limits:** shared hosting may restart or stop the app when it's idle or too busy. The first visit after a pause can be slow.
- **Messages and jobs:** sending relies on the 15-minute job and on webhooks reaching your domain. Check the Notifications page after go-live.
- **Database host:** don't use a database hosted far from the app server. Each page makes several queries, so distance adds up quickly.

---

## 10. After installing: first owner, branches, staff, messaging

1. **First owner** (any host):
   ```bash
   pnpm user:create-owner "Full Name" you@leeplugshub.com
   ```
   It prints a **one-time password** once. Sign in at `/login` with it, choose your own password, then set up **two-factor** with an authenticator app (required for owners in production). Save the 10 recovery codes somewhere safe and not on your phone.
2. **Settings → Business:** store details, VAT, bank details (printed in payment reminders), instalment rules.
3. **Settings → Branches:** add each store and warehouse. The branch code becomes the invoice prefix, e.g. `INV-IKJ-000001`.
4. **Settings → Users and roles:** add managers and cashiers. The password you set is temporary; they must choose their own at first sign-in.
5. **Products and stock:** add products in Inventory → Products, then receive stock in Intake.
6. **Messaging:**
   - Register the WhatsApp templates with Meta (`README.md` → *WhatsApp templates*).
   - Set up the delivery webhooks (`README.md` → *Delivery webhooks*).
   - Enter keys in **Settings → Messaging providers** and use **Send test message**.
   - Then do a real check: make a small sale to your own number, record a repayment, and watch the Notifications page show *Delivered*.
7. **Alerts:** set `ALERT_WEBHOOK_URL` and/or `ALERT_PHONE`, then **Settings → System → Send test alert**.
8. **Privacy:** have a lawyer review `/privacy`. The text uses the store's contact details from `src/config/store.ts`.

---

## 11. Scheduled jobs

| Job | Route | Lagos time | UTC | What it does |
|---|---|---|---|---|
| Stock alerts and integrity check | `/api/cron/stock-alerts` | 07:00 daily | 06:00 | Low-stock and aging alerts, then the ledger and stock integrity checks (alerts on any problem) |
| Instalment reminders | `/api/cron/installment-reminders` | 08:00 daily | 07:00 | "Due in 3 days" and "due today" messages |
| Overdue escalation | `/api/cron/overdue-escalation` | 09:00 daily | 08:00 | Marks overdue instalments, sends 1/7/14-day messages |
| Retries and housekeeping | `/api/cron/retry-notifications` | every 15 min | every 15 min | Retries failed messages, checks job health, prunes old logs and rate-limit counters, removes old message texts |

Lagos is UTC+1 all year (no daylight saving). Each job can safely run twice: messages have unique keys, so nothing is sent twice. A missed day is caught up on the next run.

### 11.1 Vercel

These are already in `vercel.json`. The Pro plan is needed for the 15-minute job. **On Hobby:** have an external scheduler (an uptime monitor with custom headers, or cron-job.org) call the retry route every 15 minutes with the bearer token.

### 11.2 Local

`pnpm cron:local` while `pnpm dev` is running.

### 11.3 cPanel or any cron (curl lines)

If the server's clock is UTC (check with `date`):

```cron
0 6 * * *     curl -fsS -m 300 -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain/api/cron/stock-alerts >/dev/null
0 7 * * *     curl -fsS -m 300 -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain/api/cron/installment-reminders >/dev/null
0 8 * * *     curl -fsS -m 300 -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain/api/cron/overdue-escalation >/dev/null
*/15 * * * *  curl -fsS -m 300 -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain/api/cron/retry-notifications >/dev/null
```

If the server's clock is set to another timezone, shift the hours so they land at 07:00, 08:00 and 09:00 in Lagos. Calling a job without the header returns `401`.

### 11.4 Is it working?

**Settings → System** lists each job's last successful run. `/api/health` reports `"degraded"` while any job is late or failing, and the alert channels are notified.

---

## 12. Running it: backups, monitoring, updates

### Backups

- **First line:** your database provider's automatic backups with point-in-time recovery.
- **Second line, a copy you control:**
  ```bash
  ./scripts/backup.sh /path/to/backups      # pg_dump custom format + .sha256; keep 30 daily + 12 monthly off-site
  ```
  With a local Docker database: `PG_RUN="docker compose exec -T db" ./scripts/backup.sh backups`.
- **Monthly restore drill:**
  ```bash
  ./scripts/restore-drill.sh /path/to/backups/gadgethub-<date>.dump
  ```
  It checks the backup's checksum, restores into a scratch `<db>_restore_drill` database, runs every integrity check, and drops the scratch database. Note how long the restore took: that's your recovery time.

### Integrity

`pnpm db:verify` checks that:
- invoice and purchase-order totals match their payment rows
- schedules add up to the amount financed
- stock isn't negative and matches transfers and sales
- invoice numbers have no gaps
- the triggers and CHECK constraints exist

It runs automatically every morning, and in CI after migrations.

### Monitoring

- **`/api/health`:** 200 with `"ok"` or `"degraded"`, or 503 if the database is down. Point an uptime monitor at it; a full outage is the one thing the app can't report itself.
- **Settings → System:** health, job status, recent server errors, alert channels.
- **Logs:** one JSON line per event, in your host's log viewer, in `journalctl -u leeplugshub`, or in `stderr.log` on cPanel.

### Updates

1. Back up (or confirm your provider's backups).
2. Run `prisma migrate deploy`, then `db:grant-app`. New tables need the restricted login's permissions.
3. Build and deploy, then restart.
4. Run `pnpm db:verify`.

Migrations only ever add to the database. If a release goes wrong, deploy the previous code; it keeps working with the newer database.

---

## 13. Security model

| Protection | How |
|---|---|
| Who can do what | One `can(ctx, action, resource)` function, checked inside every service. Screens use it only to hide buttons. |
| Branch limits | Managers and cashiers only ever see their own branch's data, enforced in the services. |
| Cost data | Cost prices, margins, profit and supplier balances are removed on the server for anyone but the owner. |
| Sign-in | bcrypt passwords. Lockout per account and IP address (5 attempts), per account (20) and per IP (30), using a trusted client IP. Two-factor (TOTP) with single-use codes and recovery codes. |
| Sessions | Sessions last 12 hours. Every request checks a session version, so a password reset, role change, two-factor change or "sign out other devices" ends other sessions at once. |
| Temporary passwords | Passwords an owner sets must be changed at first sign-in. Until then, only Account security is reachable. |
| Database | CHECK constraints keep totals reconciled. Triggers make the audit log and stock adjustments append-only and freeze submitted cash-ups. The **restricted login** (`pnpm db:grant-app`) can't change the schema, switch off triggers or delete financial rows, and a test fails if code starts deleting from a table it isn't allowed to. |
| Secrets | Provider keys are encrypted (AES-256-GCM) and shown only as their last 4 characters. Customer document links are signed and expire: 30 days in messages, 180 days on printed receipts. |
| Browser | Content Security Policy, HSTS (on https), nosniff, frame blocking, Referrer and Permissions policies. |
| Public pages | Per-IP rate limits on the warranty check and signed document links. Add an edge firewall rule in front as well. |
| Privacy (NDPA 2023) | Public notice at `/privacy`, recorded per customer. Owners can export or erase a customer's data. Message texts are removed after 365 days. Financial records are kept, as tax law requires. |

**Who can do what:**

| Capability | Owner | Branch manager | Cashier |
|---|---|---|---|
| Sell, add customers, record repayments, send reminders | ✓ | ✓ | ✓ |
| See other branches' stock quantities | ✓ | ✓ | ✓ |
| Cash up own drawer | ✓ | ✓ | ✓ |
| Approve instalment plans, receive stock, transfers, returns | ✓ | own branch | ✗ |
| Sign off cash-ups | ✓ | own branch (not their own) | ✗ |
| Void invoices | ✓ | own branch, same day | ✗ |
| Cost, profit, supplier payables, payouts | ✓ | ✗ | ✗ |
| Prices, stock adjustments and counts, waive debt, reverse payments | ✓ | ✗ | ✗ |
| Users, branches, tax, templates, API keys, system, customer export and erasure | ✓ | ✗ | ✗ |
| Audit log | ✓ | own branch | ✗ |

---

## 14. Using the app, by role

**Cashier**

| Task | How |
|---|---|
| Sell | **POS**: scan or type in the search box (**F2** jumps to it), pick the customer (**F4**), add payments, **Complete sale** (**F9**). The receipt and warranty go out by message, and **Print receipt** gives the thermal copy. |
| New customer | Name and phone. Tell them how their details are used (the *privacy notice* link), then tick the box. |
| Take a repayment | **Receivables** → *Record payment*. It goes to the oldest unpaid instalment first. |
| End of shift | **Cash-up** → enter the opening float and count the drawer → *Submit*. You see the expected figures only after submitting. |

**Branch manager** (everything a cashier does, plus):

| Task | How |
|---|---|
| Stock | Receive stock (**Intake**), create, ship and receive **Transfers**, process returns from an invoice. |
| Instalments | Approve plans above the threshold at the POS. |
| Cash-ups | **Cash-up** shows who hasn't cashed up yet. Sign off other people's cash-ups, with a note if the drawer didn't balance. |
| Voids | Void a sale made in error on the day of the sale (invoice → *Void*). |

**Owner** (everything, plus):

| Task | How |
|---|---|
| Dashboard | All branches, profit and payables. |
| Stock | **Inventory → Adjustments** and **Start stock count**. |
| Ledger | Reverse payments and waive debt. |
| Settings | Users, branches, VAT, templates, providers, **System**. |
| Customers | **Export their data** or **Erase personal details** from the customer's profile. |

**Everyone:** avatar menu → **Account security** to change your password, turn on two-factor, or sign out your other devices.

---

## 15. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Pages fail with `Unknown field … for select statement` after an update | The running server has an old database client. **Restart it** (`pnpm dev`, the systemd service, or Restart in cPanel). |
| `The migration … was modified after it was applied` | A migration file changed after it ran. Never edit an applied migration; restore the file from git and add a new migration instead. |
| `Cannot reach Postgres for tests at localhost` | Start the database: `docker compose up -d db`. |
| Sign-in shows "Too many attempts" | The lockout lasts 15 minutes. An owner's password reset for that user clears it at once. |
| Lost two-factor phone (staff) | Owner: **Settings → Users** → *Reset two-factor* (shield icon). |
| Lost two-factor phone (the only owner, no recovery codes) | On the server: `pnpm user:reset-2fa owner@email`. |
| Customers report "This link has expired" | Links in messages last 30 days. Open the invoice and **resend** the receipt to get a fresh link. |
| Log line `rate limit skipped: client IP unknown` | Set `TRUSTED_PROXY_COUNT` or `CLIENT_IP_HEADER` for your proxy setup (section 5). |
| `/api/health` says `"degraded"` | A scheduled job is late or failing. **Settings → System** shows which one; check the cron set-up (section 11). |
| Messages stuck at *Queued* | The 15-minute job isn't running, or the provider keys are wrong. Use **Settings → Messaging providers → Send test message**. |
| `pnpm db:verify` fails | It lists the failing rows. Restore from backup if data was damaged, or contact the developer with the output. Don't edit ledger rows by hand. |
| `db:grant-app` says `permission denied to create role` | The database login isn't allowed to create roles. Create the role in the provider or cPanel UI and re-run with `APP_DB_ROLE` set (sections 7 and 9.2). |
| cPanel shows "Incomplete response received" | The app failed to start. Read `stderr.log` in the application root; usually it's a missing `.env` value or the build wasn't run. |
| `pnpm build` killed on shared hosting | Not enough memory. Build elsewhere and upload (section 9.6). |
| `Refusing to seed` | Intended: the seed never runs on production or real data. Create the first owner with `pnpm user:create-owner`. |

---

## 16. Command reference

| Command | What it does |
|---|---|
| `pnpm dev` | Development server on :3000 |
| `pnpm build` / `pnpm start` | Production build / start (`node server.cjs` is equivalent) |
| `pnpm lint`, `pnpm typecheck` | Code quality |
| `pnpm test`, `pnpm test:e2e` | Unit and integration tests; browser smoke test |
| `pnpm prisma migrate dev` | Development: apply and create migrations |
| `pnpm prisma migrate deploy` | Production: apply migrations (uses `MIGRATION_DATABASE_URL`) |
| `pnpm db:seed` | Demo data (refuses production and real data) |
| `pnpm db:studio` | Browse the database (development) |
| `pnpm db:grant-app` | Create or refresh the restricted app login |
| `pnpm db:verify [url]` | Ledger, stock, numbering and safeguard checks |
| `pnpm cron:local [--run all\|<job>]` | Run the scheduled jobs against the dev server |
| `pnpm user:create-owner "Name" email` | First owner on a new store (one-time password) |
| `pnpm user:reset-2fa email` | Last-resort two-factor reset from the server |
| `scripts/backup.sh [dir]` | Off-site backup (`pg_dump` + checksum) |
| `scripts/restore-drill.sh file.dump` | Restore into a scratch database and verify |

---

## 17. Limits and things not built

**Out of scope for version 1:**
- online payment gateways
- an e-commerce storefront
- payroll
- full double-entry accounting
- native mobile apps
- offline mode

**Known limits:**
- **POS approvals:** manager approval at the POS checks the manager's password, not their two-factor code.
- **Cash-up scope:** cash-up covers customer payments only. Cash paid to suppliers from the till isn't modelled, so it shows as a shortage.
- **Messaging:** WhatsApp messages the store starts need templates pre-approved by Meta. Inbound customer replies (such as "STOP") aren't processed; staff change a customer's message preferences on their profile.
- **Placeholders to replace:**
  - Central Warehouse's real details
  - the store's bank account details for payment instructions
  - the return policy wording (`src/config/store.ts`)
  - the privacy notice's legal review

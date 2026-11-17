# Gadget Hub

Multi-branch inventory, POS invoicing, credit ledger and automated customer messaging for a gadget and
consumer-electronics retailer. Serialized devices are tracked per IMEI/serial, accessories by quantity per
branch; customers can buy on instalments and suppliers are paid on credit; receipts, warranty cards and
reminders go out over WhatsApp with SMS fallback.

Project rules live in [`CLAUDE.md`](./CLAUDE.md); visual rules in [`DESIGN.md`](./DESIGN.md) and the
mockups in `docs/design/mockups/`.

## What it does

| Area | Screens |
|---|---|
| Selling | POS with IMEI scan, split payments, trade-ins, instalment calculator and manager approval · invoices · A4 PDF invoice, 80mm thermal receipt, warranty certificate and public warranty check (`/w/<id>`) · returns, refunds and swaps |
| Stock | Serialized units and accessories per branch · stock intake on supplier credit with barcode labels · inter-branch transfers with waybill · low-stock and 60-day aging alerts · trade-in release |
| Money | Receivables ledger (record payment, reverse, waive, reminders switch) · payables and supplier payouts · customer and supplier profiles · executive dashboard · aging reports with CSV export |
| Messaging | WhatsApp (Meta Cloud API or Twilio) with SMS fallback (Termii or Twilio) · delivery webhooks · scheduled reminders and escalations · notification centre with resend |
| Admin | Settings (business rules, branches, users, message templates, provider keys) · append-only audit log viewer |

Roles: **Owner** (all branches, cost and profit, settings), **Branch manager** (own branch, approvals,
intake, transfers, returns) and **Cashier** (own branch selling and collecting). The full matrix is in
`CLAUDE.md` §8 and is enforced on the server by `can()` in `src/server/auth/permissions.ts`.

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS 4 + shadcn/ui ·
PostgreSQL 18 + Prisma 7 · Auth.js (next-auth v4, credentials + JWT) · Zod · `@react-pdf/renderer` ·
Recharts · Vitest + Playwright · pnpm.

## Local setup

Requirements: **Node 24+**, **pnpm** (`corepack enable pnpm`), **Docker**.

```bash
pnpm install                       # also runs `prisma generate`
cp .env.example .env               # then fill the secrets below
docker compose up -d db            # Postgres 18 on localhost:5432
pnpm prisma migrate dev            # schema + CHECK constraints + audit-log trigger
pnpm db:seed                       # idempotent sample data, prints the dev logins
pnpm dev                           # http://localhost:3000
```

Generate each secret with `openssl rand -base64 32` and put it in `.env`: `AUTH_SECRET`, `CRON_SECRET`,
`DOCUMENT_SIGNING_SECRET` (and optionally `SETTINGS_ENCRYPTION_KEY`).

### Dev logins

All seeded users share one password: `SEED_PASSWORD` from `.env`, or **`GadgetHub!2026`** when unset.

| Email | Role | Branch |
|---|---|---|
| owner@gadgethub.test | Owner | All |
| manager.main@gadgethub.test / cashier.main@gadgethub.test | Manager / Cashier | Main Branch |
| manager.ikj@gadgethub.test / cashier.ikj@gadgethub.test | Manager / Cashier | Ikeja |
| manager.lek@gadgethub.test / cashier.lek@gadgethub.test | Manager / Cashier | Lekki |

The seed covers 4 branches, ~10 products, 25+ serialized units (some 60+ days old), accessories below
reorder level, two suppliers with paid, part-paid and overdue purchase orders, five customers with a paid
invoice, an active instalment plan and an overdue one, transfers in transit and received, and default
message templates and settings.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `AUTH_SECRET` | yes | Signs session JWTs |
| `APP_URL` | yes | Public base URL (links in messages, QR codes, webhooks, auth callbacks) |
| `CRON_SECRET` | yes | Bearer token every `/api/cron/*` request must carry |
| `DOCUMENT_SIGNING_SECRET` | yes | Signs the expiring PDF links sent to customers |
| `SETTINGS_ENCRYPTION_KEY` | no | Encrypts provider keys saved in Settings (32 bytes, base64); derived from `AUTH_SECRET` when empty. Changing it makes saved keys unreadable |
| `SEED_PASSWORD` | no | Password for seeded users (default `GadgetHub!2026`) |
| `TEST_DATABASE_URL` / `E2E_DATABASE_URL` | no | Override the `_test` / `_e2e` databases used by the test suites |
| `WHATSAPP_PROVIDER`, `SMS_PROVIDER` | no | `whatsapp-cloud` \| `twilio` \| `console` and `termii` \| `twilio` \| `console` (Settings overrides) |
| `WHATSAPP_CLOUD_*`, `TWILIO_*`, `TERMII_*` | per provider | Provider credentials; see `.env.example` (Settings → Messaging can store them instead) |

`.env.example` lists every variable with a comment. Never commit `.env`.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Dev server on :3000 |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm lint` · `pnpm typecheck` | ESLint · `next typegen` + `tsc --noEmit` |
| `pnpm test` | Vitest: ledger maths, services and invariants against a `_test` database (created and migrated automatically) |
| `pnpm test:e2e` | Playwright checkout smoke test (below) |
| `pnpm db:seed` · `pnpm db:studio` | Seed sample data · Prisma Studio |
| `pnpm cron:local [--run all\|<job>]` | Run the scheduled jobs against the dev server |

A change is done when `pnpm lint && pnpm typecheck && pnpm test` pass.

## Testing

- **Unit and integration (Vitest):** schedule generation, payment allocation and balance recalculation,
  concurrent IMEI sales, transfer state transitions, notification dedupe and fallback, role-based field
  stripping, returns, cron jobs, settings and more. Integration tests run against `<db>_test`.
- **Smoke test (Playwright):** `pnpm test:e2e` drops and recreates `<db>_e2e`, migrates and seeds it,
  builds the app and serves it on port **3100** (so it can run beside `pnpm dev`), then a cashier sells a
  device and an accessory: the receipt goes out, the invoice and its PDF exist, the device leaves the
  shelf, and owner-only screens stay closed. First time on a machine: `pnpm exec playwright install chromium`.

## Data rules worth knowing

- Money is `Decimal(14,2)` end to end (decimal.js on the server and in previews), never a float.
- Every stock or money change runs in one transaction with its audit row; `audit_logs` rejects UPDATE and
  DELETE at the database level. Invoices are voided or returned, payments reversed, never deleted.
- Balances are always rebuilt from ledger rows (payments, waivers, returns) inside the transaction that
  changes them; Postgres CHECK constraints make the cached totals reconcile.
- Document numbers (`INV-IKJ-000123`, `TRF-…`, `PO-…`, `RTN-…`) are gapless per branch.
- Branch scope and cost visibility are enforced in services; a cashier's browser never receives cost data.
- Dates are stored in UTC; due dates are calendar dates in Africa/Lagos, where every job runs.

### Database notes

- Schema: `prisma/schema.prisma` (Prisma ORM 7, `prisma-client` generator → `src/generated/prisma`,
  PostgreSQL via `@prisma/adapter-pg`). Tables and columns are snake_case.
- Guarantees Prisma can't express live in migration SQL: CHECK constraints (non-negative stock, invoice
  totals and balances reconcile, signed payment ledger, one branch per staff member, …) and the
  append-only trigger on `audit_logs`.

## Deploying

1. Provision Postgres (any managed provider) and set `DATABASE_URL`.
2. Set `APP_URL` to the public https URL and the secrets above; run `pnpm prisma migrate deploy`.
3. Seed only for a demo (`pnpm db:seed`); for a real store create branches and users in **Settings**.
4. Vercel: import the repo; `vercel.json` schedules the cron jobs (see **Scheduled jobs**) and Vercel sends
   `CRON_SECRET` automatically. Elsewhere, call the four `/api/cron/*` routes on the same schedule with
   `Authorization: Bearer $CRON_SECRET`.
5. Register the WhatsApp templates and delivery webhooks below, then pick providers and enter keys in
   **Settings → Messaging providers** and send a test message.

## Customer messages

Receipts, warranty cards, reminders and payment confirmations go out over WhatsApp, falling back to SMS
(with links in place of attachments) when WhatsApp fails or the customer has opted out of it. Every
message is a row in `notification_logs` (see **Notifications** in the app). Providers are chosen in
**Settings → Messaging providers**, falling back to `WHATSAPP_PROVIDER` / `SMS_PROVIDER`; their keys can be
saved there (encrypted, shown only as the last four characters) or set as environment variables. The
default `console` providers print messages to the dev server log and report them as sent.

### WhatsApp templates to register with Meta

Business-initiated WhatsApp messages must use templates approved in WhatsApp Manager. Register one per
key below (category **Utility**, language **English (en)**) with **named** parameters spelled exactly as
in our template body, e.g. `{{customer_name}}`. Then put the approved name in the template's
"WhatsApp template name" (seeded as `gh_<key>`). Receipt and warranty templates need a **Document** header;
the PDF is attached from a signed link.

| Template key | Suggested name | Header | Body parameters |
|---|---|---|---|
| `receipt` | `gh_receipt` | Document | customer_name, branch_name, invoice_number, invoice_total |
| `warranty_card` | `gh_warranty_card` | Document | customer_name, device_name, serial_masked, warranty_expiry, warranty_link |
| `installment_due_3d` | `gh_installment_due_3d` | none | customer_name, amount_due, invoice_number, due_date, balance_remaining, payment_instructions |
| `installment_due_today` | `gh_installment_due_today` | none | customer_name, amount_due, invoice_number, balance_remaining, payment_instructions |
| `installment_overdue_1d` | `gh_installment_overdue_1d` | none | customer_name, amount_due, invoice_number, due_date, payment_instructions |
| `installment_overdue_7d` | `gh_installment_overdue_7d` | none | customer_name, amount_due, invoice_number, due_date, balance_remaining, branch_name, payment_instructions |
| `installment_overdue_14d` | `gh_installment_overdue_14d` | none | customer_name, amount_due, invoice_number, branch_name, payment_instructions |
| `payment_confirmation` | `gh_payment_confirmation` | none | customer_name, amount_paid, invoice_number, branch_name, balance_remaining |
| `manual_reminder` | `gh_manual_reminder` | none | customer_name, branch_name, invoice_number, balance_remaining, payment_instructions |

The parameter lists match the seeded bodies. If you edit a body, re-register the template so its
parameters still match. With **Twilio**, set the template name to the Content SID (`HX…`). Its
variables are positional (`{{1}}`, `{{2}}`, …) in the order they appear in our body, and for
receipts and warranty cards one extra, final variable carries the document URL.

### Delivery webhooks

| Provider | URL | Secured by |
|---|---|---|
| WhatsApp Cloud | `{APP_URL}/api/webhooks/whatsapp` (subscribe to `messages`) | `WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN` handshake + `WHATSAPP_CLOUD_APP_SECRET` signature |
| Twilio | sent automatically as each message's StatusCallback | `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN` |
| Termii | `{APP_URL}/api/webhooks/termii?token={TERMII_WEBHOOK_TOKEN}` | URL token |

## Scheduled jobs

| Job | Route | Lagos time | Does |
|---|---|---|---|
| Stock alerts | `/api/cron/stock-alerts` | daily 07:00 | Opens, refreshes and resolves low-stock and 60-day aging alerts |
| Instalment reminders | `/api/cron/installment-reminders` | daily 08:00 | "Due in 3 days" (caught up to the day before) and "due today" |
| Overdue escalation | `/api/cron/overdue-escalation` | daily 09:00 | Marks past-due instalments overdue, then sends the 1, 7 and 14-day messages |
| Retry messages | `/api/cron/retry-notifications` | every 15 min | Retries failed and stuck messages up to `notifications.maxAttempts` (max 1 day old) |

Every route rejects requests without `Authorization: Bearer $CRON_SECRET`. Each reminder is keyed
`{template}:{instalment}:{offset}`, so a job that runs twice, or catches up after a missed day, sends
it once. Plans with reminders switched off in Receivables are skipped.

- **Locally:** keep `pnpm dev` running, then `pnpm cron:local` to run the jobs on schedule, or
  `pnpm cron:local --run all` (or one job name, e.g. `--run stock-alerts`) to run them once now.
- **Vercel:** `vercel.json` registers the jobs in UTC (Lagos is UTC+1 all year). Set `CRON_SECRET` in
  the project's environment variables; Vercel sends it as the bearer token. The Hobby plan only
  allows daily cron jobs, so the 15-minute retry needs a Pro plan (or another scheduler calling it).

## Project layout

```
prisma/                 schema, migrations (incl. hand-written SQL), seed
src/app/(app)/          authenticated screens (dashboard, pos, invoices, inventory, transfers, ledger, …)
src/app/api/            PDFs, cron jobs, delivery webhooks, CSV export
src/app/w/[publicId]/   public warranty check
src/server/services/    all business logic: permissions, transactions, ledger maths, audit
src/server/notifications/  message engine, provider adapters, templates
src/server/jobs/        scheduled jobs
src/lib/                money, dates, phone, ledger and return maths, validators (shared with the UI)
tests/e2e/              Playwright smoke test
```

Pages and server actions stay thin: they validate input with the shared Zod schema and call a service.

## Out of scope for v1

Online payment gateways, an e-commerce storefront, payroll, a full double-entry general ledger, native
mobile apps and offline mode.

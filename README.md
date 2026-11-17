# Gadget Hub

Multi-branch inventory, POS invoicing, credit ledger and automated customer messaging for a gadget retailer.
Project rules live in [`CLAUDE.md`](./CLAUDE.md); visual rules in [`DESIGN.md`](./DESIGN.md).

> Status: build steps 1–9 of 13 done (database + seed; auth, RBAC, shell; inventory + stock intake; transfers + waybill; POS checkout with installments; invoice PDF, thermal receipt, warranty certificate + public check page; WhatsApp/SMS messaging with fallback, delivery webhooks and post-checkout receipts; receivables with payment confirmations, waivers and reversals; payables with supplier payouts; customer and supplier profiles; scheduled reminders, escalations, stock alerts and message retries). Full setup docs land in step 13.

## Local setup

Requirements: Node 24+, pnpm (via `corepack enable pnpm`), Docker.

```bash
pnpm install                 # also runs `prisma generate`
cp .env.example .env         # then fill AUTH_SECRET, CRON_SECRET, DOCUMENT_SIGNING_SECRET
docker compose up -d db      # Postgres 18 on localhost:5432
pnpm prisma migrate dev      # apply schema + DB constraints
pnpm db:seed                 # idempotent sample data
pnpm dev                     # http://localhost:3000
```

Checks: `pnpm lint && pnpm typecheck && pnpm test`.

## Dev logins

All seeded users share one password: `SEED_PASSWORD` from `.env`, or **`GadgetHub!2026`** when unset.
The seed prints the list; it is:

| Email | Role | Branch |
|---|---|---|
| owner@gadgethub.test | Owner | All |
| manager.main@gadgethub.test / cashier.main@gadgethub.test | Manager / Cashier | Main Branch |
| manager.ikj@gadgethub.test / cashier.ikj@gadgethub.test | Manager / Cashier | Ikeja |
| manager.lek@gadgethub.test / cashier.lek@gadgethub.test | Manager / Cashier | Lekki |

## Database notes

- Schema: `prisma/schema.prisma` (Prisma ORM 7, `prisma-client` generator → `src/generated/prisma`, PostgreSQL via `@prisma/adapter-pg`).
- Postgres tables/columns are snake_case; Prisma models are PascalCase/camelCase.
- Guarantees Prisma can't express live in migration SQL: 27 CHECK constraints (non-negative stock, invoice
  totals/balances reconcile, signed payment ledger rules, one-branch-per-staff …) and a trigger that makes
  `audit_logs` append-only (UPDATE / DELETE / TRUNCATE raise an error).

## Customer messages

Receipts, warranty cards, reminders and payment confirmations go out over WhatsApp, falling back to SMS
(with links in place of attachments) when WhatsApp fails or the customer has opted out of it. Every
message is a row in `notification_logs`; providers are picked with `WHATSAPP_PROVIDER` and `SMS_PROVIDER`.
The default `console` providers print messages to the dev server log and report them as sent.

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

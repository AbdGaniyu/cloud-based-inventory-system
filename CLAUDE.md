# CLAUDE.md

Project brief and working rules for Claude Code. Read this fully before writing code. Visual and UX rules live in `DESIGN.md` — read it before building any screen or printable document.

## 1. What we are building

A cloud-based **Multi-Branch Inventory, POS Invoicing, Credit Ledger and Automated Customer Messaging System** for a gadget and consumer electronics retailer with several physical locations.

What makes it different from generic retail software:

- High-value **serialized** devices (phones, laptops, consoles, smartwatches) tracked per unit by IMEI/serial, alongside bulk **non-serialized** accessories tracked by quantity per branch.
- Stock moves between branches through a controlled transfer workflow.
- Customers buy on **installments** (accounts receivable); suppliers are paid on **credit** (accounts payable).
- Receipts, warranty cards, reminders and payment confirmations go out automatically over **WhatsApp with SMS fallback**.

### Placeholders (change in `src/config/store.ts` and seed)

| Item | Placeholder |
|---|---|
| Store name | Gadget Hub |
| Currency | NGN (₦), 2 decimal places |
| Default VAT | 7.5%, configurable in Settings |
| Phone format | E.164, default country +234 |
| Timezone | Africa/Lagos (all due-date and cron logic uses this) |
| Branches | Main Branch (MAIN), Ikeja (IKJ), Lekki (LEK), Central Warehouse (WH) |

## 2. Stack (decided — do not substitute without asking)

- **Framework:** Next.js (App Router) + React + TypeScript, `strict: true`
- **UI:** Tailwind CSS + shadcn/ui, lucide-react icons, TanStack Table, Recharts
- **Forms/validation:** react-hook-form + Zod (one Zod schema shared by client form and server action)
- **Database:** PostgreSQL + Prisma
- **Auth:** Auth.js (NextAuth) with credentials provider, bcrypt hashes, JWT session carrying `userId`, `role`, `branchId`
- **PDF:** `@react-pdf/renderer` for A4 invoice, warranty card, transfer waybill; HTML print stylesheet for 80mm thermal receipt
- **Barcodes/QR:** `bwip-js` (Code 128 labels), `qrcode` (warranty verification QR)
- **Messaging:** provider adapters for WhatsApp Cloud API, Twilio (WhatsApp + SMS), Termii (SMS), plus a `console` adapter for local dev
- **Scheduling:** HTTP cron endpoints under `/api/cron/*` guarded by `CRON_SECRET` (Vercel Cron in production; `scripts/cron-local.ts` using node-cron locally)
- **Testing:** Vitest for services and ledger maths; Playwright smoke test for checkout
- **Package manager:** pnpm

Use the latest stable versions at install time. Do not pin versions from memory.

## 3. Commands

```bash
pnpm install
cp .env.example .env            # then fill values
docker compose up -d db         # local Postgres
pnpm prisma migrate dev         # apply schema
pnpm db:seed                    # sample data (see §11)
pnpm dev                        # http://localhost:3000
pnpm cron:local                 # run scheduled jobs locally
pnpm test                       # vitest
pnpm lint && pnpm typecheck     # must pass before any task is "done"
```

## 4. Folder structure

```
prisma/
  schema.prisma
  seed.ts
src/
  app/
    (auth)/login/
    (app)/                      # authenticated shell: sidebar + branch switcher
      dashboard/
      pos/                      # invoice builder
      invoices/[id]/
      customers/[id]/
      inventory/                # products, serialized units, per-branch stock
      inventory/intake/         # stock intake / purchase orders
      transfers/                # list, new, [id] (ship / receive)
      suppliers/[id]/
      ledger/receivables/
      ledger/payables/
      reports/aging/
      notifications/
      settings/                 # branches, users, tax, templates, API keys
      audit/
    api/
      cron/installment-reminders/route.ts
      cron/overdue-escalation/route.ts
      cron/stock-alerts/route.ts
      cron/retry-notifications/route.ts
      webhooks/whatsapp/route.ts     # delivery status callbacks
      webhooks/twilio/route.ts
      webhooks/termii/route.ts
      pdf/invoice/[id]/route.ts
      pdf/warranty/[id]/route.ts
      pdf/waybill/[id]/route.ts
    w/[warrantyId]/page.tsx     # public warranty verification page (no auth)
  components/
    ui/                         # shadcn primitives
    branch/BranchSwitcher.tsx
    pos/ dashboard/ ledger/ inventory/ transfers/ notifications/
  server/
    auth/                       # session, permissions, requireRole()
    branch-context.ts           # resolves active branch + scope for every request
    db.ts                       # prisma client
    services/                   # ALL business logic lives here
      inventory.service.ts
      intake.service.ts
      transfer.service.ts
      invoice.service.ts
      installment.service.ts
      payment.service.ts
      supplier.service.ts
      return.service.ts
      warranty.service.ts
      dashboard.service.ts
      audit.service.ts
    notifications/
      index.ts                  # NotificationService: queue, send, fallback, log
      templates.ts              # template keys + variable rendering
      providers/
        types.ts                # MessageProvider interface
        whatsapp-cloud.ts
        twilio.ts
        termii.ts
        console.ts
    pdf/
      InvoicePdf.tsx
      WarrantyCardPdf.tsx
      WaybillPdf.tsx
  lib/
    money.ts                    # Decimal helpers, formatting
    phone.ts                    # E.164 normalisation
    dates.ts                    # Africa/Lagos helpers, schedule generation
    invoice-number.ts
    validators/                 # Zod schemas
  config/store.ts
scripts/cron-local.ts
```

**Layering rule:** pages and server actions are thin. They validate input, call a service, and return. Services own transactions, ledger maths, audit logging and notification triggers. Components never import Prisma.

## 5. Database schema

Build `schema.prisma` first and get it reviewed before anything else. Required models:

`Branch`, `User`, `Product`, `BranchInventory`, `SerializedUnit`, `StockTransfer`, `StockTransferItem`, `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `SupplierPayment`, `Customer`, `Invoice`, `InvoiceItem`, `InstallmentPlan`, `InstallmentSchedule`, `CustomerPayment`, `TradeIn`, `Return`, `ReturnItem`, `WarrantyCard`, `MessageTemplate`, `NotificationLog`, `Setting`, `AuditLog`.

Key fields and enums:

- **Branch:** name, code (unique, used as invoice prefix), type (`STORE` | `WAREHOUSE`), address, phone, email, isActive, invoiceSequence.
- **User:** name, email, passwordHash, role (`OWNER` | `BRANCH_MANAGER` | `CASHIER`), branchId (null for OWNER), isActive.
- **Product:** name, brand, category, trackingType (`SERIALIZED` | `NON_SERIALIZED`), sku (unique), barcode, defaultCostPrice, defaultSellingPrice, warrantyMonths, reorderLevel.
- **BranchInventory:** productId + branchId (unique pair), quantity, reservedQuantity (in-transit), reorderLevel override.
- **SerializedUnit:** productId, imei (unique, nullable), serialNumber (unique, nullable), at least one of the two required; branchId, condition (`BRAND_NEW` | `OPEN_BOX` | `UK_USED` | `US_USED` | `REFURBISHED`), color, storage, ram, batteryHealth (0–100, nullable), costPrice, sellingPrice, status (`IN_STOCK` | `IN_TRANSIT` | `SOLD` | `RETURNED` | `DEFECTIVE` | `TRADED_IN`), purchaseOrderId, receivedAt.
- **StockTransfer:** number, fromBranchId, toBranchId, status (`DRAFT` | `IN_TRANSIT` | `RECEIVED` | `CANCELLED`), createdById, shippedById, receivedById, approvedById, timestamps for each step, notes.
- **StockTransferItem:** transferId, productId, serializedUnitId (nullable), quantity, receivedQuantity.
- **Supplier:** name, phone, email, address, balance is **derived**, never stored as an editable number.
- **PurchaseOrder:** number, supplierId, branchId, paymentTerms (`PAID_IN_FULL` | `PARTIAL_DEPOSIT` | `NET_7` | `NET_15` | `NET_30`), totalCost, amountPaid, dueDate, status (`UNPAID` | `PARTIALLY_PAID` | `PAID`), receivedById.
- **SupplierPayment:** purchaseOrderId, supplierId, amount, method, reference, paidById, paidAt.
- **Customer:** name, phoneE164 (unique), email, address, whatsappOptIn, smsOptIn, notes. Global, not branch-scoped.
- **Invoice:** number (unique, e.g. `INV-IKJ-000123`), branchId, customerId, cashierId, subtotal, discount, taxRate, taxAmount, tradeInCredit, total, amountPaid, balance, paymentType (`FULL` | `INSTALLMENT`), status (`UNPAID` | `PARTIALLY_PAID` | `PAID` | `VOID` | `RETURNED`), voidedById, voidReason.
- **InvoiceItem:** invoiceId, productId, serializedUnitId (nullable), description snapshot, quantity, unitPrice, unitCost snapshot, lineTotal, warrantyMonths snapshot.
- **InstallmentPlan:** invoiceId (unique), downPayment, financedAmount, numberOfInstallments, frequency (`WEEKLY` | `BI_WEEKLY` | `MONTHLY`), startDate, nextDueDate, guarantorName, guarantorPhone, idVerificationNotes, approvedById, status (`ACTIVE` | `COMPLETED` | `DEFAULTED` | `CANCELLED`).
- **InstallmentSchedule:** planId, sequence, dueDate, amountDue, amountPaid, status (`PENDING` | `PARTIAL` | `PAID` | `OVERDUE` | `WAIVED`).
- **CustomerPayment:** invoiceId, customerId, branchId (where it was collected, may differ from the selling branch), amount, method (`CASH` | `BANK_TRANSFER` | `POS_CARD`), reference, kind (`CHECKOUT` | `DOWN_PAYMENT` | `INSTALLMENT` | `REFUND`), receivedById, paidAt. Split payments are multiple rows.
- **WarrantyCard:** publicId (short unguessable ID, used in `/w/[publicId]`), invoiceItemId, serializedUnitId, customerId, branchId, startsAt, expiresAt, terms, status (`ACTIVE` | `EXPIRED` | `VOID`).
- **NotificationLog:** customerId, invoiceId (nullable), templateKey, channel (`WHATSAPP` | `SMS`), provider, to, body, mediaUrl, status (`QUEUED` | `SENT` | `DELIVERED` | `FAILED`), providerMessageId, error, attempts, dedupeKey (unique), triggeredById (null when automated), timestamps.
- **AuditLog:** userId, branchId, action, entityType, entityId, before (JSON), after (JSON), ip, createdAt. No `updatedAt`.

All money columns are `Decimal(14,2)`. Index every foreign key, plus `SerializedUnit(branchId,status)`, `InstallmentSchedule(dueDate,status)`, `NotificationLog(customerId,createdAt)`, `Invoice(branchId,createdAt)`.

## 6. Invariants — never break these

1. **Money is never a JS float.** Use Prisma `Decimal` and the helpers in `lib/money.ts`. Round only at presentation.
2. **Every stock or money mutation runs inside one `prisma.$transaction`** together with its `AuditLog` row. If the audit write fails, the mutation fails.
3. **A serialized unit is in exactly one place with exactly one status.** Selling requires `status = IN_STOCK` and `branchId = seller's branch`. Enforce with a conditional update (`updateMany where status = IN_STOCK`) and check the affected count, so two cashiers cannot sell the same IMEI.
4. **In-transit stock is locked from sale.** Shipping a transfer sets serialized units to `IN_TRANSIT` and moves non-serialized quantity out of the source branch's available quantity. Receiving puts it into the destination branch.
5. **Balances are derived from ledger rows.** `Invoice.amountPaid`/`balance` and `PurchaseOrder.amountPaid` are cached totals recomputed inside the same transaction that inserts a payment. Never accept a balance from the client.
6. **Financial records are never hard-deleted.** Invoices are voided with a reason. Payments are reversed with an offsetting row. There is no delete endpoint for invoices, payments, transfers or purchase orders.
7. **`AuditLog` is append-only.** No update or delete code paths. Add a database trigger in a migration that rejects `UPDATE`/`DELETE` on the table.
8. **Branch scope is enforced on the server.** Every service function takes a `ctx` (`userId`, `role`, `branchId`, `activeBranchId`) and filters by it. Never trust a `branchId` sent from the client for a non-owner.
9. **Cost data never reaches a cashier's browser.** Strip `costPrice`, margins, profit and supplier balances in the service layer based on role — hiding them in the UI is not enough.
10. **Invoice numbers are gapless per branch.** Generate from `Branch.invoiceSequence` with a row lock inside the checkout transaction.
11. **Notifications never block or roll back a sale.** Commit the sale, then enqueue. A provider failure produces a `FAILED` log row, not a failed checkout.
12. **Respect opt-in.** Do not send on a channel the customer has opted out of. Log the skip.
13. **Automated messages are idempotent.** `dedupeKey` is `{templateKey}:{scheduleId}:{offset}`, so a cron that runs twice sends once.
14. **Secrets stay server-side.** Provider API keys live in env vars or encrypted `Setting` rows, are never returned to the client in full, and are editable by OWNER only.

## 7. Functional requirements

### 7.1 Branches and inventory
- CRUD for branches with address, contact details and invoice prefix.
- Product catalogue with the two tracking types.
- Serialized unit list filterable by branch, condition, status, product; search by IMEI/serial.
- Per-branch quantity view for accessories, with a cross-branch availability popover (visible to all roles, quantities only).
- **Alerts:** low stock when available quantity ≤ reorder level (per branch); aging when a serialized unit has been `IN_STOCK` for more than 60 days. Surface on the dashboard and inventory screens.

### 7.2 Stock intake and supplier credit
- Intake form: supplier, destination branch, payment terms, line items. Serialized lines take a list of IMEIs/serials (paste or scan, one per line) with condition, colour, storage, RAM, battery health, cost and selling price. Non-serialized lines take quantity, cost and selling price.
- Creates a `PurchaseOrder`, the units or quantity increase, and (if any amount is paid now) a `SupplierPayment`.
- Due date computed from terms (Net 7/15/30). Overdue POs are flagged.
- Printable SKU barcode label sheet after intake.
- Supplier profile: running payable balance, POs, payment history, "Record payout" against a specific PO.

### 7.3 Inter-branch transfers
- `DRAFT → IN_TRANSIT → RECEIVED` (or `CANCELLED` from DRAFT; cancelling in transit returns stock to source and requires manager/owner).
- Serialized items are picked by exact IMEI; the transfer records each one.
- Shipping requires manager of the source branch or owner. Receiving requires manager of the destination branch or owner. Receiving supports partial quantity for accessories and flags discrepancies.
- Printable **Transfer Waybill / Manifest** listing every IMEI, with sign-off lines for sender, driver and receiver.

### 7.4 POS and invoicing
- Single search box: product name, SKU, barcode, or IMEI/serial. An IMEI match adds that exact unit. Barcode scanners act as keyboard input ending in Enter — the search box must stay focused and handle this.
- Cart shows only stock at the cashier's branch. Sister-branch availability is view-only.
- Customer picker with inline "new customer" (name + phone minimum).
- Line and invoice discounts, configurable VAT, trade-in deduction (records a `TradeIn`; optionally creates a new `SerializedUnit` with status `TRADED_IN` for later intake).
- Split payment across Cash, Bank Transfer and POS Card with references.
- **Installment calculator:** down payment, number of installments, frequency, first due date → previews the full schedule. The last installment absorbs rounding. Optional guarantor and ID notes. Plans above a configurable threshold, or with down payment below a configurable minimum percentage, need manager approval.
- On checkout, in one transaction: create invoice and items, mark units `SOLD`, decrement accessory quantity, insert payments, create plan and schedule, create warranty cards, write audit log. After commit: enqueue receipt and warranty messages.

### 7.5 Installments and collections
- Any branch can record a repayment against any open invoice. Payments apply to the oldest unpaid schedule row first; overpayment rolls into the next row.
- Status moves `UNPAID → PARTIALLY_PAID → PAID`; plan becomes `COMPLETED` when the balance reaches zero.
- A daily job marks past-due schedule rows `OVERDUE`.
- Waive/adjust debt is OWNER only, needs a reason, and is audit-logged.

### 7.6 Returns and swaps
- Return against an invoice line: serialized unit goes back to `IN_STOCK` (or `DEFECTIVE`) at the receiving branch, warranty card is voided, open credit balance is reduced first and any remainder is refunded as a `REFUND` payment row.
- A swap is a return plus a new invoice linked to it.

### 7.7 Documents
- **A4 PDF invoice:** issuing branch details, customer, items with IMEI/serial and condition, warranty terms and expiry, totals, payments, and for installment sales a payment schedule and balance summary.
- **80mm thermal receipt:** same data, compact.
- **Digital warranty certificate:** PDF plus hosted page at `/w/[publicId]` with QR code. The public page shows device model, masked IMEI (last 4 visible), branch, purchase date, expiry and current status. No customer personal data.

### 7.8 Dashboard and reports
- Branch switcher: "All branches" (OWNER only) or a single branch. Managers and cashiers are fixed to their branch.
- KPIs, each clearly labelled: **Total Invoiced Sales**, **Cash Collected**, **Net Profit** (OWNER only), **Customer Receivables**, **Supplier Payables** (OWNER only), **Inventory Valuation** (at cost: OWNER; at selling price: manager).
- Invoiced vs collected trend, per-branch comparison table, alerts panel.
- **Aging reports:** receivables and payables bucketed into Not yet due, 1–7, 8–14, 15–30, 30+ days overdue, plus an "upcoming in 7 days" list.

## 8. RBAC matrix

| Capability | Owner | Branch Manager | Cashier |
|---|---|---|---|
| Branch scope | All | Own branch | Own branch |
| Create invoice, add customer | ✓ | ✓ | ✓ |
| Record installment repayment (any invoice) | ✓ | ✓ | ✓ |
| Resend receipt / send reminder | ✓ | ✓ | ✓ |
| View sister-branch stock quantities | ✓ | ✓ | ✓ |
| Approve installment plans | ✓ | Own branch | ✗ |
| Receive stock / create intake | ✓ | Own branch | ✗ |
| Create, ship, receive transfers | ✓ | Own branch side | ✗ |
| View cost price, margins, profit | ✓ | ✗ | ✗ |
| View supplier payables, record payouts | ✓ | ✗ | ✗ |
| Edit prices, adjust stock | ✓ | ✗ | ✗ |
| Void invoice | ✓ | Own branch, same day | ✗ |
| Waive / adjust debt | ✓ | ✗ | ✗ |
| Manage users, branches, tax | ✓ | ✗ | ✗ |
| Messaging API keys and templates | ✓ | ✗ | ✗ |
| View audit log | ✓ | Own branch | ✗ |

Implement as a single `can(ctx, action, resource?)` function in `server/auth/permissions.ts`. Every service function calls it first. UI uses the same function to hide controls.

## 9. Notification engine

```ts
interface MessageProvider {
  name: string;
  channel: 'WHATSAPP' | 'SMS';
  send(msg: { to: string; body: string; mediaUrl?: string; templateName?: string; variables?: Record<string,string> }): Promise<{ providerMessageId: string }>;
  parseWebhook?(req: Request): Promise<{ providerMessageId: string; status: 'SENT' | 'DELIVERED' | 'FAILED'; error?: string }[]>;
}
```

- `WHATSAPP_PROVIDER` = `whatsapp-cloud` | `twilio` | `console`; `SMS_PROVIDER` = `termii` | `twilio` | `console`.
- Flow: render template → write `QUEUED` log → try WhatsApp (if opted in) → on failure or no opt-in, fall back to SMS with a link instead of an attachment → update the log. Webhooks move `SENT → DELIVERED`/`FAILED`.
- WhatsApp business-initiated messages need pre-approved templates. Keep a `templateName` mapping per template key and document in the README which templates must be registered with Meta.
- Document links in messages are signed, expiring URLs to the PDF routes.

**Template keys** (editable body with `{{variables}}`, stored in `MessageTemplate`, defaults seeded):

| Key | Trigger |
|---|---|
| `receipt` | Immediately after checkout, with invoice link |
| `warranty_card` | Immediately after checkout, per serialized device |
| `installment_due_3d` | Cron, 3 days before due date |
| `installment_due_today` | Cron, morning of due date |
| `installment_overdue_1d` / `_7d` / `_14d` | Cron, days past due |
| `payment_confirmation` | Immediately when a repayment is recorded |
| `manual_reminder` | Staff button on invoice or customer profile |

Reminder variables: customer name, amount due, due date, balance remaining, invoice number, branch name, payment instructions (bank details from Settings).

**Cron jobs** (all times Africa/Lagos):

| Route | Schedule | Does |
|---|---|---|
| `/api/cron/installment-reminders` | Daily 08:00 | 3-day and due-today reminders |
| `/api/cron/overdue-escalation` | Daily 09:00 | Mark rows `OVERDUE`; send 1/7/14-day escalations |
| `/api/cron/stock-alerts` | Daily 07:00 | Recompute low-stock and 60-day aging alerts |
| `/api/cron/retry-notifications` | Every 15 min | Retry `FAILED`/stuck `QUEUED`, max 3 attempts |

Each route rejects requests without `Authorization: Bearer $CRON_SECRET`.

**Notification centre:** per-customer and global log with status, channel, timestamp, body preview and a one-click **Resend**.

## 10. Environment variables

```
DATABASE_URL=
AUTH_SECRET=
APP_URL=http://localhost:3000
CRON_SECRET=
DOCUMENT_SIGNING_SECRET=

WHATSAPP_PROVIDER=console          # whatsapp-cloud | twilio | console
WHATSAPP_CLOUD_PHONE_NUMBER_ID=
WHATSAPP_CLOUD_ACCESS_TOKEN=
WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN=

SMS_PROVIDER=console               # termii | twilio | console
TERMII_API_KEY=
TERMII_SENDER_ID=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
TWILIO_SMS_FROM=
```

Keep `.env.example` in sync whenever a variable is added. Never commit `.env`.

## 11. Seed data

`prisma/seed.ts` must be idempotent and create:

- 4 branches (Main, Ikeja, Lekki, Central Warehouse)
- 1 owner, 1 manager and 1 cashier per store branch (print the dev logins to the console; passwords come from `SEED_PASSWORD`, default documented in README)
- ~10 products across phones, laptops, consoles, smartwatches and accessories
- ~25 serialized units across branches in mixed conditions, with at least 3 older than 60 days
- Accessory quantities per branch, with at least 2 below reorder level
- 2 suppliers; one PO paid in full, one on Net 30 with a partial payout, one overdue
- 5 customers; one paid-in-full invoice, one **active installment plan** with a down payment and one repayment made, one overdue installment
- 1 transfer in transit and 1 completed
- Default message templates and settings

## 12. Build order

Work through these in order. Finish, typecheck and commit each before starting the next. Stop and ask after step 1 so the schema can be reviewed.

1. `schema.prisma`, migration, audit-log immutability trigger, seed
2. Auth, session, `can()`, branch context, app shell with branch switcher
3. Inventory views + stock intake form (serialized IMEIs, supplier credit terms, barcode labels)
4. Inter-branch transfers + waybill PDF
5. POS / invoice builder with installment calculator
6. PDF invoice, thermal receipt, warranty card + public verification page
7. Notification service, provider adapters, templates, webhooks, post-checkout dispatch
8. Receivables ledger: repayment recording with instant confirmation; payables ledger: supplier payouts
9. Cron handlers: reminders, escalation, stock alerts, retry
10. Executive dashboard and aging reports
11. Returns, swaps, trade-ins
12. Settings (branches, users, tax, templates, API keys), audit log viewer, notification centre
13. README with setup steps, Playwright smoke test

## 13. Conventions

- Server Components by default; `'use client'` only for interactive pieces. Mutations go through server actions that return `{ ok: true, data } | { ok: false, error }`.
- Zod-validate every server action input. Never pass raw form data to a service.
- Named exports; no default exports outside Next.js route files.
- Dates are stored in UTC; due dates are calendar dates interpreted in Africa/Lagos.
- Phone numbers are normalised to E.164 on write through `lib/phone.ts`.
- No `any`. No `// @ts-ignore`. No commented-out code.
- Do not add a dependency for something under ~30 lines of code.
- Write a Vitest test for each of: schedule generation, payment allocation, balance recalculation, concurrent IMEI sale, transfer state transitions, notification dedupe and fallback, role-based field stripping.
- Commit messages: imperative mood, one logical change per commit.

## 14. Definition of done (per feature)

- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- Permission checked in the service, not only in the UI
- Mutation is transactional and writes an audit row
- Works at 1024px (tablet landscape) and 1440px
- Empty, loading and error states exist
- Works end to end against seed data with `console` providers

## 15. Out of scope for v1

Online payments/gateway integration, e-commerce storefront, payroll, full double-entry general ledger, native mobile apps, offline mode. Do not build these; note them as future work if they come up.

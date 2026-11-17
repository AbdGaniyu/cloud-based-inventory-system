# Gadget Hub

Multi-branch inventory, POS invoicing, credit ledger and automated customer messaging for a gadget retailer.
Project rules live in [`CLAUDE.md`](./CLAUDE.md); visual rules in [`DESIGN.md`](./DESIGN.md).

> Status: build steps 1–2 of 13 done (database + seed; auth, RBAC, branch context, app shell). Full setup docs land in step 13.

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

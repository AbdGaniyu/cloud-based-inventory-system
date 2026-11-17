import "dotenv/config";

import { Client } from "pg";

/**
 * Least-privilege database login for the running app (run as the database owner, after every
 * `prisma migrate deploy`; safe to re-run):
 *
 *   APP_DB_PASSWORD=… pnpm db:grant-app            # role "gadgethub_app" (or APP_DB_ROLE)
 *
 * The app role can read and write rows but owns nothing, so it can't ALTER or DROP tables, disable or
 * drop the audit/stock/cash-up triggers or the CHECK constraints, or TRUNCATE anything. It may DELETE
 * only from the housekeeping tables the app prunes; invoices, payments, audit rows, adjustments and
 * cash-ups can't be deleted even by compromised app code. Migrations and the seed keep using the
 * owner login (MIGRATION_DATABASE_URL, or DATABASE_URL before you switch it to the app role).
 */

/** Tables the app itself deletes from (pruning and resets). Keep in sync with deleteMany calls in src/server. */
export const APP_DELETABLE_TABLES = ["auth_throttles", "error_events", "job_runs", "rate_limit_buckets", "recovery_codes", "settings"] as const;
/** Append-only tables: the app only ever inserts (their triggers also refuse changes). */
export const APP_INSERT_ONLY_TABLES = ["audit_logs", "stock_adjustments"] as const;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export async function grantAppRole(ownerUrl: string, role: string, password: string): Promise<void> {
  if (!IDENTIFIER.test(role)) throw new Error(`Role name "${role}" must be lowercase letters, digits and underscores`);
  if (password.length < 16) throw new Error("APP_DB_PASSWORD must be at least 16 characters");
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ db: string; owner: string }>("SELECT current_database() AS db, current_user AS owner");
    const { db, owner } = rows[0];
    const quoted = `"${role}"`;
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    // Passwords can't be bound as parameters in DDL; quote_literal escapes it server-side.
    const literal = (await client.query<{ q: string }>("SELECT quote_literal($1) AS q", [password])).rows[0].q;
    await client.query(
      exists.rowCount
        ? `ALTER ROLE ${quoted} WITH LOGIN PASSWORD ${literal} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`
        : `CREATE ROLE ${quoted} WITH LOGIN PASSWORD ${literal} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    const statements = [
      `GRANT CONNECT ON DATABASE "${db}" TO ${quoted}`,
      `GRANT USAGE ON SCHEMA public TO ${quoted}`,
      `REVOKE CREATE ON SCHEMA public FROM ${quoted}`,
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
      // Start from nothing, then grant row access.
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quoted}`,
      `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${quoted}`,
      ...APP_DELETABLE_TABLES.map((t) => `GRANT DELETE ON "${t}" TO ${quoted}`),
      ...APP_INSERT_ONLY_TABLES.map((t) => `REVOKE UPDATE ON "${t}" FROM ${quoted}`),
      // Migration history is the owner's business.
      `REVOKE ALL ON "_prisma_migrations" FROM ${quoted}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoted}`,
      // Tables added by future migrations get row access too (DELETE stays opt-in via this script).
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO ${quoted}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quoted}`,
    ];
    for (const sql of statements) await client.query(sql);
    console.info(`Granted least-privilege access on "${db}" to role ${role} (owner: ${owner}).`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  const password = process.env.APP_DB_PASSWORD;
  if (!ownerUrl) throw new Error("Set MIGRATION_DATABASE_URL (the owner login) or DATABASE_URL");
  if (!password) throw new Error("Set APP_DB_PASSWORD for the app's database login");
  await grantAppRole(ownerUrl, process.env.APP_DB_ROLE ?? "gadgethub_app", password);
}

if (process.argv[1]?.endsWith("db-grant-app-role.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

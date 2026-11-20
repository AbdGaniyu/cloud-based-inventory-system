import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { neonConfig, Pool } from "@neondatabase/serverless";

/**
 * `prisma migrate deploy` for hosts that can't open TCP 5432 (it needs a direct connection).
 * Applies pending folders in prisma/migrations to a Neon database over WebSockets (port 443) and
 * records them in `_prisma_migrations` exactly as Prisma does (same table, sha256 checksums), so
 * `prisma migrate status` / `deploy` run from anywhere else later see the same history.
 * Each migration runs in one transaction; a failure rolls it back and stops.
 *
 *   pnpm db:migrate:https
 */

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL (or DATABASE_URL)");

neonConfig.webSocketConstructor ??= globalThis.WebSocket;

const migrationsDir = path.join(process.cwd(), "prisma", "migrations");

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);

    const { rows } = await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`,
    );
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at);
    if (failed.length > 0) {
      throw new Error(`Unfinished migrations need attention first: ${failed.map((r) => r.migration_name).join(", ")}`);
    }
    const applied = new Set(rows.filter((r) => r.finished_at).map((r) => r.migration_name));

    const names = readdirSync(migrationsDir)
      .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
      .sort();

    let count = 0;
    for (const name of names) {
      if (applied.has(name)) continue;
      const sql = readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      process.stdout.write(`Applying ${name} ... `);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
           VALUES ($1, $2, $3, now(), now(), 1)`,
          [randomUUID(), checksum, name],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        console.log("failed");
        throw error;
      }
      console.log("done");
      count += 1;
    }
    console.log(count === 0 ? "Database is up to date." : `${count} migration(s) applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

import { execFileSync } from "node:child_process";

import { Client } from "pg";

import { testDatabaseUrl } from "./test-database-url";

/** Creates the test database if needed and applies all migrations (including hand-written SQL). */
export default async function globalSetup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  admin.search = "";

  const client = new Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(`Cannot reach Postgres for tests at ${admin.host}. Run \`docker compose up -d db\`.`, { cause: error });
  }
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
  await client.end();

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
  });
}

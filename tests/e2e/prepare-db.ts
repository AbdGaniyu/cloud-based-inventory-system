import { execFileSync } from "node:child_process";

import { Client } from "pg";

import { e2eDatabaseUrl, loadDotEnv } from "./e2e-env";

/**
 * Recreates the smoke-test database from scratch (migrations + seed) so every run starts with the
 * same stock and ledger. Refuses to touch any database whose name does not end in "_e2e".
 */
async function main(): Promise<void> {
  loadDotEnv();
  const url = new URL(e2eDatabaseUrl());
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_e2e")) throw new Error(`Refusing to reset "${dbName}": the smoke-test database name must end in _e2e`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  admin.search = "";

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  const env = { ...process.env, DATABASE_URL: url.toString() };
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env, stdio: "inherit" });
  execFileSync("pnpm", ["exec", "tsx", "prisma/seed.ts"], { env, stdio: "inherit" });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

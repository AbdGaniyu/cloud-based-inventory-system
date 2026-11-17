import "dotenv/config";

import { createPrismaClient } from "@/server/db";
import { type IntegrityResult, runIntegrityChecks } from "@/server/ops/integrity";

/**
 * Integrity check for a live database or a restored backup (the checks live in src/server/ops/integrity.ts):
 *
 *   pnpm db:verify                      # DATABASE_URL
 *   pnpm db:verify postgresql://…       # any database (e.g. a restore drill)
 *
 * Exits 1 on any problem.
 */
export async function verifyLedger(url: string): Promise<IntegrityResult[]> {
  const client = createPrismaClient(url);
  try {
    return await runIntegrityChecks(client);
  } finally {
    await client.$disconnect();
  }
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Pass a database URL or set DATABASE_URL");
  const results = await verifyLedger(url);
  for (const r of results) {
    console.info(`${r.problems === 0 ? "ok  " : "FAIL"}  ${r.name}${r.problems ? ` (${r.problems})` : ""}`);
    for (const row of r.sample) console.info(`        ${JSON.stringify(row)}`);
  }
  const failed = results.filter((r) => r.problems > 0).length;
  console.info(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
  if (failed > 0) process.exit(1);
}

if (process.argv[1]?.endsWith("verify-ledger.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

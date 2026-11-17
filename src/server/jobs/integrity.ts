import "server-only";

import { db } from "@/server/db";
import { sendOpsAlert } from "@/server/ops/alerts";
import { runIntegrityChecks } from "@/server/ops/integrity";

/** Daily: run the ledger and stock integrity checks; any failure alerts the owner (rate-limited like other ops alerts). */
export async function runDailyIntegrityCheck(): Promise<{ checks: number; failed: string[] }> {
  const results = await runIntegrityChecks(db);
  const failed = results.filter((r) => r.problems > 0);
  if (failed.length > 0) {
    await sendOpsAlert(
      "ledger-integrity",
      "Ledger or stock integrity check failed",
      failed.map((f) => `${f.name}: ${f.problems} row(s), e.g. ${JSON.stringify(f.sample[0] ?? {})}`.slice(0, 300)),
    );
  }
  return { checks: results.length, failed: failed.map((f) => f.name) };
}

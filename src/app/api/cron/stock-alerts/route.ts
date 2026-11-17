import { runCronJob } from "@/server/jobs/cron";
import { runDailyIntegrityCheck } from "@/server/jobs/integrity";
import { runStockAlerts } from "@/server/jobs/stock-alerts";

/** Daily 07:00 Africa/Lagos: recompute low-stock and aging alerts, then check ledger and stock integrity (alerts on drift). */
export const maxDuration = 300;

async function handle(request: Request) {
  return runCronJob(request, "stock-alerts", async () => ({ ...(await runStockAlerts()), integrity: await runDailyIntegrityCheck() }));
}

export const GET = handle;
export const POST = handle;

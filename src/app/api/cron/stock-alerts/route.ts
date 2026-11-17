import { runCronJob } from "@/server/jobs/cron";
import { runStockAlerts } from "@/server/jobs/stock-alerts";

/** Daily 07:00 Africa/Lagos: recompute low-stock and aging alerts. */
export const maxDuration = 300;

async function handle(request: Request) {
  return runCronJob(request, "stock-alerts", () => runStockAlerts());
}

export const GET = handle;
export const POST = handle;

import { runCronJob } from "@/server/jobs/cron";
import { runNotificationRetry } from "@/server/jobs/retry-notifications";
import { checkOpsHealth } from "@/server/ops/jobs";

/** Every 15 minutes: retry failed and stuck messages, then check job freshness and message failures (alerts). */
export const maxDuration = 300;

async function handle(request: Request) {
  return runCronJob(request, "retry-notifications", async () => ({ ...(await runNotificationRetry()), ops: await checkOpsHealth() }));
}

export const GET = handle;
export const POST = handle;

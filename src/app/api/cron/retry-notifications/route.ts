import { runCronJob } from "@/server/jobs/cron";
import { runNotificationRetry } from "@/server/jobs/retry-notifications";

/** Every 15 minutes: retry failed and stuck messages (max attempts from settings). */
export const maxDuration = 300;

async function handle(request: Request) {
  return runCronJob(request, "retry-notifications", () => runNotificationRetry());
}

export const GET = handle;
export const POST = handle;

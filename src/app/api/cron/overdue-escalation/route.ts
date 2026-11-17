import { runCronJob } from "@/server/jobs/cron";
import { runOverdueEscalation } from "@/server/jobs/installment-reminders";

/** Daily 09:00 Africa/Lagos: mark past-due instalments OVERDUE, then send 1/7/14-day escalations. */
export const maxDuration = 300;

async function handle(request: Request) {
  return runCronJob(request, "overdue-escalation", () => runOverdueEscalation());
}

export const GET = handle;
export const POST = handle;

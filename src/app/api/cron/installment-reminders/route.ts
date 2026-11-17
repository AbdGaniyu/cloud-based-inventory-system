import { runCronJob } from "@/server/jobs/cron";
import { runInstallmentReminders } from "@/server/jobs/installment-reminders";

/** Daily 08:00 Africa/Lagos: 3-day and due-today instalment reminders. */
export const maxDuration = 300;

async function handle(request: Request) {
  return runCronJob(request, "installment-reminders", () => runInstallmentReminders());
}

export const GET = handle;
export const POST = handle;

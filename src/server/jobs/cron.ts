import "server-only";

import { verifyToken } from "@/server/notifications/providers/types";
import { type JobName, runTrackedJob } from "@/server/ops/jobs";
import { logEvent } from "@/server/ops/log";

/**
 * Cron routes accept only `Authorization: Bearer $CRON_SECRET` (CLAUDE.md §9). Vercel Cron sends
 * this header automatically when CRON_SECRET is set; scripts/cron-local.ts sends it locally.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") === true && verifyToken(header.slice("Bearer ".length), secret);
}

/** Authorises, runs the job as a tracked JobRun (failures are recorded and alerted) and answers with its summary. */
export async function runCronJob<T extends object>(request: Request, name: JobName, job: () => Promise<T>): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    if (!process.env.CRON_SECRET) logEvent("error", "cron refused: CRON_SECRET is not set", { job: name });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = new Date();
  try {
    const result = await runTrackedJob(name, job);
    logEvent("info", "cron job finished", { job: name, durationMs: Date.now() - startedAt.getTime(), result });
    return Response.json({ job: name, startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime(), ...result });
  } catch {
    return Response.json({ job: name, error: "Job failed; see the System page or server logs" }, { status: 500 });
  }
}

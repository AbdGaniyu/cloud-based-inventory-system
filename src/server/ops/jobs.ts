import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { sendOpsAlert } from "@/server/ops/alerts";
import { reportError } from "@/server/ops/errors";
import { logEvent } from "@/server/ops/log";
import { redactOldMessages } from "@/server/services/privacy.service";
import { pruneRateLimits } from "@/server/services/rate-limit.service";

/**
 * Scheduled-job bookkeeping: every run is a JobRun row, a failure alerts, and a job that stops
 * running (cron misconfigured, platform outage) is flagged once its last success is too old.
 */

/** How long after its last success a job counts as stale: daily jobs get 26 hours, the 15-minute retry 45 minutes. */
export const JOB_SCHEDULES = {
  "stock-alerts": { label: "Stock alerts (daily 07:00)", staleAfterMinutes: 26 * 60 },
  "installment-reminders": { label: "Instalment reminders (daily 08:00)", staleAfterMinutes: 26 * 60 },
  "overdue-escalation": { label: "Overdue escalation (daily 09:00)", staleAfterMinutes: 26 * 60 },
  "retry-notifications": { label: "Message retries (every 15 min)", staleAfterMinutes: 45 },
} as const;
export type JobName = keyof typeof JOB_SCHEDULES;

export function isJobName(value: string): value is JobName {
  return value in JOB_SCHEDULES;
}

/** Runs a job with its JobRun row; a failure is recorded, reported and alerted, then re-thrown. */
export async function runTrackedJob<T extends object>(job: JobName, run: () => Promise<T>): Promise<T> {
  const started = new Date();
  const row = await db.jobRun.create({ data: { job, startedAt: started }, select: { id: true } });
  try {
    const result = await run();
    await db.jobRun.update({ where: { id: row.id }, data: { finishedAt: new Date(), ok: true, summary: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.jobRun.update({ where: { id: row.id }, data: { finishedAt: new Date(), ok: false, error: message.slice(0, 1000) } }).catch(() => undefined);
    await reportError(error, { source: "job", route: `/api/cron/${job}` });
    await sendOpsAlert(`job-failed:${job}`, `Scheduled job failed: ${JOB_SCHEDULES[job].label}`, [message.slice(0, 300)]);
    throw error;
  }
}

export type JobStatus = "ok" | "stale" | "failing" | "never";
export type JobHealth = { job: JobName; label: string; status: JobStatus; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; summary: Prisma.JsonValue | null };

export async function jobHealth(now: Date = new Date()): Promise<JobHealth[]> {
  return Promise.all(
    (Object.keys(JOB_SCHEDULES) as JobName[]).map(async (job) => {
      const [last, lastOk] = await Promise.all([
        db.jobRun.findFirst({ where: { job, finishedAt: { not: null } }, orderBy: { startedAt: "desc" } }),
        db.jobRun.findFirst({ where: { job, ok: true }, orderBy: { startedAt: "desc" } }),
      ]);
      const staleBefore = now.getTime() - JOB_SCHEDULES[job].staleAfterMinutes * 60_000;
      const status: JobStatus = !last ? "never" : last.ok === false ? "failing" : !lastOk || lastOk.startedAt.getTime() < staleBefore ? "stale" : "ok";
      return {
        job,
        label: JOB_SCHEDULES[job].label,
        status,
        lastRunAt: last?.startedAt.toISOString() ?? null,
        lastSuccessAt: lastOk?.startedAt.toISOString() ?? null,
        lastError: last?.ok === false ? last.error : null,
        summary: lastOk?.summary ?? null,
      };
    }),
  );
}

/** Failed messages in the last hour above which someone should look at the provider. */
export const FAILED_MESSAGE_ALERT_THRESHOLD = 5;
const ERROR_RETENTION_DAYS = 30;
const JOB_RUN_RETENTION_DAYS = 60;
const DAY_MS = 86_400_000;

/**
 * Run by the 15-minute job: alerts on stale or failing jobs and on a burst of failed messages,
 * then prunes old operations history.
 */
export async function checkOpsHealth(now: Date = new Date()): Promise<{ staleJobs: string[]; failedMessagesLastHour: number; pruned: number; messagesRedacted: number }> {
  const jobs = await jobHealth(now);
  // A job that has never run only counts once scheduling has been live longer than its window
  // (otherwise every fresh deploy would alert before the first morning run).
  const firstRun = await db.jobRun.findFirst({ orderBy: { startedAt: "asc" }, select: { startedAt: true } });
  const liveFor = firstRun ? now.getTime() - firstRun.startedAt.getTime() : 0;
  const unhealthy = jobs.filter(
    (j) => j.status === "stale" || j.status === "failing" || (j.status === "never" && liveFor > JOB_SCHEDULES[j.job].staleAfterMinutes * 60_000),
  );
  for (const j of unhealthy) {
    const what = j.status === "failing" ? "failing" : j.status === "never" ? "not running at all (check the cron set-up)" : "not running on schedule";
    await sendOpsAlert(`job-${j.status}:${j.job}`, `${j.label} is ${what}`, [
      j.lastSuccessAt ? `Last success: ${j.lastSuccessAt}` : "It has never succeeded.",
      ...(j.lastError ? [j.lastError.slice(0, 200)] : []),
    ]);
  }
  const failedMessagesLastHour = await db.notificationLog.count({ where: { status: "FAILED", failedAt: { gte: new Date(now.getTime() - 60 * 60_000) }, fallbacks: { none: {} } } });
  if (failedMessagesLastHour >= FAILED_MESSAGE_ALERT_THRESHOLD) {
    await sendOpsAlert("messages-failing", `${failedMessagesLastHour} customer messages failed in the last hour`, ["Check Settings → Messaging providers and the Notifications page."]);
  }
  const [errors, runs] = await Promise.all([
    db.errorEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - ERROR_RETENTION_DAYS * DAY_MS) } } }),
    db.jobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - JOB_RUN_RETENTION_DAYS * DAY_MS) } } }),
  ]);
  const buckets = await pruneRateLimits(now);
  const redacted = await redactOldMessages(now);
  if (unhealthy.length) logEvent("warn", "unhealthy jobs", { jobs: unhealthy.map((j) => `${j.job}:${j.status}`) });
  return { staleJobs: unhealthy.map((j) => j.job), failedMessagesLastHour, pruned: errors.count + runs.count + buckets, messagesRedacted: redacted };
}

export type HealthReport = { status: "ok" | "degraded" | "down"; database: "ok" | "down"; jobs: Record<string, JobStatus>; time: string; version: string | null };

/** For /api/health: database reachability and job freshness, with nothing sensitive in it. */
export async function healthReport(now: Date = new Date()): Promise<HealthReport> {
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.APP_VERSION ?? null;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    return { status: "down", database: "down", jobs: {}, time: now.toISOString(), version };
  }
  const jobs = await jobHealth(now);
  const statuses = Object.fromEntries(jobs.map((j) => [j.job, j.status]));
  // "never" is degraded too: on a live install it usually means cron was never configured.
  const degraded = jobs.some((j) => j.status !== "ok");
  return { status: degraded ? "degraded" : "ok", database: "ok", jobs: statuses, time: now.toISOString(), version };
}

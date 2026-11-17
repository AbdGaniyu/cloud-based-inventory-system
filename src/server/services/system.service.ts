import "server-only";

import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { alertChannels, sendOpsAlert } from "@/server/ops/alerts";
import { type HealthReport, healthReport, type JobHealth, jobHealth } from "@/server/ops/jobs";
import { maskSecret } from "@/server/secrets";

/** Settings → System (owner): job freshness, recent server errors, alert channels. */

export type SystemStatus = {
  health: HealthReport;
  jobs: JobHealth[];
  errors: { id: string; createdAt: string; source: string; route: string | null; message: string; digest: string | null }[];
  errorsLast24h: number;
  failedMessagesLast24h: number;
  channels: { webhook: boolean; phone: string | null };
};

const RECENT_ERRORS = 50;
const DAY_MS = 86_400_000;

export async function getSystemStatus(ctx: Ctx, now: Date = new Date()): Promise<SystemStatus> {
  assertCan(ctx, "settings.view");
  const since = new Date(now.getTime() - DAY_MS);
  const [health, jobs, errors, errorsLast24h, failedMessagesLast24h] = await Promise.all([
    healthReport(now),
    jobHealth(now),
    db.errorEvent.findMany({ orderBy: { createdAt: "desc" }, take: RECENT_ERRORS }),
    db.errorEvent.count({ where: { createdAt: { gte: since } } }),
    db.notificationLog.count({ where: { status: "FAILED", failedAt: { gte: since }, fallbacks: { none: {} } } }),
  ]);
  const channels = alertChannels();
  return {
    health,
    jobs,
    errors: errors.map((e) => ({ id: e.id, createdAt: e.createdAt.toISOString(), source: e.source, route: e.route, message: e.message, digest: e.digest })),
    errorsLast24h,
    failedMessagesLast24h,
    channels: { webhook: channels.webhook, phone: channels.phone ? maskSecret(channels.phone) : null },
  };
}

/** Proves the alert channels work. Uses its own kind so it is never held back by the hourly limit. */
export async function sendTestAlert(ctx: Ctx, now: Date = new Date()): Promise<{ sent: boolean; channels: string[] }> {
  assertCan(ctx, "settings.view");
  return sendOpsAlert(`test:${now.getTime()}`, "Test alert from Settings → System", ["If you can read this, operations alerts reach you."], { now });
}

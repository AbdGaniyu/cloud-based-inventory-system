import "server-only";

import { z } from "zod";

import { db } from "@/server/db";
import { deliverMessage, type NotifyOptions } from "@/server/notifications";
import { getSetting } from "@/server/services/settings.service";

/**
 * Every 15 minutes: retries FAILED messages and QUEUED ones that never went out (a crashed or
 * timed-out run), up to the attempt limit. A WhatsApp failure already covered by an SMS fallback is
 * left alone, and messages older than a day are not retried: a stale reminder helps no one.
 */

export type RetrySummary = { retried: number; sent: number; failedAgain: number; gaveUp: number };

const RETRY_AFTER_MS = 10 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const BATCH_LIMIT = 200;
const DEFAULT_MAX_ATTEMPTS = 3;
export const GAVE_UP_ERROR = "No result from the provider after the maximum number of attempts";

export async function runNotificationRetry(options: NotifyOptions = {}): Promise<RetrySummary> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETRY_AFTER_MS);
  const oldest = new Date(now.getTime() - MAX_AGE_MS);
  const maxAttempts = await getSetting("notifications.maxAttempts", z.number().int().min(1).max(10), DEFAULT_MAX_ATTEMPTS);

  // QUEUED rows whose last attempt never finished, with no attempts left: record the failure.
  const gaveUp = await db.notificationLog.updateMany({
    where: { status: "QUEUED", attempts: { gte: maxAttempts }, lastAttemptAt: { lt: cutoff } },
    data: { status: "FAILED", error: GAVE_UP_ERROR, failedAt: now },
  });

  const candidates = await db.notificationLog.findMany({
    where: {
      createdAt: { gte: oldest },
      attempts: { lt: maxAttempts },
      fallbacks: { none: {} },
      OR: [
        { status: "FAILED", OR: [{ lastAttemptAt: { lt: cutoff } }, { lastAttemptAt: null }] },
        { status: "QUEUED", OR: [{ lastAttemptAt: { lt: cutoff } }, { lastAttemptAt: null, createdAt: { lt: cutoff } }] },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_LIMIT,
  });

  const summary: RetrySummary = { retried: 0, sent: 0, failedAgain: 0, gaveUp: gaveUp.count };
  for (const { id } of candidates) {
    try {
      const status = await deliverMessage(id, options);
      if (status === null) continue;
      summary.retried++;
      if (status === "SENT") summary.sent++;
      else if (status === "FAILED") summary.failedAgain++;
    } catch (error) {
      console.error(`Retry of notification ${id} failed`, error);
    }
  }
  return summary;
}

import "server-only";

import { db } from "@/server/db";
import { writeAudit } from "@/server/services/audit.service";

/**
 * Password-guessing protection for sign-in and manager approval at the POS. Failures are counted
 * per key in the database (not memory), so the limit holds across server instances.
 */

const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

export const THROTTLE_LIMITS = {
  /** Per account (email): 5 wrong passwords in 15 minutes locks it for 15 minutes. */
  account: 5,
  /** Per client IP across accounts. */
  ip: 30,
} as const;

export type ThrottleKey = { key: string; limit: number };

export function throttleKeys(scope: "login" | "approve", email: string, extra?: { ip?: string | null; userId?: string }): ThrottleKey[] {
  const keys: ThrottleKey[] = [{ key: `${scope}:email:${email.trim().toLowerCase()}`, limit: THROTTLE_LIMITS.account }];
  if (extra?.ip) keys.push({ key: `${scope}:ip:${extra.ip}`, limit: THROTTLE_LIMITS.ip });
  // A cashier trying password after password for different managers.
  if (extra?.userId) keys.push({ key: `${scope}:user:${extra.userId}`, limit: THROTTLE_LIMITS.account });
  return keys;
}

/** Minutes until the first locked key frees up, or null when none is locked. */
export async function lockedMinutes(keys: ThrottleKey[], now: Date = new Date()): Promise<number | null> {
  const rows = await db.authThrottle.findMany({
    where: { key: { in: keys.map((k) => k.key) }, lockedUntil: { gt: now } },
    select: { lockedUntil: true },
  });
  const until = rows.reduce<Date | null>((latest, r) => (r.lockedUntil && (!latest || r.lockedUntil > latest) ? r.lockedUntil : latest), null);
  return until ? Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000)) : null;
}

/** Counts one failure against each key; locks keys that reach their limit within the window. */
export async function recordFailure(keys: ThrottleKey[], now: Date = new Date()): Promise<void> {
  for (const { key, limit } of keys) {
    const existing = await db.authThrottle.findUnique({ where: { key } });
    const windowExpired = !existing || now.getTime() - existing.windowStartedAt.getTime() > WINDOW_MS;
    const failures = windowExpired ? 1 : existing.failures + 1;
    const lockNow = failures >= limit;
    await db.authThrottle.upsert({
      where: { key },
      create: { key, failures, windowStartedAt: now, lockedUntil: lockNow ? new Date(now.getTime() + LOCK_MS) : null },
      update: {
        failures: lockNow ? 0 : failures,
        windowStartedAt: windowExpired || lockNow ? now : existing.windowStartedAt,
        lockedUntil: lockNow ? new Date(now.getTime() + LOCK_MS) : existing?.lockedUntil ?? null,
      },
    });
    if (lockNow) {
      await db.$transaction(async (tx) =>
        writeAudit(tx, {
          userId: null,
          branchId: null,
          action: "auth.lockout",
          entityType: "AuthThrottle",
          entityId: key,
          after: { key, failures, lockedForMinutes: LOCK_MS / 60_000 },
        }),
      );
    }
  }
}

/** Clears the account key after a successful attempt (IP keys keep counting other accounts' failures). */
export async function recordSuccess(keys: ThrottleKey[]): Promise<void> {
  await db.authThrottle.deleteMany({ where: { key: { in: keys.filter((k) => !k.key.includes(":ip:")).map((k) => k.key) } } });
}

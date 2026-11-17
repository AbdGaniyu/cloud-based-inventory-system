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
  /** One account from one IP (or one cashier asking for one manager): 5 wrong passwords locks just that pair. */
  pair: 5,
  /** One account from anywhere: caps distributed guessing without letting one attacker lock the owner out. */
  account: 20,
  /** One IP across accounts (password spraying). */
  ip: 30,
  /** One cashier trying many managers' passwords at the POS. */
  user: 10,
} as const;

export type ThrottleKey = { key: string; limit: number };

/**
 * Keys counted for an attempt. Lockouts are per account *and* source first, so someone guessing a
 * password locks themselves out, not the person whose account it is.
 */
export type ThrottleScope = "login" | "approve" | "reauth";

export function throttleKeys(scope: ThrottleScope, email: string, extra?: { ip?: string | null; userId?: string }): ThrottleKey[] {
  const account = email.trim().toLowerCase();
  const source = scope !== "login" ? `user:${extra?.userId ?? "unknown"}` : `ip:${extra?.ip ?? "unknown"}`;
  const keys: ThrottleKey[] = [
    { key: `${scope}:pair:${account}|${source}`, limit: THROTTLE_LIMITS.pair },
    { key: `${scope}:email:${account}`, limit: THROTTLE_LIMITS.account },
  ];
  if (extra?.ip) keys.push({ key: `${scope}:ip:${extra.ip}`, limit: THROTTLE_LIMITS.ip });
  if (extra?.userId) keys.push({ key: `${scope}:user:${extra.userId}`, limit: THROTTLE_LIMITS.user });
  return keys;
}

/** Keys to clear when an owner resets someone's password, so they can sign in at once. */
export function throttleKeysForAccount(email: string): { startsWith: string }[] {
  const account = email.trim().toLowerCase();
  return ["login", "approve", "reauth"].flatMap((scope) => [{ startsWith: `${scope}:pair:${account}|` }, { startsWith: `${scope}:email:${account}` }]);
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

import "server-only";

import { db } from "@/server/db";
import { logEvent } from "@/server/ops/log";

/**
 * Fixed-window rate limits for public endpoints (warranty checks, signed document links), so the
 * unguessable ids can't be enumerated and a scraper can't hammer PDF rendering. One atomic upsert
 * per request. The edge (Vercel Firewall, Cloudflare) should still carry a coarser limit in front.
 */

export const PUBLIC_LIMITS = {
  warranty: { limit: 30, windowSeconds: 60 },
  document: { limit: 30, windowSeconds: 60 },
} as const;
export type PublicLimit = keyof typeof PUBLIC_LIMITS;

export type RateDecision = { allowed: boolean; retryAfterSeconds: number };

/**
 * Counts one hit for `ip` against the named limit. An unknown IP is let through (and logged): with
 * client IP misconfigured, a shared "unknown" bucket would block every real customer at once.
 */
export async function hitRateLimit(name: PublicLimit, ip: string | null, now: Date = new Date()): Promise<RateDecision> {
  const { limit, windowSeconds } = PUBLIC_LIMITS[name];
  if (!ip) {
    logEvent("warn", "rate limit skipped: client IP unknown (check CLIENT_IP_HEADER / TRUSTED_PROXY_COUNT)", { limit: name });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number; window_start: Date }[]>`
    INSERT INTO rate_limit_buckets (key, window_start, count) VALUES (${`${name}:${ip}`}, ${now}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets.window_start <= ${cutoff} THEN 1 ELSE rate_limit_buckets.count + 1 END,
      window_start = CASE WHEN rate_limit_buckets.window_start <= ${cutoff} THEN ${now} ELSE rate_limit_buckets.window_start END
    RETURNING count, window_start`;
  const row = rows[0];
  if (!row || row.count <= limit) return { allowed: true, retryAfterSeconds: 0 };
  const retryAfterSeconds = Math.max(1, Math.ceil((row.window_start.getTime() + windowSeconds * 1000 - now.getTime()) / 1000));
  return { allowed: false, retryAfterSeconds };
}

/** Old buckets are dead weight; pruned by the 15-minute ops check. */
export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  const longest = Math.max(...Object.values(PUBLIC_LIMITS).map((l) => l.windowSeconds));
  const { count } = await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - longest * 2000) } } });
  return count;
}

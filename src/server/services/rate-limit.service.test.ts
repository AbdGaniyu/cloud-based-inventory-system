import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db";
import { hitRateLimit, PUBLIC_LIMITS, pruneRateLimits } from "@/server/services/rate-limit.service";
import { resetDatabase } from "@/test/db";

const T0 = new Date("2026-11-17T10:00:00Z");
const seconds = (n: number) => new Date(T0.getTime() + n * 1000);

describe("public rate limits", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows the limit per IP per window, then refuses with a retry time, and resets next window", async () => {
    const { limit } = PUBLIC_LIMITS.warranty;
    for (let i = 0; i < limit; i++) expect((await hitRateLimit("warranty", "203.0.113.7", seconds(i))).allowed).toBe(true);
    expect(await hitRateLimit("warranty", "203.0.113.7", seconds(40))).toEqual({ allowed: false, retryAfterSeconds: 20 });
    // Other IPs and other endpoints are counted separately.
    expect((await hitRateLimit("warranty", "198.51.100.1", seconds(40))).allowed).toBe(true);
    expect((await hitRateLimit("document", "203.0.113.7", seconds(40))).allowed).toBe(true);
    expect((await hitRateLimit("warranty", "203.0.113.7", seconds(61))).allowed).toBe(true);
  });

  it("lets unknown IPs through rather than lumping everyone into one bucket, and prunes old buckets", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 40; i++) expect((await hitRateLimit("document", null, T0)).allowed).toBe(true);
    await hitRateLimit("document", "203.0.113.7", T0);
    expect(await pruneRateLimits(seconds(3600))).toBe(1);
    expect(await db.rateLimitBucket.count()).toBe(0);
    vi.restoreAllMocks();
  });
});

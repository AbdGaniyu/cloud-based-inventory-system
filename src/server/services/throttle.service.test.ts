import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { verifyCredentials } from "@/server/services/auth.service";
import { lockedMinutes, recordFailure, recordSuccess, throttleKeys } from "@/server/services/throttle.service";
import { resetDatabase } from "@/test/db";

const T0 = new Date("2026-11-17T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("auth throttle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("locks an account for 15 minutes after 5 failures inside the window", async () => {
    const keys = throttleKeys("login", "Owner@Test.local");
    for (let i = 0; i < 4; i++) await recordFailure(keys, minutes(i));
    expect(await lockedMinutes(keys, minutes(4))).toBeNull();
    await recordFailure(keys, minutes(4));
    expect(await lockedMinutes(keys, minutes(5))).toBe(14);
    expect(await lockedMinutes(keys, minutes(20))).toBeNull();
    expect((await db.auditLog.findMany()).map((a) => a.action)).toEqual(["auth.lockout"]);
  });

  it("starts a fresh window when failures are spread out", async () => {
    const keys = throttleKeys("login", "a@test.local");
    for (let i = 0; i < 4; i++) await recordFailure(keys, minutes(i));
    await recordFailure(keys, minutes(30));
    expect(await lockedMinutes(keys, minutes(31))).toBeNull();
  });

  it("clears the account counter on success", async () => {
    const keys = throttleKeys("approve", "m@test.local", { userId: "u1" });
    for (let i = 0; i < 4; i++) await recordFailure(keys, minutes(i));
    await recordSuccess(keys);
    await recordFailure(keys, minutes(5));
    expect(await lockedMinutes(keys, minutes(6))).toBeNull();
  });
});

describe("sign-in lockout", () => {
  it("refuses even the right password while the account is locked", async () => {
    await resetDatabase();
    await db.user.create({ data: { name: "Owner", email: "owner@test.local", passwordHash: await bcrypt.hash("right", 4), role: "OWNER" } });
    for (let i = 0; i < 5; i++) expect(await verifyCredentials({ email: "owner@test.local", password: "wrong" }, "10.0.0.1")).toBeNull();
    await expect(verifyCredentials({ email: "owner@test.local", password: "right" }, "10.0.0.1")).rejects.toThrow(/Too many/);
  });
});

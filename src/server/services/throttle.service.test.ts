import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { resetUserPassword } from "@/server/services/admin.service";
import { verifyCredentials } from "@/server/services/auth.service";
import { lockedMinutes, recordFailure, recordSuccess, throttleKeys } from "@/server/services/throttle.service";
import { ctxFor, makeUser, resetDatabase } from "@/test/db";

const T0 = new Date("2026-11-17T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("auth throttle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("locks an account from one source for 15 minutes after 5 failures inside the window", async () => {
    const keys = throttleKeys("login", "Owner@Test.local", { ip: "203.0.113.9" });
    for (let i = 0; i < 4; i++) await recordFailure(keys, minutes(i));
    expect(await lockedMinutes(keys, minutes(4))).toBeNull();
    await recordFailure(keys, minutes(4));
    expect(await lockedMinutes(keys, minutes(5))).toBe(14);
    expect(await lockedMinutes(keys, minutes(20))).toBeNull();
    expect((await db.auditLog.findMany()).map((a) => a.action)).toEqual(["auth.lockout"]);
  });

  it("does not lock the real owner out when someone else guesses from another IP", async () => {
    const attacker = throttleKeys("login", "owner@test.local", { ip: "198.51.100.66" });
    for (let i = 0; i < 5; i++) await recordFailure(attacker, minutes(i));
    expect(await lockedMinutes(attacker, minutes(5))).not.toBeNull();
    expect(await lockedMinutes(throttleKeys("login", "owner@test.local", { ip: "203.0.113.9" }), minutes(5))).toBeNull();
  });

  it("caps guessing across many IPs with the account-wide limit", async () => {
    for (let i = 0; i < 20; i++) await recordFailure(throttleKeys("login", "owner@test.local", { ip: `198.51.100.${i}` }), minutes(i % 10));
    expect(await lockedMinutes(throttleKeys("login", "owner@test.local", { ip: "203.0.113.9" }), minutes(10))).not.toBeNull();
  });

  it("starts a fresh window when failures are spread out", async () => {
    const keys = throttleKeys("login", "a@test.local", { ip: "203.0.113.9" });
    for (let i = 0; i < 4; i++) await recordFailure(keys, minutes(i));
    await recordFailure(keys, minutes(30));
    expect(await lockedMinutes(keys, minutes(31))).toBeNull();
  });

  it("clears the account counters on success", async () => {
    const keys = throttleKeys("approve", "m@test.local", { userId: "u1" });
    for (let i = 0; i < 4; i++) await recordFailure(keys, minutes(i));
    await recordSuccess(keys);
    await recordFailure(keys, minutes(5));
    expect(await lockedMinutes(keys, minutes(6))).toBeNull();
  });
});

describe("sign-in lockout", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("refuses even the right password from the locked source, and an owner's password reset lifts it", async () => {
    const user = await db.user.create({ data: { name: "Cashier", email: "cashier@test.local", passwordHash: await bcrypt.hash("right", 4), role: "OWNER" } });
    for (let i = 0; i < 5; i++) expect(await verifyCredentials({ email: "cashier@test.local", password: "wrong" }, "10.0.0.1")).toBeNull();
    await expect(verifyCredentials({ email: "cashier@test.local", password: "right" }, "10.0.0.1")).rejects.toThrow(/Too many/);
    expect(await verifyCredentials({ email: "cashier@test.local", password: "right" }, "10.0.0.2")).toMatchObject({ id: user.id });

    // 10.0.0.1 is still locked; an owner's reset lifts it.
    const owner = await makeUser("OWNER", null);
    await resetUserPassword(ctxFor(owner, null), { id: user.id, password: "Brand!New2026x" });
    expect(await verifyCredentials({ email: "cashier@test.local", password: "Brand!New2026x" }, "10.0.0.1")).toMatchObject({ id: user.id });
  });
});

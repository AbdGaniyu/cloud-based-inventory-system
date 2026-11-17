import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import { SIGN_IN_STEPS } from "@/lib/validators/auth";
import { totpAt } from "@/server/auth/totp";
import { db } from "@/server/db";
import { SignInStepError, TooManyAttemptsError, ValidationError } from "@/server/errors";
import {
  beginTwoFactorSetup,
  changeOwnPassword,
  confirmTwoFactorSetup,
  disableTwoFactor,
  ownerTwoFactorRequired,
  pendingStep,
  regenerateRecoveryCodes,
  signOutOtherSessions,
} from "@/server/services/account.service";
import { createUser, resetUserPassword, resetUserTwoFactor, updateUser } from "@/server/services/admin.service";
import { verifyCredentials } from "@/server/services/auth.service";
import { ctxFor, makeBranch, makeUser, resetDatabase } from "@/test/db";

const T0 = new Date("2026-11-17T10:00:00Z");
const seconds = (n: number) => new Date(T0.getTime() + n * 1000);
const PASSWORD = "Correct!Horse42";

async function person(role: "OWNER" | "CASHIER" = "OWNER") {
  const branch = role === "OWNER" ? null : await makeBranch();
  const user = await db.user.create({
    data: { name: "Ada", email: `ada-${Math.random().toString(36).slice(2)}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), role, branchId: branch?.id ?? null },
  });
  return { user, actor: { userId: user.id, branchId: user.branchId } };
}

/** Enrols at T0 and returns the base32 secret and the recovery codes. */
async function enrol(actor: { userId: string; branchId: string | null }) {
  const { secret } = await beginTwoFactorSetup(actor);
  const plain = secret.replace(/\s/g, "");
  const { recoveryCodes } = await confirmTwoFactorSetup(actor, totpAt(plain, T0), T0);
  return { secret: plain, recoveryCodes };
}

const signIn = (email: string, code?: string, at = seconds(30), password = PASSWORD) => verifyCredentials({ email, password, code }, "203.0.113.5", at);

describe("pending security steps", () => {
  it("requires a password change first, then two-factor for owners only where enforced", () => {
    const prod = { NODE_ENV: "production" };
    expect(pendingStep({ mustChangePassword: true, role: "CASHIER", totpEnabledAt: null }, prod)).toBe("password");
    expect(pendingStep({ mustChangePassword: false, role: "OWNER", totpEnabledAt: null }, prod)).toBe("two-factor");
    expect(pendingStep({ mustChangePassword: false, role: "OWNER", totpEnabledAt: T0 }, prod)).toBeNull();
    expect(pendingStep({ mustChangePassword: false, role: "BRANCH_MANAGER", totpEnabledAt: null }, prod)).toBeNull();
    expect(pendingStep({ mustChangePassword: false, role: "OWNER", totpEnabledAt: null }, { NODE_ENV: "development" })).toBeNull();
    expect(ownerTwoFactorRequired({ NODE_ENV: "development", REQUIRE_OWNER_2FA: "true" })).toBe(true);
    expect(ownerTwoFactorRequired({ NODE_ENV: "production", REQUIRE_OWNER_2FA: "false" })).toBe(false);
  });
});

describe("two-factor sign-in", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("asks for a code after the right password, accepts a fresh code once, and refuses replays", async () => {
    const { user, actor } = await person();
    const { secret } = await enrol(actor);

    await expect(signIn(user.email)).rejects.toThrow(new SignInStepError(SIGN_IN_STEPS.required));
    await expect(signIn(user.email, "000000")).rejects.toThrow(SIGN_IN_STEPS.invalid);
    // The code used to confirm enrolment cannot sign in again.
    await expect(signIn(user.email, totpAt(secret, T0))).rejects.toThrow(SIGN_IN_STEPS.invalid);

    const code = totpAt(secret, seconds(30));
    expect(await signIn(user.email, code)).toMatchObject({ id: user.id, sessionVersion: 1 });
    await expect(signIn(user.email, code)).rejects.toThrow(SIGN_IN_STEPS.invalid);
    expect(await db.auditLog.findFirst({ where: { action: "auth.login" } })).toMatchObject({ after: { secondFactor: "totp" } });
    // A wrong password still says nothing about the second factor.
    expect(await signIn(user.email, code, seconds(60), "wrong")).toBeNull();
  });

  it("accepts each recovery code once, and new codes replace the old ones", async () => {
    const { user, actor } = await person();
    const { recoveryCodes } = await enrol(actor);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);

    expect(await signIn(user.email, recoveryCodes[0].toUpperCase())).toMatchObject({ id: user.id });
    await expect(signIn(user.email, recoveryCodes[0])).rejects.toThrow(SIGN_IN_STEPS.invalid);

    await expect(regenerateRecoveryCodes(actor, "wrong")).rejects.toThrow(ValidationError);
    const fresh = await regenerateRecoveryCodes(actor, PASSWORD);
    await expect(signIn(user.email, recoveryCodes[1])).rejects.toThrow(SIGN_IN_STEPS.invalid);
    expect(await signIn(user.email, fresh[0])).toMatchObject({ id: user.id });
  });

  it("counts wrong codes towards the sign-in lockout", async () => {
    const { user, actor } = await person();
    const { secret } = await enrol(actor);
    for (let i = 0; i < 5; i++) await expect(signIn(user.email, "111111")).rejects.toThrow(SIGN_IN_STEPS.invalid);
    await expect(signIn(user.email, totpAt(secret, seconds(30)))).rejects.toThrow(TooManyAttemptsError);
  });

  it("stores the secret encrypted and turns off only with the password", async () => {
    const { user, actor } = await person();
    const { secret } = await enrol(actor);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(JSON.stringify(row.totpSecret)).not.toContain(secret);

    await expect(disableTwoFactor(actor, "wrong")).rejects.toThrow(ValidationError);
    expect(await disableTwoFactor(actor, PASSWORD)).toBe(2);
    expect(await db.recoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect(await signIn(user.email)).toMatchObject({ id: user.id });
  });
});

describe("sessions and temporary passwords", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("makes people the owner creates or resets choose their own password, signing them out everywhere", async () => {
    const owner = await makeUser("OWNER", null);
    const branch = await makeBranch();
    const { id } = await createUser(ctxFor(owner), { name: "Bola", email: "bola@test.local", role: "CASHIER", branchId: branch.id, password: "Temporary!2026" });
    expect(await db.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ mustChangePassword: true, sessionVersion: 0 });

    const actor = { userId: id, branchId: branch.id };
    await expect(changeOwnPassword(actor, { currentPassword: "nope", newPassword: "Bola!Own2026x", confirmPassword: "Bola!Own2026x" })).rejects.toThrow(ValidationError);
    expect(await changeOwnPassword(actor, { currentPassword: "Temporary!2026", newPassword: "Bola!Own2026x", confirmPassword: "Bola!Own2026x" })).toBe(1);
    expect(await db.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ mustChangePassword: false, sessionVersion: 1 });

    await resetUserPassword(ctxFor(owner), { id, password: "Another!Temp2026" });
    expect(await db.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ mustChangePassword: true, sessionVersion: 2 });
  });

  it("signs a person out when their role, branch or status changes, but not for a name change", async () => {
    const owner = await makeUser("OWNER", null);
    const branch = await makeBranch();
    const cashier = await makeUser("CASHIER", branch.id);
    const base = { id: cashier.id, name: "Renamed", role: "CASHIER" as const, branchId: branch.id, isActive: true };
    await updateUser(ctxFor(owner), base);
    expect((await db.user.findUniqueOrThrow({ where: { id: cashier.id } })).sessionVersion).toBe(0);
    await updateUser(ctxFor(owner), { ...base, role: "BRANCH_MANAGER" });
    expect((await db.user.findUniqueOrThrow({ where: { id: cashier.id } })).sessionVersion).toBe(1);
    expect(await signOutOtherSessions({ userId: cashier.id, branchId: branch.id })).toBe(2);
  });

  it("lets an owner reset someone else's lost two-factor, not their own", async () => {
    const owner = await makeUser("OWNER", null);
    const { user, actor } = await person("CASHIER");
    await enrol(actor);
    await expect(resetUserTwoFactor(ctxFor(owner), { id: owner.id })).rejects.toThrow(ValidationError);
    await resetUserTwoFactor(ctxFor(owner), { id: user.id });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ totpEnabledAt: null, totpSecret: null, sessionVersion: 2 });
    expect(await signIn(user.email)).toMatchObject({ id: user.id });
    await expect(resetUserTwoFactor(ctxFor(await makeUser("CASHIER", user.branchId)), { id: user.id })).rejects.toThrow();
  });
});

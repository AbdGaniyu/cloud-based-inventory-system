import "server-only";

import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import QRCode from "qrcode";

import { STORE } from "@/config/store";
import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import type { ChangePasswordInput } from "@/lib/validators/account";
import { generateTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from "@/server/auth/totp";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, TooManyAttemptsError, ValidationError } from "@/server/errors";
import { decryptSecret, encryptedValueSchema, encryptSecret } from "@/server/secrets";
import { BCRYPT_COST } from "@/server/services/admin.service";
import { writeAudit } from "@/server/services/audit.service";
import { lockedMinutes, recordFailure, recordSuccess, throttleKeys } from "@/server/services/throttle.service";

/**
 * The signed-in person's own account security: their password, two-factor sign-in, recovery codes
 * and sessions. Every change that should end other sessions bumps User.sessionVersion; the caller
 * re-issues the current session cookie with the returned version so this device stays signed in.
 */

export type AccountActor = { userId: string; branchId: string | null };
export type PendingStep = "password" | "two-factor" | null;

export const RECOVERY_CODE_COUNT = 10;

/** Owners must use two-factor in production; REQUIRE_OWNER_2FA=true|false overrides either way. */
export function ownerTwoFactorRequired(env: Record<string, string | undefined> = process.env): boolean {
  if (env.REQUIRE_OWNER_2FA === "true") return true;
  if (env.REQUIRE_OWNER_2FA === "false") return false;
  return env.NODE_ENV === "production";
}

/** What the person must do before they can use the app: pick their own password, then (owners) set up 2FA. */
export function pendingStep(user: { mustChangePassword: boolean; role: Role; totpEnabledAt: Date | null }, env: Record<string, string | undefined> = process.env): PendingStep {
  if (user.mustChangePassword) return "password";
  if (user.role === "OWNER" && !user.totpEnabledAt && ownerTwoFactorRequired(env)) return "two-factor";
  return null;
}

export type AccountSecurity = {
  name: string;
  email: string;
  role: Role;
  pending: PendingStep;
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  recoveryCodesLeft: number;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
};

export async function getAccountSecurity(actor: AccountActor): Promise<AccountSecurity> {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { name: true, email: true, role: true, mustChangePassword: true, totpEnabledAt: true, passwordChangedAt: true, lastLoginAt: true, _count: { select: { recoveryCodes: { where: { usedAt: null } } } } },
  });
  if (!user) throw new NotFoundError("That account no longer exists.");
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    pending: pendingStep(user),
    twoFactorEnabled: user.totpEnabledAt !== null,
    twoFactorRequired: user.role === "OWNER" && ownerTwoFactorRequired(),
    recoveryCodesLeft: user._count.recoveryCodes,
    passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

/** Re-checks the person's password before a sensitive change, with the same lockout as sign-in. */
async function confirmPassword(userId: string, password: string): Promise<{ email: string; passwordHash: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, passwordHash: true } });
  if (!user) throw new NotFoundError("That account no longer exists.");
  const keys = throttleKeys("reauth", user.email, { userId });
  const locked = await lockedMinutes(keys);
  if (locked !== null) throw new TooManyAttemptsError(locked, "password attempts");
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await recordFailure(keys);
    throw new ValidationError("That isn't your current password.", { currentPassword: ["Incorrect password"], password: ["Incorrect password"] });
  }
  await recordSuccess(keys);
  return user;
}

const bump = { sessionVersion: { increment: 1 } } satisfies Prisma.UserUpdateInput;

/** Changes the person's own password and signs out their other devices. Returns the new session version. */
export async function changeOwnPassword(actor: AccountActor, input: ChangePasswordInput): Promise<number> {
  await confirmPassword(actor.userId, input.currentPassword);
  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  return db.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: actor.userId },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), ...bump },
      select: { sessionVersion: true },
    });
    await writeAudit(tx, { userId: actor.userId, branchId: actor.branchId, action: "auth.changePassword", entityType: "User", entityId: actor.userId, after: { otherSessionsSignedOut: true } });
    return user.sessionVersion;
  });
}

export type TwoFactorEnrolment = { secret: string; uri: string; qrSvg: string };

/** Starts (or restarts) enrolment: a fresh secret, stored encrypted but not active until a code confirms it. */
export async function beginTwoFactorSetup(actor: AccountActor): Promise<TwoFactorEnrolment> {
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { email: true, totpEnabledAt: true } });
  if (!user) throw new NotFoundError("That account no longer exists.");
  if (user.totpEnabledAt) throw new ConflictError("Two-factor sign-in is already on. Turn it off first to move it to a new phone.");
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: actor.userId }, data: { totpSecret: encryptSecret(secret), totpLastStep: null } });
  const uri = otpauthUri({ secret, account: user.email, issuer: STORE.name });
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  return { secret: secret.replace(/(.{4})/g, "$1 ").trim(), uri, qrSvg };
}

function readSecret(stored: Prisma.JsonValue | null): string | null {
  const parsed = encryptedValueSchema.safeParse(stored);
  return parsed.success ? decryptSecret(parsed.data) : null;
}

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Ten random codes like "k7m2q-x9p4t" (lowercase letters and digits, ~50 bits each). */
function newRecoveryCodes(): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(10);
    const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

async function replaceRecoveryCodes(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await tx.recoveryCode.deleteMany({ where: { userId } });
  await tx.recoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code.replace("-", "")) })) });
  return codes;
}

/** Confirms enrolment with a code from the app; turns 2FA on, signs out other devices and returns the recovery codes (shown once). */
export async function confirmTwoFactorSetup(actor: AccountActor, code: string, now: Date = new Date()): Promise<{ recoveryCodes: string[]; sessionVersion: number }> {
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { email: true, totpSecret: true, totpEnabledAt: true } });
  if (!user) throw new NotFoundError("That account no longer exists.");
  if (user.totpEnabledAt) throw new ConflictError("Two-factor sign-in is already on.");
  const secret = readSecret(user.totpSecret);
  if (!secret) throw new ConflictError("Start the set-up again: the QR code has expired.");
  const keys = throttleKeys("reauth", user.email, { userId: actor.userId });
  const locked = await lockedMinutes(keys);
  if (locked !== null) throw new TooManyAttemptsError(locked, "code attempts");
  const step = verifyTotp(secret, code, now);
  if (step === null) {
    await recordFailure(keys);
    throw new ValidationError("That code didn't match. Check the phone's clock is set automatically, then try the newest code.", { code: ["Code didn't match"] });
  }
  await recordSuccess(keys);
  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: actor.userId }, data: { totpEnabledAt: now, totpLastStep: step, ...bump }, select: { sessionVersion: true } });
    const recoveryCodes = await replaceRecoveryCodes(tx, actor.userId);
    await writeAudit(tx, { userId: actor.userId, branchId: actor.branchId, action: "auth.twoFactor.enable", entityType: "User", entityId: actor.userId, after: { twoFactor: true, recoveryCodes: RECOVERY_CODE_COUNT } });
    return { recoveryCodes, sessionVersion: updated.sessionVersion };
  });
}

/** New recovery codes after a password check; the old ones stop working. */
export async function regenerateRecoveryCodes(actor: AccountActor, password: string): Promise<string[]> {
  await confirmPassword(actor.userId, password);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { totpEnabledAt: true } });
    if (!user.totpEnabledAt) throw new ConflictError("Turn on two-factor sign-in first.");
    const codes = await replaceRecoveryCodes(tx, actor.userId);
    await writeAudit(tx, { userId: actor.userId, branchId: actor.branchId, action: "auth.recoveryCodes.regenerate", entityType: "User", entityId: actor.userId });
    return codes;
  });
}

/** Turns 2FA off after a password check (owners for whom it is required are asked to set it up again). */
export async function disableTwoFactor(actor: AccountActor, password: string): Promise<number> {
  await confirmPassword(actor.userId, password);
  return db.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: actor.userId }, data: { totpSecret: Prisma.DbNull, totpEnabledAt: null, totpLastStep: null, ...bump }, select: { sessionVersion: true } });
    await tx.recoveryCode.deleteMany({ where: { userId: actor.userId } });
    await writeAudit(tx, { userId: actor.userId, branchId: actor.branchId, action: "auth.twoFactor.disable", entityType: "User", entityId: actor.userId, after: { twoFactor: false } });
    return user.sessionVersion;
  });
}

/** Signs out every other device (this one is re-issued by the caller). */
export async function signOutOtherSessions(actor: AccountActor): Promise<number> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: actor.userId }, data: bump, select: { sessionVersion: true } });
    await writeAudit(tx, { userId: actor.userId, branchId: actor.branchId, action: "auth.signOutOthers", entityType: "User", entityId: actor.userId });
    return user.sessionVersion;
  });
}

/**
 * Sign-in's second factor: a current authenticator code (each 30-second code works once) or an unused
 * recovery code (then spent). Returns which one was used, or null.
 */
export async function checkSecondFactor(user: { id: string; totpSecret: Prisma.JsonValue | null; totpLastStep: number | null }, code: string, now: Date = new Date()): Promise<"totp" | "recovery" | null> {
  const digits = code.replace(/\s/g, "");
  if (/^\d{6}$/.test(digits)) {
    const secret = readSecret(user.totpSecret);
    if (!secret) return null;
    const step = verifyTotp(secret, digits, now, user.totpLastStep);
    if (step === null) return null;
    // Conditional update: two sign-ins racing with the same code cannot both win.
    const claimed = await db.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return claimed.count === 1 ? "totp" : null;
  }
  const recovery = normalizeRecoveryCode(code);
  if (!recovery) return null;
  const spent = await db.recoveryCode.updateMany({ where: { userId: user.id, codeHash: hashRecoveryCode(recovery), usedAt: null }, data: { usedAt: now } });
  return spent.count === 1 ? "recovery" : null;
}

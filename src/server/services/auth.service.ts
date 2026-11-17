import "server-only";

import bcrypt from "bcryptjs";

import type { Role } from "@/generated/prisma/enums";
import type { LoginInput } from "@/lib/validators/auth";
import { db } from "@/server/db";
import { SIGN_IN_STEPS } from "@/lib/validators/auth";
import { SignInStepError, TooManyAttemptsError } from "@/server/errors";
import { checkSecondFactor } from "@/server/services/account.service";
import { writeAudit } from "@/server/services/audit.service";
import { lockedMinutes, recordFailure, recordSuccess, throttleKeys } from "@/server/services/throttle.service";

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
  /** Copied into the session token; a later bump signs this session out. */
  sessionVersion: number;
};

// Compared against when the email is unknown, so a miss costs the same time as a wrong password.
const DUMMY_HASH = "$2b$12$AgLMM3SvlT3/jdoYhVLyH.BwjV8s6tV0w1EE5Y2wls8ZjdUk5xDMG";

/** Email + password check with no side effects (also used for manager approval at the POS). */
export async function checkCredentials(input: LoginInput): Promise<AuthenticatedUser | null> {
  const user = await findByCredentials(input);
  return user ? { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, sessionVersion: user.sessionVersion } : null;
}

async function findByCredentials(input: LoginInput) {
  const user = await db.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      branchId: true,
      isActive: true,
      passwordHash: true,
      sessionVersion: true,
      totpSecret: true,
      totpEnabledAt: true,
      totpLastStep: true,
      branch: { select: { isActive: true } },
    },
  });

  const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.isActive) return null;
  // Staff of a deactivated branch cannot sign in; owners have no branch.
  if (user.branch && !user.branch.isActive) return null;
  return user;
}

type CheckedUser = NonNullable<Awaited<ReturnType<typeof findByCredentials>>>;

/**
 * Sign-in: password, then (when the account has it on) the authenticator or a recovery code, then
 * records the login. A wrong password returns null without saying which part was wrong; a right
 * password with no code asks for one; a wrong code counts towards the same lockout as passwords.
 */
export async function verifyCredentials(input: LoginInput, ip?: string | null, now: Date = new Date()): Promise<AuthenticatedUser | null> {
  const keys = throttleKeys("login", input.email, { ip });
  const locked = await lockedMinutes(keys);
  if (locked !== null) throw new TooManyAttemptsError(locked);

  const user: CheckedUser | null = await findByCredentials(input);
  if (!user) {
    await recordFailure(keys);
    return null;
  }
  let secondFactor: "totp" | "recovery" | null = null;
  if (user.totpEnabledAt) {
    if (!input.code) throw new SignInStepError(SIGN_IN_STEPS.required);
    secondFactor = await checkSecondFactor(user, input.code, now);
    if (!secondFactor) {
      await recordFailure(keys);
      throw new SignInStepError(SIGN_IN_STEPS.invalid);
    }
  }
  await recordSuccess(keys);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit(tx, {
      userId: user.id,
      branchId: user.branchId,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      after: secondFactor ? { secondFactor } : undefined,
      ip: ip ?? null,
    });
  });

  return { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, sessionVersion: user.sessionVersion };
}

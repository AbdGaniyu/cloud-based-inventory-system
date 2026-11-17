import "server-only";

import bcrypt from "bcryptjs";

import type { Role } from "@/generated/prisma/enums";
import type { LoginInput } from "@/lib/validators/auth";
import { db } from "@/server/db";
import { TooManyAttemptsError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import { lockedMinutes, recordFailure, recordSuccess, throttleKeys } from "@/server/services/throttle.service";

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
};

// Compared against when the email is unknown, so a miss costs the same time as a wrong password.
const DUMMY_HASH = "$2b$12$AgLMM3SvlT3/jdoYhVLyH.BwjV8s6tV0w1EE5Y2wls8ZjdUk5xDMG";

/** Email + password check with no side effects (also used for manager approval at the POS). */
export async function checkCredentials(input: LoginInput): Promise<AuthenticatedUser | null> {
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
      branch: { select: { isActive: true } },
    },
  });

  const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.isActive) return null;
  // Staff of a deactivated branch cannot sign in; owners have no branch.
  if (user.branch && !user.branch.isActive) return null;
  return user;
}

/** Sign-in: checks credentials, then records the login. Returns null without saying which part was wrong. */
export async function verifyCredentials(input: LoginInput, ip?: string | null): Promise<AuthenticatedUser | null> {
  const keys = throttleKeys("login", input.email, { ip });
  const locked = await lockedMinutes(keys);
  if (locked !== null) throw new TooManyAttemptsError(locked);

  const user = await checkCredentials(input);
  if (!user) {
    await recordFailure(keys);
    return null;
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
      ip: ip ?? null,
    });
  });

  return { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId };
}

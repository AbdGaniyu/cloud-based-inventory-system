import "dotenv/config";

import { Prisma } from "@/generated/prisma/client";
import { createPrismaClient } from "@/server/db";
import { writeAudit } from "@/server/services/audit.service";

/**
 * Last resort for someone locked out of two-factor with no recovery codes left and no other owner
 * to reset it in Settings → Users (for example the only owner lost their phone). Needs direct
 * access to the server's environment, so it is not something an attacker on the website can reach.
 *
 *   pnpm user:reset-2fa owner@example.com
 *
 * Turns two-factor off, deletes the recovery codes, signs the person out everywhere and writes an
 * audit row. An owner is asked to set two-factor up again at their next sign-in.
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: pnpm user:reset-2fa <email>");
  const db = createPrismaClient();
  try {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, branchId: true, totpEnabledAt: true } });
    if (!user) throw new Error(`No user with email ${email}`);
    if (!user.totpEnabledAt) {
      console.info(`${email} does not have two-factor on; nothing to do.`);
      return;
    }
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { totpSecret: Prisma.DbNull, totpEnabledAt: null, totpLastStep: null, sessionVersion: { increment: 1 } } });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await writeAudit(tx, { userId: null, branchId: user.branchId, action: "user.resetTwoFactor", entityType: "User", entityId: user.id, after: { twoFactor: false, via: "command line" } });
    });
    console.info(`Two-factor reset for ${email}. They are signed out everywhere and can sign in with their password.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

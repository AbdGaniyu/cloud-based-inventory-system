import "dotenv/config";

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";

import { createPrismaClient } from "@/server/db";
import { writeAudit } from "@/server/services/audit.service";
import { throttleKeysForAccount } from "@/server/services/throttle.service";

/**
 * Last resort for someone who forgot their password when no other owner can reset it in
 * Settings → Users (for example the only owner). Needs direct access to the server's environment,
 * so it is not something an attacker on the website can reach.
 *
 *   pnpm user:reset-password owner@example.com
 *
 * Sets a one-time password, printed once, which must be changed at the next sign-in. Signs the
 * person out everywhere, lifts any sign-in lockout and writes an audit row. Two-factor stays on.
 */
const BCRYPT_COST = 12;

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: pnpm user:reset-password <email>");
  const db = createPrismaClient(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
  try {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, branchId: true } });
    if (!user) throw new Error(`No user with email ${email}`);
    const password = randomBytes(12).toString("base64url");
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true, sessionVersion: { increment: 1 } } });
      await tx.authThrottle.deleteMany({ where: { OR: throttleKeysForAccount(email).map((k) => ({ key: k })) } });
      await writeAudit(tx, { userId: null, branchId: user.branchId, action: "user.resetPassword", entityType: "User", entityId: user.id, after: { passwordChanged: true, signedOutEverywhere: true, via: "command line" } });
    });
    console.info(`Password reset for ${email}\nOne-time password (shown once): ${password}\nSign in and choose your own password.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

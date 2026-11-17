import "dotenv/config";

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";

import { createPrismaClient } from "@/server/db";
import { writeAudit } from "@/server/services/audit.service";

/**
 * First sign-in for a real (unseeded) store: creates the first owner with a one-time password,
 * printed once. They must choose their own password at first sign-in, then set up two-factor
 * (required for owners in production). Refuses if an owner already exists.
 *
 *   pnpm user:create-owner "Lee Okafor" owner@leeplugshub.com
 */
const BCRYPT_COST = 12;

async function main(): Promise<void> {
  const [name, rawEmail] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  if (!name?.trim() || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: pnpm user:create-owner "Full Name" email@example.com');
  const db = createPrismaClient(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
  try {
    if (await db.user.count({ where: { role: "OWNER" } })) throw new Error("An owner already exists. Add more users in Settings → Users and roles.");
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new Error(`${email} is already a user.`);
    const password = randomBytes(12).toString("base64url");
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: name.trim(), email, role: "OWNER", branchId: null, passwordHash: await bcrypt.hash(password, BCRYPT_COST), mustChangePassword: true },
        select: { id: true },
      });
      await writeAudit(tx, { userId: null, branchId: null, action: "user.create", entityType: "User", entityId: user.id, after: { name: name.trim(), email, role: "OWNER", via: "command line" } });
    });
    console.info(`Owner created: ${email}\nOne-time password (shown once): ${password}\nSign in, choose your own password, then set up two-factor.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

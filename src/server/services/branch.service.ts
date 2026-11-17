import "server-only";

import type { BranchType } from "@/generated/prisma/enums";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";

export type BranchOption = {
  id: string;
  name: string;
  code: string;
  type: BranchType;
  /** Position in the global branch order; picks the branch identity colour (DESIGN.md §2.3a). */
  colorIndex: number;
  /** Two-letter rail label, e.g. IKJ → IK, LEK → LK. */
  shortLabel: string;
};

const VOWELS = new Set(["A", "E", "I", "O", "U"]);

/** Initial plus the next consonant of the code; codes without one use their first two letters. */
export function branchShortLabel(code: string): string {
  const upper = code.toUpperCase();
  const consonant = [...upper.slice(1)].find((ch) => /[A-Z]/.test(ch) && !VOWELS.has(ch));
  return consonant ? `${upper[0]}${consonant}` : upper.slice(0, 2);
}

/** Branches the user can put in scope: every active branch for owners, the home branch otherwise. */
export async function listScopeBranches(ctx: Ctx): Promise<BranchOption[]> {
  // Colour index comes from the global order so a branch looks the same to everyone.
  const all = await db.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true, type: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const options = all.map((b, colorIndex) => ({ ...b, colorIndex, shortLabel: branchShortLabel(b.code) }));
  return ctx.role === "OWNER" ? options : options.filter((b) => b.id === ctx.branchId);
}

/** Validates an owner's branch-switch target. */
export async function assertSwitchableBranch(ctx: Ctx, branchId: string): Promise<void> {
  assertCan(ctx, "branch.viewAll");
  const branch = await db.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } });
  if (!branch) throw new NotFoundError("That branch is not available.");
}

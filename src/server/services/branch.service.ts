import "server-only";

import type { BranchType } from "@/generated/prisma/enums";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";

export type BranchOption = { id: string; name: string; code: string; type: BranchType };

/** Branches the user can put in scope: every active branch for owners, the home branch otherwise. */
export async function listScopeBranches(ctx: Ctx): Promise<BranchOption[]> {
  return db.branch.findMany({
    where: ctx.role === "OWNER" ? { isActive: true } : { id: ctx.branchId ?? "" },
    select: { id: true, name: true, code: true, type: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

/** Validates an owner's branch-switch target. */
export async function assertSwitchableBranch(ctx: Ctx, branchId: string): Promise<void> {
  assertCan(ctx, "branch.viewAll");
  const branch = await db.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } });
  if (!branch) throw new NotFoundError("That branch is not available.");
}

import type { Role } from "@/generated/prisma/enums";
import type { Ctx } from "@/server/auth/permissions";
import { ForbiddenError, ValidationError } from "@/server/errors";

/**
 * Branch scope rules (invariant 8). Pure functions: the session layer feeds them the user, the
 * cookie and the list of active branches; services use them to scope queries and pick the branch
 * a write happens at. A branchId sent by a non-owner client is never trusted.
 */

export const ACTIVE_BRANCH_COOKIE = "gh_active_branch";
/** Cookie value meaning "All branches" (OWNER only). */
export const ALL_BRANCHES = "ALL";

/** Which branch the user is looking at. Null means all branches. */
export function resolveActiveBranchId(
  user: { role: Role; branchId: string | null },
  cookieValue: string | undefined,
  activeBranchIds: readonly string[],
): string | null {
  if (user.role !== "OWNER") return user.branchId;
  if (cookieValue && cookieValue !== ALL_BRANCHES && activeBranchIds.includes(cookieValue)) {
    return cookieValue;
  }
  return null;
}

/** Prisma `where` fragment restricting a branch-owned model to the active scope. */
export function branchScope(ctx: Ctx): { branchId?: string } {
  return ctx.activeBranchId === null ? {} : { branchId: ctx.activeBranchId };
}

/** Throws unless the user may act on records of `branchId`. Owners may act on every branch. */
export function assertBranchAccess(ctx: Ctx, branchId: string): void {
  if (ctx.role === "OWNER") return;
  if (ctx.branchId !== branchId) throw new ForbiddenError("That record belongs to another branch.");
}

/**
 * The branch a write happens at (checkout, intake, payment collection ...). Non-owners always act
 * at their own branch, whatever the client sent. Owners act at the requested branch, falling back
 * to the active one; in "All branches" view they must choose.
 */
export function resolveWriteBranchId(ctx: Ctx, requestedBranchId?: string | null): string {
  if (ctx.role !== "OWNER") {
    if (!ctx.branchId) throw new ForbiddenError("Your account is not assigned to a branch.");
    return ctx.branchId;
  }
  const branchId = requestedBranchId ?? ctx.activeBranchId;
  if (!branchId) throw new ValidationError("Choose a branch first — you are viewing all branches.");
  return branchId;
}

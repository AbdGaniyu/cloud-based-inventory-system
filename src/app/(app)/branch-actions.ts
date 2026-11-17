"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { type ActionResult, runAction } from "@/server/action-result";
import { assertCan } from "@/server/auth/permissions";
import { requireActionSession } from "@/server/auth/session";
import { ACTIVE_BRANCH_COOKIE, ALL_BRANCHES } from "@/server/branch-context";
import { ValidationError } from "@/server/errors";
import { assertSwitchableBranch } from "@/server/services/branch.service";

const setActiveBranchSchema = z.object({
  branchId: z.union([z.literal(ALL_BRANCHES), z.guid()]),
});

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Owner-only: switch the branch scope (a specific branch, or "ALL"). */
export async function setActiveBranch(input: unknown): Promise<ActionResult<{ branchId: string }>> {
  return runAction(async () => {
    const parsed = setActiveBranchSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Choose a valid branch.");
    const ctx = await requireActionSession();
    assertCan(ctx, "branch.viewAll");
    const { branchId } = parsed.data;
    if (branchId !== ALL_BRANCHES) await assertSwitchableBranch(ctx, branchId);

    (await cookies()).set(ACTIVE_BRANCH_COOKIE, branchId, {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.APP_URL ?? "").startsWith("https://"),
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
    revalidatePath("/", "layout");
    return { branchId };
  });
}

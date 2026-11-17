import { describe, expect, it } from "vitest";

import type { Ctx } from "@/server/auth/permissions";
import {
  ALL_BRANCHES,
  assertBranchAccess,
  branchScope,
  resolveActiveBranchId,
  resolveWriteBranchId,
} from "@/server/branch-context";
import { ForbiddenError, ValidationError } from "@/server/errors";

const IKJ = "branch-ikj";
const LEK = "branch-lek";
const active = [IKJ, LEK];

describe("resolveActiveBranchId", () => {
  it("pins non-owners to their home branch whatever the cookie says", () => {
    expect(resolveActiveBranchId({ role: "CASHIER", branchId: IKJ }, LEK, active)).toBe(IKJ);
    expect(resolveActiveBranchId({ role: "BRANCH_MANAGER", branchId: IKJ }, ALL_BRANCHES, active)).toBe(IKJ);
  });

  it("lets owners pick a branch or all branches", () => {
    const owner = { role: "OWNER" as const, branchId: null };
    expect(resolveActiveBranchId(owner, LEK, active)).toBe(LEK);
    expect(resolveActiveBranchId(owner, ALL_BRANCHES, active)).toBeNull();
    expect(resolveActiveBranchId(owner, undefined, active)).toBeNull();
  });

  it("falls back to all branches when the owner's cookie names an unknown or inactive branch", () => {
    expect(resolveActiveBranchId({ role: "OWNER", branchId: null }, "deleted-branch", active)).toBeNull();
  });
});

describe("branch scope helpers", () => {
  const owner: Ctx = { userId: "o", role: "OWNER", branchId: null, activeBranchId: null };
  const ownerAtLek: Ctx = { ...owner, activeBranchId: LEK };
  const cashier: Ctx = { userId: "c", role: "CASHIER", branchId: IKJ, activeBranchId: IKJ };

  it("builds query scopes", () => {
    expect(branchScope(owner)).toEqual({});
    expect(branchScope(ownerAtLek)).toEqual({ branchId: LEK });
    expect(branchScope(cashier)).toEqual({ branchId: IKJ });
  });

  it("blocks non-owners from other branches' records", () => {
    expect(() => assertBranchAccess(cashier, LEK)).toThrow(ForbiddenError);
    expect(() => assertBranchAccess(cashier, IKJ)).not.toThrow();
    expect(() => assertBranchAccess(owner, LEK)).not.toThrow();
  });

  it("ignores a client-sent branch for non-owners", () => {
    expect(resolveWriteBranchId(cashier, LEK)).toBe(IKJ);
  });

  it("uses the owner's requested or active branch, and requires one in all-branches view", () => {
    expect(resolveWriteBranchId(owner, LEK)).toBe(LEK);
    expect(resolveWriteBranchId(ownerAtLek)).toBe(LEK);
    expect(() => resolveWriteBranchId(owner)).toThrow(ValidationError);
  });
});

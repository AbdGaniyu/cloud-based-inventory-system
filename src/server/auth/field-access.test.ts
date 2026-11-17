import { describe, expect, it } from "vitest";

import { stripCostFields } from "@/server/auth/field-access";
import type { Ctx } from "@/server/auth/permissions";

const owner: Ctx = { userId: "o", role: "OWNER", branchId: null, activeBranchId: null };
const manager: Ctx = { userId: "m", role: "BRANCH_MANAGER", branchId: "b1", activeBranchId: "b1" };
const cashier: Ctx = { userId: "c", role: "CASHIER", branchId: "b1", activeBranchId: "b1" };

describe("role-based field stripping (invariant 9)", () => {
  const unit = { id: "u1", sellingPrice: "1350000.00", costPrice: "1150000.00", supplierName: "Apex" };

  it("keeps cost fields for the owner", () => {
    expect(stripCostFields(owner, unit, ["costPrice", "supplierName"])).toEqual(unit);
  });

  it.each([
    ["manager", manager],
    ["cashier", cashier],
  ])("removes the keys entirely for a %s, not just blanks them", (_, ctx) => {
    const visible = stripCostFields(ctx, unit, ["costPrice", "supplierName"]);
    expect(visible).toEqual({ id: "u1", sellingPrice: "1350000.00" });
    expect("costPrice" in visible).toBe(false);
    expect(JSON.stringify(visible)).not.toContain("1150000");
  });

  it("does not mutate the input row", () => {
    stripCostFields(cashier, unit, ["costPrice"]);
    expect(unit.costPrice).toBe("1150000.00");
  });
});

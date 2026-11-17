import { describe, expect, it } from "vitest";

import { type Action, assertCan, can, type Ctx } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";

const IKJ = "branch-ikj";
const LEK = "branch-lek";

const owner: Ctx = { userId: "u-owner", role: "OWNER", branchId: null, activeBranchId: null };
const manager: Ctx = { userId: "u-mgr", role: "BRANCH_MANAGER", branchId: IKJ, activeBranchId: IKJ };
const cashier: Ctx = { userId: "u-cash", role: "CASHIER", branchId: IKJ, activeBranchId: IKJ };

describe("can() — RBAC matrix (CLAUDE.md §8)", () => {
  const everyone: Action[] = [
    "dashboard.view",
    "invoice.create",
    "customer.create",
    "payment.record",
    "message.send",
    "stock.viewSisterBranches",
  ];

  it.each(everyone)("%s is open to every role", (action) => {
    expect(can(owner, action)).toBe(true);
    expect(can(manager, action)).toBe(true);
    expect(can(cashier, action)).toBe(true);
  });

  const ownerOnly: Action[] = [
    "cost.view",
    "payables.view",
    "supplier.payout",
    "price.edit",
    "stock.adjust",
    "debt.waive",
    "user.manage",
    "branch.manage",
    "tax.manage",
    "messaging.manage",
    "branch.viewAll",
    "settings.view",
  ];

  it.each(ownerOnly)("%s is owner-only", (action) => {
    expect(can(owner, action)).toBe(true);
    expect(can(manager, action)).toBe(false);
    expect(can(cashier, action)).toBe(false);
  });

  it("lets managers approve installments and receive stock only at their own branch", () => {
    for (const action of ["installment.approve", "intake.create"] as const) {
      expect(can(manager, action, { branchId: IKJ })).toBe(true);
      expect(can(manager, action, { branchId: LEK })).toBe(false);
      expect(can(owner, action, { branchId: LEK })).toBe(true);
      expect(can(cashier, action, { branchId: IKJ })).toBe(false);
    }
  });

  it("lets managers ship from and receive into their own branch only", () => {
    expect(can(manager, "transfer.ship", { fromBranchId: IKJ })).toBe(true);
    expect(can(manager, "transfer.ship", { fromBranchId: LEK })).toBe(false);
    expect(can(manager, "transfer.receive", { toBranchId: IKJ })).toBe(true);
    expect(can(manager, "transfer.receive", { toBranchId: LEK })).toBe(false);
    expect(can(manager, "transfer.create", { fromBranchId: IKJ })).toBe(true);
    expect(can(cashier, "transfer.create", { fromBranchId: IKJ })).toBe(false);
    expect(can(cashier, "transfer.view")).toBe(false);
  });

  it("lets managers void only their own branch's invoices on the same Lagos day", () => {
    const now = new Date("2026-11-17T15:00:00Z");
    const sameDay = new Date("2026-11-16T23:30:00Z"); // 00:30 on 17 Nov in Lagos
    const yesterday = new Date("2026-11-16T22:30:00Z"); // 23:30 on 16 Nov in Lagos
    expect(can(manager, "invoice.void", { branchId: IKJ, createdAt: sameDay }, { now })).toBe(true);
    expect(can(manager, "invoice.void", { branchId: IKJ, createdAt: yesterday }, { now })).toBe(false);
    expect(can(manager, "invoice.void", { branchId: LEK, createdAt: sameDay }, { now })).toBe(false);
    expect(can(owner, "invoice.void", { branchId: LEK, createdAt: yesterday }, { now })).toBe(true);
    expect(can(cashier, "invoice.void", { branchId: IKJ, createdAt: sameDay }, { now })).toBe(false);
  });

  it("scopes the audit log to the manager's own branch", () => {
    expect(can(manager, "audit.view")).toBe(true);
    expect(can(manager, "audit.view", { branchId: IKJ })).toBe(true);
    expect(can(manager, "audit.view", { branchId: LEK })).toBe(false);
    expect(can(manager, "audit.view", { branchId: null })).toBe(false);
    expect(can(cashier, "audit.view")).toBe(false);
  });

  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan(cashier, "cost.view")).toThrow(ForbiddenError);
    expect(() => assertCan(owner, "cost.view")).not.toThrow();
  });
});

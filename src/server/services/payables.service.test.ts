import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { getSupplierProfile, listPayables, listSuppliers, recordSupplierPayout } from "@/server/services/payables.service";
import { ctxFor, makeBranch, makeSupplier, makeUser, resetDatabase } from "@/test/db";

const NOW = new Date("2026-11-20T10:00:00Z");

describe("payables ledger", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const warehouse = await makeBranch({ code: "WH", type: "WAREHOUSE" });
    const ikeja = await makeBranch({ code: "IKJ" });
    const owner = await makeUser("OWNER", null);
    const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const supplier = await makeSupplier();
    const po = async (number: string, totalCost: string, amountPaid: string, dueDate: string | null, branchId = warehouse.id) => {
      const order = await db.purchaseOrder.create({
        data: {
          number,
          supplierId: supplier.id,
          branchId,
          paymentTerms: dueDate ? "NET_30" : "PAID_IN_FULL",
          totalCost,
          amountPaid,
          status: amountPaid === "0" ? "UNPAID" : amountPaid === totalCost ? "PAID" : "PARTIALLY_PAID",
          dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
          receivedById: owner.id,
          receivedAt: new Date("2026-10-01T10:00:00Z"),
        },
      });
      // Cached totals always come from payout rows.
      if (amountPaid !== "0") {
        await db.supplierPayment.create({
          data: { purchaseOrderId: order.id, supplierId: supplier.id, amount: amountPaid, method: "CASH", paidById: owner.id, paidAt: order.receivedAt },
        });
      }
      return order;
    };
    const overdue = await po("PO-WH-000001", "3000000.00", "1000000.00", "2026-11-10");
    const dueSoon = await po("PO-WH-000002", "500000.00", "0", "2026-11-24");
    const paid = await po("PO-IKJ-000001", "200000.00", "200000.00", null, ikeja.id);
    return { owner, manager, supplier, ikeja, overdue, dueSoon, paid };
  }

  beforeEach(async () => {
    f = await setup();
  });

  it("pays a supplier against one purchase order, never more than its balance", async () => {
    const owner = ctxFor(f.owner);
    await expect(recordSupplierPayout(ctxFor(f.manager), { purchaseOrderId: f.overdue.id, amount: "1", method: "CASH" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordSupplierPayout(owner, { purchaseOrderId: f.overdue.id, amount: "2000000.01", method: "CASH" })).rejects.toBeInstanceOf(ValidationError);
    const part = await recordSupplierPayout(owner, { purchaseOrderId: f.overdue.id, amount: "500000", method: "BANK_TRANSFER", reference: "ZEN-1" }, { now: NOW });
    expect(part).toMatchObject({ balance: "1500000.00", status: "PARTIALLY_PAID" });
    const rest = await recordSupplierPayout(owner, { purchaseOrderId: f.overdue.id, amount: "1500000", method: "BANK_TRANSFER" }, { now: NOW });
    expect(rest).toMatchObject({ balance: "0.00", status: "PAID" });
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: f.overdue.id } })).amountPaid.toFixed(2)).toBe("3000000.00");
    expect(await db.auditLog.count({ where: { action: "supplier.payout" } })).toBe(2);
    await expect(recordSupplierPayout(owner, { purchaseOrderId: f.overdue.id, amount: "1", method: "CASH" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("serialises concurrent payouts on the same purchase order", async () => {
    const owner = ctxFor(f.owner);
    const results = await Promise.allSettled([
      recordSupplierPayout(owner, { purchaseOrderId: f.dueSoon.id, amount: "400000", method: "CASH" }),
      recordSupplierPayout(owner, { purchaseOrderId: f.dueSoon.id, amount: "400000", method: "CASH" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: f.dueSoon.id } })).amountPaid.toFixed(2)).toBe("400000.00");
  });

  it("summarises what is owed, due this week and overdue, and flags overdue orders", async () => {
    const list = await listPayables(ctxFor(f.owner), {}, NOW);
    expect(list.summary).toEqual({ totalOwed: "2500000.00", dueThisWeek: "500000.00", overdue: "2000000.00" });
    expect(list.counts).toEqual({ all: 3, due_soon: 1, overdue: 1, paid: 1 });
    expect(list.rows.find((r) => r.number === "PO-WH-000001")).toMatchObject({ status: "OVERDUE", dueInDays: 10, balance: "2000000.00" });
    expect((await listPayables(ctxFor(f.owner, f.ikeja.id), {}, NOW).then((l) => l.total))).toBe(1);
    await expect(listPayables(ctxFor(f.manager), {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("derives a supplier's balance from its orders and payouts", async () => {
    await recordSupplierPayout(ctxFor(f.owner), { purchaseOrderId: f.dueSoon.id, amount: "100000", method: "CASH" }, { now: NOW });
    const [row] = await listSuppliers(ctxFor(f.owner), {}, NOW);
    expect(row).toMatchObject({ balance: "2400000.00", openOrders: 2, overdue: true });
    const profile = await getSupplierProfile(ctxFor(f.owner), f.supplier.id, NOW);
    expect(profile).toMatchObject({ balance: "2400000.00", overdueBalance: "2000000.00", totalPurchased: "3700000.00" });
    expect(profile.payments[0]).toMatchObject({ purchaseOrderNumber: "PO-WH-000002", amount: "100000.00" });
  });
});

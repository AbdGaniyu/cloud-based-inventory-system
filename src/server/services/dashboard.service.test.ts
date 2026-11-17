import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { payablesAging, receivablesAging } from "@/server/services/aging.service";
import { getDashboard, periodsFor } from "@/server/services/dashboard.service";
import { checkout } from "@/server/services/invoice.service";
import { ctxFor, makeBranch, makeProduct, makeSupplier, makeUser, resetDatabase } from "@/test/db";

/** Tuesday 17 Nov 2026, 12:00 in Lagos. */
const NOW = new Date("2026-11-17T11:00:00Z");

describe("dashboard and aging", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const owner = await makeUser("OWNER", null);
    const ikjCashier = await makeUser("CASHIER", ikeja.id);
    const ikjManager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const lekCashier = await makeUser("CASHIER", lekki.id);
    const phone = await makeProduct("SERIALIZED");
    const cable = await makeProduct("NON_SERIALIZED");
    await db.product.update({ where: { id: cable.id }, data: { defaultCostPrice: "5000", defaultSellingPrice: "8000" } });
    const unit = (imei: string, branchId: string, cost: string, price: string) =>
      db.serializedUnit.create({ data: { productId: phone.id, imei, branchId, condition: "BRAND_NEW", costPrice: cost, sellingPrice: price, receivedAt: new Date("2026-11-01T10:00:00Z") } });
    const sold = await unit("490154203237518", ikeja.id, "800000", "1000000");
    const financed = await unit("356938035643809", lekki.id, "1500000", "2000000");
    await unit("353456789012344", ikeja.id, "300000", "400000");
    await db.branchInventory.create({ data: { branchId: ikeja.id, productId: cable.id, quantity: 4 } });
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });

    // Previous period (10 Nov, Lekki): 2,150,000 on instalments, 500,000 down, 3 weekly × 550,000 from 12 Nov.
    await checkout(
      ctxFor(lekCashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: financed.id }],
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "500000" }], numberOfInstallments: 3, frequency: "WEEKLY", firstDueDate: "2026-11-12" },
      },
      { now: new Date("2026-11-10T11:00:00Z") },
    );
    // Current period (17 Nov, Ikeja): 1,075,000 paid in full.
    await checkout(
      ctxFor(ikjCashier),
      { customerId: customer.id, lines: [{ kind: "unit", unitId: sold.id }], payment: { type: "FULL", payments: [{ method: "CASH", amount: "1075000" }] } },
      { now: NOW },
    );
    const supplier = await makeSupplier();
    await db.purchaseOrder.create({
      data: {
        number: "PO-IKJ-000001",
        supplierId: supplier.id,
        branchId: ikeja.id,
        paymentTerms: "NET_7",
        totalCost: "1000000",
        dueDate: new Date("2026-11-10T00:00:00Z"),
        receivedById: owner.id,
        receivedAt: new Date("2026-11-03T10:00:00Z"),
      },
    });
    return { ikeja, lekki, owner, ikjCashier, ikjManager };
  }

  beforeAll(async () => {
    f = await setup();
  });

  it("compares a period with the equally long one before it", () => {
    expect(periodsFor("7d", "2026-11-17")).toMatchObject({ current: { from: "2026-11-11", to: "2026-11-17" }, previous: { from: "2026-11-04", to: "2026-11-10" } });
    expect(periodsFor("month", "2026-11-17")).toMatchObject({ current: { from: "2026-11-01" }, previous: { from: "2026-10-15", to: "2026-10-31" } });
    expect(periodsFor("today", "2026-11-17").current.start.toISOString()).toBe("2026-11-16T23:00:00.000Z");
  });

  it("gives the owner every KPI across all branches, with changes against the previous period", async () => {
    const d = await getDashboard(ctxFor(f.owner, null), "7d", NOW);
    expect(d.kpis.invoiced).toEqual({ value: "1075000.00", previous: "2150000.00", changePercent: -50 });
    expect(d.kpis.collected).toMatchObject({ value: "1075000.00", previous: "500000.00", changePercent: 115, collectionRate: 100 });
    expect(d.kpis.netProfit).toEqual({ value: "200000.00", previous: "500000.00", changePercent: -60 });
    expect(d.kpis.receivables).toMatchObject({ value: "1650000.00", previous: "1650000.00", changePercent: 0, overdue: "550000.00" });
    expect(d.kpis.payables).toMatchObject({ value: "1000000.00", overdue: "1000000.00" });
    expect(d.kpis.inventory).toEqual({ value: "320000.00", basis: "cost", devices: 1, accessories: 4 });
    expect(d.trend).toHaveLength(7);
    expect(d.trend.at(-1)).toMatchObject({ label: "17 Nov", invoiced: "1075000.00", collected: "1075000.00" });
    expect(d.aging.buckets.d1_7).toEqual({ amount: "550000.00", count: 1 });
    expect(d.aging.buckets.not_due).toEqual({ amount: "1100000.00", count: 2 });
    expect(d.dueThisWeek).toMatchObject([{ dueDate: "2026-11-19", amount: "550000.00", sequence: 2 }]);
    expect(d.branches?.map((b) => [b.code, b.invoiced, b.receivables, b.unitsSold])).toEqual([
      ["IKJ", "1075000.00", "0.00", 1],
      ["LEK", "0.00", "1650000.00", 0],
    ]);
    expect(d.topProducts).toBeNull();
    expect(d.alerts.map((a) => a.kind)).toEqual(["OVERDUE_BILL"]);
  });

  it("strips cost figures for managers (valuation at selling price) and cashiers (none)", async () => {
    const manager = await getDashboard(ctxFor(f.ikjManager), "7d", NOW);
    expect(manager.kpis).toMatchObject({ netProfit: null, payables: null, inventory: { value: "432000.00", basis: "selling" } });
    expect(manager.kpis.receivables.value).toBe("0.00");
    expect(manager.branches).toBeNull();
    expect(manager.topProducts).toHaveLength(1);
    expect(manager.alerts).toEqual([]);
    const cashier = await getDashboard(ctxFor(f.ikjCashier), "today", NOW);
    expect(cashier.kpis.inventory).toBeNull();
    expect(cashier.trend).toHaveLength(24);
    expect(JSON.stringify(cashier)).not.toContain("800000");
  });

  it("ages receivables per instalment and payables per purchase order, with bucket filters and the next 7 days", async () => {
    const receivables = await receivablesAging(ctxFor(f.owner, null), { bucket: "d1_7", now: NOW });
    expect(receivables).toMatchObject({ total: "1650000.00", rowCount: 1, upcomingTotal: "550000.00" });
    expect(receivables.rows[0]).toMatchObject({ sequence: 1, dueDate: "2026-11-12", daysOverdue: 5, bucket: "d1_7", amount: "550000.00", branchName: f.lekki.name });
    expect(receivables.upcoming.map((r) => r.dueDate)).toEqual(["2026-11-19"]);

    const payables = await payablesAging(ctxFor(f.owner, null), { now: NOW });
    expect(payables.buckets.d1_7).toEqual({ amount: "1000000.00", count: 1 });
    expect(payables.rows[0]).toMatchObject({ number: "PO-IKJ-000001", daysOverdue: 7 });
    await expect(payablesAging(ctxFor(f.ikjManager), { now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(receivablesAging(ctxFor(f.ikjCashier), { now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await receivablesAging(ctxFor(f.ikjManager), { now: NOW })).total).toBe("0.00");
  });
});

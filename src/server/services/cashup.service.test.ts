import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { cashUpAlerts, getDrawerStatus, listCashUps, pendingDrawers, reviewCashUp, submitCashUp } from "@/server/services/cashup.service";
import { checkout } from "@/server/services/invoice.service";
import { voidInvoice } from "@/server/services/void.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

// Lagos is UTC+1: 09:00Z is 10:00 in the shop.
const at = (hhmm: string, day = "2026-11-17") => new Date(`${day}T${hhmm}:00.000Z`);

describe("cash-up", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    await db.setting.create({ data: { key: "cashup.startedAt", value: "2026-11-01T00:00:00.000Z" } });
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const lekManager = await makeUser("BRANCH_MANAGER", lekki.id);
    const owner = await makeUser("OWNER", null);
    const phone = await makeProduct("SERIALIZED");
    const charger = await makeProduct("NON_SERIALIZED");
    await db.product.update({ where: { id: charger.id }, data: { defaultSellingPrice: "15000", warrantyMonths: 0 } });
    await db.branchInventory.create({ data: { branchId: ikeja.id, productId: charger.id, quantity: 20 } });
    const unit = await db.serializedUnit.create({
      data: { productId: phone.id, imei: "490154203237518", branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "800000", sellingPrice: "1000000", receivedAt: at("08:00") },
    });
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    const sellCharger = (who: typeof cashier, method: "CASH" | "BANK_TRANSFER", when: Date) =>
      checkout(ctxFor(who), { customerId: customer.id, lines: [{ kind: "accessory", productId: charger.id, quantity: 1 }], payment: { type: "FULL", payments: [{ method, amount: "16125", reference: method === "CASH" ? undefined : "TRF" }] } }, { now: when });
    // Cashier: a phone (cash + card) and a charger by transfer; the manager voids the charger sale.
    await checkout(
      ctxFor(cashier),
      { customerId: customer.id, lines: [{ kind: "unit", unitId: unit.id }], payment: { type: "FULL", payments: [{ method: "CASH", amount: "1000000" }, { method: "POS_CARD", amount: "75000", reference: "T1" }] } },
      { now: at("09:00") },
    );
    const transferSale = await sellCharger(cashier, "BANK_TRANSFER", at("10:00"));
    await voidInvoice(ctxFor(manager), { invoiceId: transferSale.invoiceId, reason: "Keyed twice" }, { now: at("11:00") });
    return { ikeja, lekki, cashier, manager, lekManager, owner, customer, sellCharger };
  }

  beforeEach(async () => {
    f = await setup();
  });

  const count = (over: Partial<{ openingFloat: string; countedCash: string; countedCard: string; countedTransfer: string; note: string }> = {}) => ({
    openingFloat: "20000",
    countedCash: "1020000",
    countedCard: "75000",
    countedTransfer: "16125",
    ...over,
  });

  it("shows the drawer blind, then reveals expected takings by method once counted", async () => {
    const drawer = await getDrawerStatus(ctxFor(f.cashier), at("12:00"));
    expect(drawer).toEqual({ branch: { id: f.ikeja.id, name: expect.any(String) }, periodStart: "2026-11-01T00:00:00.000Z", paymentCount: 3, lastCashUpAt: null });
    expect(JSON.stringify(drawer)).not.toContain("1000000");

    const cashUp = await submitCashUp(ctxFor(f.cashier), count(), { now: at("12:00") });
    expect(cashUp).toMatchObject({
      businessDate: "2026-11-17",
      paymentCount: 3,
      expected: { cash: "1000000.00", card: "75000.00", transfer: "16125.00" },
      variance: { cash: "0.00", card: "0.00", transfer: "0.00" },
      status: "SUBMITTED",
      canReview: false,
    });
    expect(await db.auditLog.count({ where: { action: "cashup.submit" } })).toBe(1);
  });

  it("records shortfalls, and each cash-up covers only what came in since the last one", async () => {
    // Card and transfer not checked this time (blank fields arrive as undefined after validation).
    const first = await submitCashUp(ctxFor(f.cashier), { openingFloat: "20000", countedCash: "1015000" }, { now: at("12:00") });
    expect(first.variance).toEqual({ cash: "-5000.00", card: null, transfer: null });

    await f.sellCharger(f.cashier, "CASH", at("13:00"));
    const second = await submitCashUp(ctxFor(f.cashier), { openingFloat: "0", countedCash: "16125" }, { now: at("14:00") });
    expect(second).toMatchObject({ paymentCount: 1, expected: { cash: "16125.00", card: "0.00", transfer: "0.00" }, variance: { cash: "0.00" }, periodStart: at("12:00").toISOString() });

    // The manager handed back the voided transfer: it shows in their own drawer, negative.
    const managers = await submitCashUp(ctxFor(f.manager), { openingFloat: "0", countedCash: "0", countedTransfer: "0" }, { now: at("15:00") });
    expect(managers).toMatchObject({ expected: { transfer: "-16125.00" }, variance: { transfer: "16125.00" } });
  });

  it("is signed off by someone else at the branch, with a note when it didn't balance, and then frozen", async () => {
    const short = await submitCashUp(ctxFor(f.cashier), count({ countedCash: "1019000" }), { now: at("12:00") });
    const mine = await submitCashUp(ctxFor(f.manager), { openingFloat: "0", countedCash: "0" }, { now: at("12:05") });

    await expect(reviewCashUp(ctxFor(f.cashier), { id: short.id })).rejects.toThrow(ForbiddenError);
    await expect(reviewCashUp(ctxFor(f.lekManager), { id: short.id })).rejects.toThrow(ForbiddenError);
    await expect(reviewCashUp(ctxFor(f.manager), { id: mine.id })).rejects.toThrow(/Another manager or the owner/);
    await expect(reviewCashUp(ctxFor(f.manager), { id: short.id })).rejects.toThrow(ValidationError);

    const reviewed = await reviewCashUp(ctxFor(f.manager), { id: short.id, note: "₦1,000 change given from the float, recounted with Femi" }, { now: at("13:00") });
    expect(reviewed).toMatchObject({ status: "REVIEWED", reviewedByName: f.manager.name, canReview: false });
    await expect(reviewCashUp(ctxFor(f.owner), { id: short.id, note: "again" })).rejects.toThrow(ConflictError);
    await expect(reviewCashUp(ctxFor(f.owner), { id: mine.id, note: "Checked" })).resolves.toMatchObject({ status: "REVIEWED" });

    await expect(db.$executeRawUnsafe(`UPDATE cash_ups SET counted_cash = 1020000, cash_variance = 0 WHERE id = '${short.id}'`)).rejects.toThrow(/cannot be changed/);
    await expect(db.$executeRawUnsafe(`DELETE FROM cash_ups WHERE id = '${short.id}'`)).rejects.toThrow(/cannot be deleted/);
  });

  it("shows reviewers whose takings are not cashed up yet, and flags drawers left open from an earlier day", async () => {
    expect(await pendingDrawers(ctxFor(f.cashier)).catch((e: unknown) => e)).toBeInstanceOf(ForbiddenError);
    // The manager sees the cashier's takings but not their own drawer: that count stays blind.
    const before = await pendingDrawers(ctxFor(f.manager), at("12:00"));
    expect(before.map((d) => [d.userName, d.payments, d.cash, d.card, d.transfer])).toEqual([[f.cashier.name, 3, "1000000.00", "75000.00", "16125.00"]]);
    expect((await pendingDrawers(ctxFor(f.owner), at("12:00"))).map((d) => [d.userName, d.transfer])).toEqual([
      [f.cashier.name, "16125.00"],
      [f.manager.name, "-16125.00"],
    ]);
    await submitCashUp(ctxFor(f.cashier), count(), { now: at("12:00") });
    expect(await pendingDrawers(ctxFor(f.manager), at("12:01"))).toEqual([]);

    // Next morning nobody else has cashed up: the manager's open drawer is now late.
    const alerts = await cashUpAlerts(ctxFor(f.owner), at("08:00", "2026-11-18"));
    expect(alerts.lateDrawers.map((d) => d.userName)).toEqual([f.manager.name]);
    expect(alerts.unbalanced).toEqual([]);
  });

  it("lists your own cash-ups for staff and the branch's for reviewers; owners cash up at a chosen branch", async () => {
    await submitCashUp(ctxFor(f.cashier), count(), { now: at("12:00") });
    await submitCashUp(ctxFor(f.manager), { openingFloat: "0", countedCash: "0" }, { now: at("12:05") });
    expect((await listCashUps(ctxFor(f.cashier))).rows.map((r) => r.userName)).toEqual([f.cashier.name]);
    expect((await listCashUps(ctxFor(f.manager))).rows).toHaveLength(2);
    expect((await listCashUps(ctxFor(f.lekManager))).rows).toHaveLength(0);
    await expect(submitCashUp(ctxFor(f.owner), count(), { now: at("12:10") })).rejects.toThrow(/Choose the branch/);
    await expect(submitCashUp(ctxFor(f.owner, f.ikeja.id), { openingFloat: "0", countedCash: "0" }, { now: at("12:10") })).resolves.toMatchObject({ paymentCount: 0 });
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { checkout } from "@/server/services/invoice.service";
import { adjustAccessory, adjustUnit, applyStockCount, getCountSheet, listAdjustments, reviewStockCount } from "@/server/services/stock-adjustment.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const NOW = new Date("2026-11-17T11:00:00Z");

describe("stock adjustments and counts", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const owner = await makeUser("OWNER", null);
    const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const cashier = await makeUser("CASHIER", ikeja.id);
    const phone = await makeProduct("SERIALIZED");
    const charger = await makeProduct("NON_SERIALIZED");
    const cable = await makeProduct("NON_SERIALIZED");
    await db.product.update({ where: { id: charger.id }, data: { defaultCostPrice: "8000", defaultSellingPrice: "15000" } });
    await db.product.update({ where: { id: cable.id }, data: { defaultCostPrice: "1500" } });
    await db.branchInventory.createMany({ data: [{ branchId: ikeja.id, productId: charger.id, quantity: 10 }, { branchId: ikeja.id, productId: cable.id, quantity: 4 }] });
    const unit = (imei: string) =>
      db.serializedUnit.create({ data: { productId: phone.id, imei, branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "800000", sellingPrice: "1000000", receivedAt: NOW } });
    const units = [await unit("490154203237518"), await unit("356938035643809"), await unit("353456789012344")];
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    return { ikeja, owner, manager, cashier, charger, cable, units, customer };
  }

  beforeEach(async () => {
    f = await setup();
  });

  const shelf = async (productId: string) => (await db.branchInventory.findFirstOrThrow({ where: { branchId: f.ikeja.id, productId } })).quantity;

  it("is owner only", async () => {
    const input = { branchId: f.ikeja.id, productId: f.charger.id, mode: "change" as const, quantity: -1, reason: "DAMAGED" as const };
    await expect(adjustAccessory(ctxFor(f.manager), input)).rejects.toThrow(ForbiddenError);
    await expect(adjustAccessory(ctxFor(f.cashier), input)).rejects.toThrow(ForbiddenError);
    await expect(adjustUnit(ctxFor(f.manager), { unitId: f.units[0].id, toStatus: "DEFECTIVE", reason: "DAMAGED" })).rejects.toThrow(ForbiddenError);
  });

  it("changes or sets an accessory quantity with a reason, never below zero, and records it append-only", async () => {
    expect(await adjustAccessory(ctxFor(f.owner), { branchId: f.ikeja.id, productId: f.charger.id, mode: "change", quantity: -2, reason: "DAMAGED", note: "Water leak" })).toEqual({ quantityBefore: 10, quantityAfter: 8 });
    expect(await adjustAccessory(ctxFor(f.owner), { branchId: f.ikeja.id, productId: f.charger.id, mode: "set", quantity: 9, reason: "FOUND" })).toEqual({ quantityBefore: 8, quantityAfter: 9 });
    await expect(adjustAccessory(ctxFor(f.owner), { branchId: f.ikeja.id, productId: f.charger.id, mode: "change", quantity: -20, reason: "LOST" })).rejects.toThrow(ValidationError);
    await expect(adjustAccessory(ctxFor(f.owner), { branchId: f.ikeja.id, productId: f.charger.id, mode: "set", quantity: 9, reason: "FOUND" })).rejects.toThrow(/Nothing to change/);
    await expect(adjustAccessory(ctxFor(f.owner), { branchId: f.ikeja.id, productId: f.units[0].productId, mode: "change", quantity: 1, reason: "FOUND" })).rejects.toThrow(/one by one/);
    expect(await shelf(f.charger.id)).toBe(9);

    const history = await listAdjustments(ctxFor(f.owner));
    expect(history.rows.map((r) => [r.change, r.reason, r.value])).toEqual([
      ["8 → 9", "FOUND", "8000.00"],
      ["10 → 8", "DAMAGED", "-16000.00"],
    ]);
    expect(await db.auditLog.count({ where: { action: "stock.adjust" } })).toBe(2);
    const id = history.rows[0].id;
    await expect(db.$executeRawUnsafe(`UPDATE stock_adjustments SET quantity_change = 5 WHERE id = '${id}'`)).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`DELETE FROM stock_adjustments WHERE id = '${id}'`)).rejects.toThrow(/append-only/);
  });

  it("moves a device between in stock, defective and written off only along allowed paths", async () => {
    const [a] = f.units;
    await adjustUnit(ctxFor(f.owner), { unitId: a.id, toStatus: "DEFECTIVE", reason: "DAMAGED", note: "Cracked screen" });
    await expect(adjustUnit(ctxFor(f.owner), { unitId: a.id, toStatus: "IN_STOCK", reason: "FOUND" })).rejects.toThrow(/reason/);
    await adjustUnit(ctxFor(f.owner), { unitId: a.id, toStatus: "IN_STOCK", reason: "REPAIRED" });
    await adjustUnit(ctxFor(f.owner), { unitId: a.id, toStatus: "WRITTEN_OFF", reason: "STOLEN" });
    expect((await db.serializedUnit.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("WRITTEN_OFF");
    // A written-off device can't be sold.
    await expect(
      checkout(ctxFor(f.cashier), { customerId: f.customer.id, lines: [{ kind: "unit", unitId: a.id }], payment: { type: "FULL", payments: [{ method: "CASH", amount: "1075000" }] } }, { now: NOW }),
    ).rejects.toThrow();
    // A sold device is not adjustable here (that is a return).
    await checkout(ctxFor(f.cashier), { customerId: f.customer.id, lines: [{ kind: "unit", unitId: f.units[1].id }], payment: { type: "FULL", payments: [{ method: "CASH", amount: "1075000" }] } }, { now: NOW });
    await expect(adjustUnit(ctxFor(f.owner), { unitId: f.units[1].id, toStatus: "WRITTEN_OFF", reason: "LOST" })).rejects.toThrow(ConflictError);
    expect((await listAdjustments(ctxFor(f.owner))).rows.map((r) => r.quantityChange)).toEqual([-1, 1, -1]);
  });

  it("counts a branch: corrects differing accessory lines, writes off unscanned devices, flags strangers", async () => {
    const sheet = await getCountSheet(ctxFor(f.owner), f.ikeja.id);
    expect(sheet.units).toHaveLength(3);
    const input = {
      branchId: f.ikeja.id,
      accessories: [{ productId: f.charger.id, expected: 10, counted: 7 }, { productId: f.cable.id, expected: 4, counted: 4 }],
      scanned: ["490154203237518", " 3569 3803 5643 809 ", "999999999999999"],
      sheetUnitIds: sheet.units.map((u) => u.id),
      countDevices: true,
      note: "Monthly count",
    };
    const review = await reviewStockCount(ctxFor(f.owner), input);
    expect(review.accessories).toEqual([{ productId: f.charger.id, name: expect.any(String), expected: 10, counted: 7, difference: -3, value: "-24000.00" }]);
    expect(review.missing.map((m) => m.identifier)).toEqual(["353456789012344"]);
    expect(review).toMatchObject({ moved: [], matched: 2, netValue: "-824000.00", unexpected: [{ identifier: "999999999999999", where: "not in the system" }] });

    const applied = await applyStockCount(ctxFor(f.owner), input);
    expect(applied.adjustments).toBe(2);
    expect(await shelf(f.charger.id)).toBe(7);
    expect(await shelf(f.cable.id)).toBe(4);
    expect((await db.serializedUnit.findUniqueOrThrow({ where: { id: f.units[2].id } })).status).toBe("WRITTEN_OFF");
    expect(await db.stockCount.findUniqueOrThrow({ where: { id: applied.stockCountId } })).toMatchObject({ linesCounted: 2, unitsCounted: 3, note: "Monthly count" });
    expect(await db.stockAdjustment.count({ where: { stockCountId: applied.stockCountId } })).toBe(2);
  });

  it("refuses to apply a count when stock moved after counting started, and never flags a device that arrived later", async () => {
    const sheet = await getCountSheet(ctxFor(f.owner), f.ikeja.id);
    const atStart = sheet.accessories.find((a) => a.productId === f.charger.id)?.expected ?? -1;
    // Counted 7 chargers; then a charger is sold before Apply. Setting the shelf to 7 would double-count that sale.
    const input = {
      branchId: f.ikeja.id,
      accessories: [{ productId: f.charger.id, expected: atStart, counted: 7 }],
      scanned: f.units.slice(0, 3).map((u) => u.imei ?? ""),
      sheetUnitIds: sheet.units.map((u) => u.id),
      countDevices: true,
    };
    await checkout(ctxFor(f.cashier), { customerId: f.customer.id, lines: [{ kind: "accessory", productId: f.charger.id, quantity: 1 }], payment: { type: "FULL", payments: [{ method: "CASH", amount: "16125" }] } }, { now: NOW });
    expect((await reviewStockCount(ctxFor(f.owner), input)).moved).toEqual([{ name: expect.any(String), atStart: 10, now: 9 }]);
    await expect(applyStockCount(ctxFor(f.owner), input)).rejects.toThrow(/changed during the count/);
    expect(await shelf(f.charger.id)).toBe(9);

    // A device received after the sheet was printed is not "missing" just because it wasn't scanned.
    const late = await db.serializedUnit.create({ data: { productId: f.units[0].productId, imei: "359876543210988", branchId: f.ikeja.id, condition: "BRAND_NEW", costPrice: "800000", sellingPrice: "1000000", receivedAt: NOW } });
    const devicesOnly = { ...input, accessories: [] };
    const review = await reviewStockCount(ctxFor(f.owner), devicesOnly);
    expect(review.missing.map((m) => m.id)).not.toContain(late.id);
    expect(review.missing).toEqual([]);
  });
});

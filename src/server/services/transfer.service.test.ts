import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import {
  cancelTransfer,
  createTransfer,
  getTransfer,
  listTransfers,
  receiveTransfer,
  shipTransfer,
} from "@/server/services/transfer.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

async function setup() {
  await resetDatabase();
  const ikeja = await makeBranch({ code: "IKJ" });
  const lekki = await makeBranch({ code: "LEK" });
  const main = await makeBranch({ code: "MAIN" });
  const owner = await makeUser("OWNER", null);
  const ikjManager = await makeUser("BRANCH_MANAGER", ikeja.id);
  const lekManager = await makeUser("BRANCH_MANAGER", lekki.id);
  const cashier = await makeUser("CASHIER", ikeja.id);
  const phone = await makeProduct("SERIALIZED");
  const charger = await makeProduct("NON_SERIALIZED");
  const unit = (imei: string) =>
    db.serializedUnit.create({
      data: {
        productId: phone.id,
        imei,
        branchId: ikeja.id,
        condition: "BRAND_NEW",
        costPrice: "1000",
        sellingPrice: "1500",
        receivedAt: new Date("2026-11-01T10:00:00Z"),
      },
    });
  const [u1, u2] = [await unit("490154203237518"), await unit("356938035643809")];
  await db.branchInventory.create({ data: { productId: charger.id, branchId: ikeja.id, quantity: 20 } });
  return { ikeja, lekki, main, owner, ikjManager, lekManager, cashier, phone, charger, u1, u2 };
}

type F = Awaited<ReturnType<typeof setup>>;

const stock = (f: F, branchId: string) =>
  db.branchInventory.findUnique({ where: { productId_branchId: { productId: f.charger.id, branchId } } });

async function draft(f: F, quantity = 8) {
  return createTransfer(ctxFor(f.ikjManager), {
    toBranchId: f.lekki.id,
    unitIds: [f.u1.id, f.u2.id],
    accessories: [{ productId: f.charger.id, quantity }],
  });
}

describe("transfer state transitions", () => {
  let f: F;
  beforeEach(async () => {
    f = await setup();
  });

  it("DRAFT reserves nothing; numbers come from the source branch", async () => {
    const t = await draft(f);
    expect(t.number).toBe("TRF-IKJ-000001");
    const row = await db.stockTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.status).toBe("DRAFT");
    expect((await db.serializedUnit.findUniqueOrThrow({ where: { id: f.u1.id } })).status).toBe("IN_STOCK");
    expect((await stock(f, f.ikeja.id))?.quantity).toBe(20);
  });

  it("DRAFT → IN_TRANSIT locks units and moves accessory quantity into reserved", async () => {
    const t = await draft(f);
    await shipTransfer(ctxFor(f.ikjManager), { transferId: t.id, driverName: "Musa" });
    const units = await db.serializedUnit.findMany({ where: { id: { in: [f.u1.id, f.u2.id] } } });
    expect(units.map((u) => [u.status, u.branchId])).toEqual([
      ["IN_TRANSIT", f.ikeja.id],
      ["IN_TRANSIT", f.ikeja.id],
    ]);
    expect(await stock(f, f.ikeja.id)).toMatchObject({ quantity: 12, reservedQuantity: 8 });
    const row = await db.stockTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: "IN_TRANSIT", driverName: "Musa", shippedById: f.ikjManager.id });
  });

  it("IN_TRANSIT → RECEIVED moves stock to the destination; short accessories are flagged", async () => {
    const t = await draft(f);
    await shipTransfer(ctxFor(f.ikjManager), { transferId: t.id });
    const detail = await getTransfer(ctxFor(f.lekManager), t.id);
    await receiveTransfer(ctxFor(f.lekManager), {
      transferId: t.id,
      items: detail.items.map((item) => ({
        itemId: item.id,
        receivedQuantity: item.serializedUnitId ? 1 : 6,
        note: item.serializedUnitId ? undefined : "2 missing",
      })),
    });
    const units = await db.serializedUnit.findMany({ where: { id: { in: [f.u1.id, f.u2.id] } } });
    expect(units.every((u) => u.status === "IN_STOCK" && u.branchId === f.lekki.id)).toBe(true);
    expect(await stock(f, f.ikeja.id)).toMatchObject({ quantity: 12, reservedQuantity: 0 });
    expect(await stock(f, f.lekki.id)).toMatchObject({ quantity: 6 });
    const row = await db.stockTransfer.findUniqueOrThrow({ where: { id: t.id }, include: { items: true } });
    expect(row.status).toBe("RECEIVED");
    expect(row.hasDiscrepancy).toBe(true);
    expect(row.items.find((i) => !i.serializedUnitId)).toMatchObject({ receivedQuantity: 6, discrepancyNote: "2 missing" });
  });

  it("cancelling in transit returns everything to the source", async () => {
    const t = await draft(f);
    await shipTransfer(ctxFor(f.ikjManager), { transferId: t.id });
    await cancelTransfer(ctxFor(f.ikjManager), { transferId: t.id, reason: "Van broke down" });
    const units = await db.serializedUnit.findMany({ where: { id: { in: [f.u1.id, f.u2.id] } } });
    expect(units.every((u) => u.status === "IN_STOCK" && u.branchId === f.ikeja.id)).toBe(true);
    expect(await stock(f, f.ikeja.id)).toMatchObject({ quantity: 20, reservedQuantity: 0 });
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("CANCELLED");
  });

  it("cancels a draft without touching stock", async () => {
    const t = await draft(f);
    await cancelTransfer(ctxFor(f.owner, null), { transferId: t.id, reason: "Wrong items" });
    expect((await stock(f, f.ikeja.id))?.quantity).toBe(20);
  });

  it("rejects invalid transitions", async () => {
    const t = await draft(f);
    const detail = await getTransfer(ctxFor(f.owner, null), t.id);
    const receiveAll = { transferId: t.id, items: detail.items.map((i) => ({ itemId: i.id, receivedQuantity: i.quantity })) };
    await expect(receiveTransfer(ctxFor(f.lekManager), receiveAll)).rejects.toBeInstanceOf(ValidationError);
    await shipTransfer(ctxFor(f.ikjManager), { transferId: t.id });
    await expect(shipTransfer(ctxFor(f.ikjManager), { transferId: t.id })).rejects.toBeInstanceOf(ValidationError);
    await receiveTransfer(ctxFor(f.lekManager), receiveAll);
    await expect(cancelTransfer(ctxFor(f.owner, null), { transferId: t.id, reason: "Too late" })).rejects.toBeInstanceOf(ValidationError);
    await expect(receiveTransfer(ctxFor(f.lekManager), receiveAll)).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires every device to arrive; only accessories may be short", async () => {
    const t = await draft(f);
    await shipTransfer(ctxFor(f.ikjManager), { transferId: t.id });
    const detail = await getTransfer(ctxFor(f.lekManager), t.id);
    await expect(
      receiveTransfer(ctxFor(f.lekManager), {
        transferId: t.id,
        items: detail.items.map((i) => ({ itemId: i.id, receivedQuantity: i.serializedUnitId === f.u1.id ? 0 : i.quantity })),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("transfer permissions and conflicts", () => {
  let f: F;
  beforeEach(async () => {
    f = await setup();
  });

  it("only the source side ships and only the destination side receives", async () => {
    const t = await draft(f);
    await expect(shipTransfer(ctxFor(f.lekManager), { transferId: t.id })).rejects.toBeInstanceOf(ForbiddenError);
    await shipTransfer(ctxFor(f.ikjManager), { transferId: t.id });
    const detail = await getTransfer(ctxFor(f.owner, null), t.id);
    const items = detail.items.map((i) => ({ itemId: i.id, receivedQuantity: i.quantity }));
    await expect(receiveTransfer(ctxFor(f.ikjManager), { transferId: t.id, items })).rejects.toBeInstanceOf(ForbiddenError);
    await receiveTransfer(ctxFor(f.owner, null), { transferId: t.id, items });
  });

  it("keeps cashiers out and managers on their own branch", async () => {
    await expect(draft({ ...f, ikjManager: f.cashier })).rejects.toBeInstanceOf(ForbiddenError);
    const t = await createTransfer(ctxFor(f.ikjManager), {
      fromBranchId: f.main.id, // ignored: managers ship from their own branch
      toBranchId: f.lekki.id,
      unitIds: [f.u1.id],
      accessories: [],
    });
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: t.id } })).fromBranchId).toBe(f.ikeja.id);
    const outsider = await makeUser("BRANCH_MANAGER", f.main.id);
    await expect(getTransfer(ctxFor(outsider), t.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses units that are not in stock at the source, and same-branch transfers", async () => {
    await db.serializedUnit.update({ where: { id: f.u2.id }, data: { status: "SOLD" } });
    await expect(draft(f)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTransfer(ctxFor(f.ikjManager), { toBranchId: f.ikeja.id, unitIds: [f.u1.id], accessories: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("fails the ship if a unit was sold or stock ran out after the draft was made", async () => {
    const t = await draft(f);
    await db.serializedUnit.update({ where: { id: f.u1.id }, data: { status: "SOLD" } });
    await expect(shipTransfer(ctxFor(f.ikjManager), { transferId: t.id })).rejects.toBeInstanceOf(ConflictError);
    expect((await db.serializedUnit.findUniqueOrThrow({ where: { id: f.u2.id } })).status).toBe("IN_STOCK");

    await db.serializedUnit.update({ where: { id: f.u1.id }, data: { status: "IN_STOCK" } });
    await db.branchInventory.update({ where: { productId_branchId: { productId: f.charger.id, branchId: f.ikeja.id } }, data: { quantity: 3 } });
    await expect(shipTransfer(ctxFor(f.ikjManager), { transferId: t.id })).rejects.toBeInstanceOf(ConflictError);
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("DRAFT");
  });

  it("writes an audit row for every transition", async () => {
    const t = await draft(f);
    await shipTransfer(ctxFor(f.ikjManager), { transferId: t.id });
    await cancelTransfer(ctxFor(f.owner, null), { transferId: t.id, reason: "Changed plan" });
    const actions = (await db.auditLog.findMany({ where: { entityId: t.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["transfer.create", "transfer.ship", "transfer.cancel"]);
  });

  it("lists transfers by direction relative to the manager's branch", async () => {
    await draft(f);
    expect((await listTransfers(ctxFor(f.ikjManager), { direction: "outgoing" })).rows).toHaveLength(1);
    expect((await listTransfers(ctxFor(f.ikjManager), { direction: "incoming" })).rows).toHaveLength(0);
    expect((await listTransfers(ctxFor(f.lekManager), { direction: "incoming" })).rows).toHaveLength(1);
  });
});

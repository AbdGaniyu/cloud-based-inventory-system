import { beforeEach, describe, expect, it } from "vitest";

import type { IntakeInput } from "@/lib/validators/intake";
import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { checkIdentifiers, createIntake, getIntake } from "@/server/services/intake.service";
import { ctxFor, makeBranch, makeProduct, makeSupplier, makeUser, resetDatabase } from "@/test/db";

const IMEI_A = "490154203237518";
const IMEI_B = "356938035643809";
const IMEI_BAD = "490154203237519";

async function setup() {
  await resetDatabase();
  const [ikeja, lekki] = [await makeBranch({ code: "IKJ" }), await makeBranch({ code: "LEK" })];
  const owner = await makeUser("OWNER", null);
  const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
  const cashier = await makeUser("CASHIER", ikeja.id);
  const phone = await makeProduct("SERIALIZED");
  const charger = await makeProduct("NON_SERIALIZED", { reorderLevel: 5 });
  const supplier = await makeSupplier();
  return { ikeja, lekki, owner, manager, cashier, phone, charger, supplier };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

function baseInput(f: Fixture, overrides: Partial<IntakeInput> = {}): IntakeInput {
  return {
    supplierId: f.supplier.id,
    branchId: f.ikeja.id,
    receivedOn: "2026-11-17",
    payment: { mode: "CREDIT", netDays: 30 },
    serializedLines: [
      {
        productId: f.phone.id,
        units: [
          { identifier: IMEI_A, condition: "BRAND_NEW", costPrice: "1000000", sellingPrice: "1200000", batteryHealth: null },
          { identifier: IMEI_B, condition: "UK_USED", costPrice: "800000", sellingPrice: "950000", batteryHealth: 88 },
        ],
      },
    ],
    accessoryLines: [{ productId: f.charger.id, quantity: 10, unitCost: "9500" }],
    ...overrides,
  };
}

const NOW = new Date("2026-11-17T10:00:00Z");

describe("createIntake", () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await setup();
  });

  it("owner paid-in-full intake creates PO, units, stock, payment and audit rows in one go", async () => {
    const result = await createIntake(
      ctxFor(f.owner, null),
      baseInput(f, { payment: { mode: "PAID_IN_FULL", method: "BANK_TRANSFER", reference: "TRF-1" } }),
      { now: NOW },
    );
    expect(result.number).toBe("PO-IKJ-000001");

    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: result.id }, include: { items: true, payments: true } });
    expect(po.totalCost.toFixed(2)).toBe("1895000.00");
    expect(po.amountPaid.toFixed(2)).toBe("1895000.00");
    expect(po.status).toBe("PAID");
    expect(po.dueDate).toBeNull();
    expect(po.items).toHaveLength(3); // two phone cost groups + one accessory line
    expect(po.payments).toHaveLength(1);

    const units = await db.serializedUnit.findMany({ where: { purchaseOrderId: po.id }, orderBy: { imei: "asc" } });
    expect(units.map((u) => [u.imei, u.status, u.branchId])).toEqual([
      [IMEI_B, "IN_STOCK", f.ikeja.id],
      [IMEI_A, "IN_STOCK", f.ikeja.id],
    ]);
    expect(units.every((u) => u.purchaseOrderItemId)).toBe(true);

    const stock = await db.branchInventory.findUniqueOrThrow({
      where: { productId_branchId: { productId: f.charger.id, branchId: f.ikeja.id } },
    });
    expect(stock.quantity).toBe(10);

    const audits = await db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action).sort()).toEqual(["purchaseOrder.receive", "supplierPayment.create"]);
  });

  it("adds to existing accessory stock and records the latest cost on the product", async () => {
    await createIntake(ctxFor(f.owner, null), baseInput(f), { now: NOW });
    await createIntake(
      ctxFor(f.owner, null),
      baseInput(f, { serializedLines: [], accessoryLines: [{ productId: f.charger.id, quantity: 5, unitCost: "9800", unitSellingPrice: "16000" }] }),
      { now: NOW },
    );
    const stock = await db.branchInventory.findUniqueOrThrow({
      where: { productId_branchId: { productId: f.charger.id, branchId: f.ikeja.id } },
    });
    expect(stock.quantity).toBe(15);
    const product = await db.product.findUniqueOrThrow({ where: { id: f.charger.id } });
    expect(product.defaultCostPrice.toFixed(2)).toBe("9800.00");
    expect(product.defaultSellingPrice.toFixed(2)).toBe("16000.00");
  });

  it("manager intake on credit lands in the manager's own branch whatever branch is sent", async () => {
    const result = await createIntake(ctxFor(f.manager), baseInput(f, { branchId: f.lekki.id }), { now: NOW });
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: result.id } });
    expect(po.branchId).toBe(f.ikeja.id);
    expect(po.status).toBe("UNPAID");
    expect(po.paymentTerms).toBe("NET_30");
    expect(po.dueDate?.toISOString().slice(0, 10)).toBe("2026-12-17");
  });

  it("ignores a manager's accessory selling price (price edits are owner-only)", async () => {
    await createIntake(
      ctxFor(f.manager),
      baseInput(f, { serializedLines: [], accessoryLines: [{ productId: f.charger.id, quantity: 1, unitCost: "9000", unitSellingPrice: "99999" }] }),
      { now: NOW },
    );
    const product = await db.product.findUniqueOrThrow({ where: { id: f.charger.id } });
    expect(product.defaultSellingPrice.toFixed(2)).toBe("150.00");
  });

  it("does not let managers record a supplier payment", async () => {
    await expect(
      createIntake(ctxFor(f.manager), baseInput(f, { payment: { mode: "PAID_IN_FULL", method: "CASH" } }), { now: NOW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not let cashiers receive stock", async () => {
    await expect(createIntake(ctxFor(f.cashier), baseInput(f), { now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects an IMEI that is already in stock and writes nothing", async () => {
    await createIntake(ctxFor(f.owner, null), baseInput(f), { now: NOW });
    const before = await db.purchaseOrder.count();
    await expect(createIntake(ctxFor(f.owner, null), baseInput(f), { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.purchaseOrder.count()).toBe(before);
  });

  it("rejects duplicates inside the batch, bad check digits and wrong product types", async () => {
    const dup = baseInput(f);
    dup.serializedLines[0].units[1].identifier = IMEI_A;
    await expect(createIntake(ctxFor(f.owner, null), dup, { now: NOW })).rejects.toBeInstanceOf(ValidationError);

    const bad = baseInput(f);
    bad.serializedLines[0].units[0].identifier = IMEI_BAD;
    await expect(createIntake(ctxFor(f.owner, null), bad, { now: NOW })).rejects.toBeInstanceOf(ValidationError);

    const wrongType = baseInput(f, { accessoryLines: [{ productId: f.phone.id, quantity: 1, unitCost: "1" }] });
    await expect(createIntake(ctxFor(f.owner, null), wrongType, { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.purchaseOrder.count()).toBe(0);
  });

  it("requires a partial deposit to be more than zero and less than the total", async () => {
    for (const amountPaid of ["0", "1895000"]) {
      await expect(
        createIntake(
          ctxFor(f.owner, null),
          baseInput(f, { payment: { mode: "PARTIAL_DEPOSIT", netDays: 15, amountPaid, method: "CASH" } }),
          { now: NOW },
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    const ok = await createIntake(
      ctxFor(f.owner, null),
      baseInput(f, { payment: { mode: "PARTIAL_DEPOSIT", netDays: 15, amountPaid: "500000", method: "CASH" } }),
      { now: NOW },
    );
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: ok.id } });
    expect(po.status).toBe("PARTIALLY_PAID");
    expect(po.amountPaid.toFixed(2)).toBe("500000.00");
  });

  it("refuses intakes dated in the future", async () => {
    await expect(
      createIntake(ctxFor(f.owner, null), baseInput(f, { receivedOn: "2026-11-18" }), { now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("makes the owner choose a branch in all-branches view", async () => {
    await expect(
      createIntake(ctxFor(f.owner, null), baseInput(f, { branchId: undefined }), { now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("checkIdentifiers", () => {
  it("reports invalid, duplicated and already-recorded identifiers", async () => {
    const f = await setup();
    await createIntake(ctxFor(f.owner, null), baseInput(f), { now: NOW });
    const result = await checkIdentifiers(ctxFor(f.manager), [IMEI_A, IMEI_BAD, "NEWSERIAL1", "NEWSERIAL1"]);
    expect(result[IMEI_A]).toMatchObject({ status: "exists" });
    expect(result[IMEI_BAD]).toMatchObject({ status: "invalid" });
    expect(result.NEWSERIAL1).toMatchObject({ status: "duplicate" });
  });

  it("is closed to cashiers", async () => {
    const f = await setup();
    await expect(checkIdentifiers(ctxFor(f.cashier), [IMEI_A])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getIntake", () => {
  it("shows cost to the owner and strips it for the receiving manager", async () => {
    const f = await setup();
    const { id } = await createIntake(ctxFor(f.manager), baseInput(f), { now: NOW });

    const forOwner = await getIntake(ctxFor(f.owner, null), id);
    expect(forOwner.totalCost).toBe("1895000.00");

    const forManager = await getIntake(ctxFor(f.manager), id);
    expect(forManager).not.toHaveProperty("totalCost");
    expect(JSON.stringify(forManager)).not.toContain("1000000");
    expect(forManager.lines.flatMap((l) => l.units).map((u) => u.identifier).sort()).toEqual([IMEI_B, IMEI_A].sort());
  });

  it("hides another branch's intake from a manager", async () => {
    const f = await setup();
    const { id } = await createIntake(ctxFor(f.owner, null), baseInput(f, { branchId: f.lekki.id }), { now: NOW });
    await expect(getIntake(ctxFor(f.manager), id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

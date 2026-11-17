import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { closeBranchInto, previewBranchClosure } from "@/server/services/admin.service";
import { checkout } from "@/server/services/invoice.service";
import { createTransfer, shipTransfer } from "@/server/services/transfer.service";
import { ctxFor, makeBranch, makeProduct, makeSupplier, makeUser, resetDatabase } from "@/test/db";

const SALE_TIME = new Date("2026-11-10T11:00:00Z");

describe("closing a branch into another", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const owner = await makeUser("OWNER", null);
    const ikjManager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const lekManager = await makeUser("BRANCH_MANAGER", lekki.id);
    const lekCashier = await makeUser("CASHIER", lekki.id);
    const phone = await makeProduct("SERIALIZED");
    const charger = await makeProduct("NON_SERIALIZED");
    const unit = (imei: string, branchId: string) =>
      db.serializedUnit.create({ data: { productId: phone.id, imei, branchId, condition: "BRAND_NEW", costPrice: "800000", sellingPrice: "1000000", receivedAt: SALE_TIME } });
    const lekUnits = [await unit("490154203237518", lekki.id), await unit("356938035643809", lekki.id), await unit("353456789012344", lekki.id)];
    const ikjUnit = await unit("352099001761481", ikeja.id);
    await db.branchInventory.createMany({ data: [{ branchId: lekki.id, productId: charger.id, quantity: 12 }, { branchId: ikeja.id, productId: charger.id, quantity: 5 }] });
    const customer = await db.customer.create({ data: { name: "Tunde Bakare", phoneE164: "+2348052345678" } });
    await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });

    // An open instalment account sold at Lekki.
    const sale = await checkout(
      ctxFor(lekCashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: lekUnits[0].id }],
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "275000" }], numberOfInstallments: 2, frequency: "MONTHLY", firstDueDate: "2026-12-10" },
      },
      { now: SALE_TIME },
    );
    // Ikeja → Lekki in transit (a device and 2 chargers), and a Lekki draft.
    const inbound = await createTransfer(ctxFor(owner, ikeja.id), { fromBranchId: ikeja.id, toBranchId: lekki.id, unitIds: [ikjUnit.id], accessories: [{ productId: charger.id, quantity: 2 }] });
    await shipTransfer(ctxFor(owner, ikeja.id), { transferId: inbound.id });
    const draft = await createTransfer(ctxFor(lekManager), { toBranchId: ikeja.id, unitIds: [lekUnits[1].id], accessories: [] });
    // An open supplier bill received at Lekki.
    const supplier = await makeSupplier();
    await db.purchaseOrder.create({
      data: { number: "PO-LEK-000001", supplierId: supplier.id, branchId: lekki.id, paymentTerms: "NET_30", totalCost: "500000", receivedById: owner.id, receivedAt: SALE_TIME, dueDate: new Date("2026-12-10T00:00:00Z") },
    });
    await db.stockAlert.create({
      data: { type: "LOW_STOCK", branchId: lekki.id, productId: charger.id, dedupeKey: `LOW_STOCK:${lekki.id}:${charger.id}`, value: 1, threshold: 5, firstDetectedAt: SALE_TIME, lastDetectedAt: SALE_TIME },
    });
    return { ikeja, lekki, owner, ikjManager, lekManager, lekCashier, lekUnits, ikjUnit, charger, sale, inbound, draft };
  }

  beforeEach(async () => {
    f = await setup();
  });

  it("previews what will move and what will be cancelled", async () => {
    const preview = await previewBranchClosure(ctxFor(f.owner, null), f.lekki.id);
    expect(preview).toMatchObject({
      devices: 2,
      accessoryQuantity: 12,
      openInvoices: [{ number: f.sale.number, balance: "800000.00" }],
      openPurchaseOrders: [{ number: "PO-LEK-000001", owed: "500000.00" }],
      targets: [{ code: "IKJ" }],
    });
    expect(preview.staff).toHaveLength(2);
    expect(preview.transfersToCancel.map((t) => t.status).sort()).toEqual(["DRAFT", "IN_TRANSIT"]);
  });

  it("moves stock, staff and open accounts, cancels live transfers, and closes the branch — keeping history", async () => {
    await expect(closeBranchInto(ctxFor(f.ikjManager), { branchId: f.lekki.id, targetBranchId: f.ikeja.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(closeBranchInto(ctxFor(f.owner, null), { branchId: f.lekki.id, targetBranchId: f.lekki.id })).rejects.toBeInstanceOf(ValidationError);

    const result = await closeBranchInto(ctxFor(f.owner, null), { branchId: f.lekki.id, targetBranchId: f.ikeja.id });
    expect(result).toMatchObject({ devicesMoved: 2, accessoriesMoved: 12, staffMoved: 2, invoicesMoved: [f.sale.number], purchaseOrdersMoved: ["PO-LEK-000001"] });
    expect(result.transfersCancelled).toHaveLength(2);

    // The in-transit device and chargers went back to Ikeja; Lekki's stock joined them.
    expect(await db.serializedUnit.findUniqueOrThrow({ where: { id: f.ikjUnit.id } })).toMatchObject({ status: "IN_STOCK", branchId: f.ikeja.id });
    expect(await db.serializedUnit.count({ where: { branchId: f.lekki.id, status: { not: "SOLD" } } })).toBe(0);
    expect((await db.branchInventory.findFirstOrThrow({ where: { branchId: f.ikeja.id, productId: f.charger.id } })).quantity).toBe(17);
    expect((await db.branchInventory.findFirstOrThrow({ where: { branchId: f.lekki.id } })).quantity).toBe(0);
    expect(await db.user.count({ where: { branchId: f.ikeja.id } })).toBe(3);

    // The open account moves with its number unchanged; the sold unit and the down payment keep their history.
    expect(await db.invoice.findUniqueOrThrow({ where: { id: f.sale.invoiceId } })).toMatchObject({ number: f.sale.number, branchId: f.ikeja.id });
    expect(await db.serializedUnit.findUniqueOrThrow({ where: { id: f.lekUnits[0].id } })).toMatchObject({ status: "SOLD", branchId: f.lekki.id });
    expect((await db.customerPayment.findFirstOrThrow({ where: { invoiceId: f.sale.invoiceId } })).branchId).toBe(f.lekki.id);

    expect(await db.branch.findUniqueOrThrow({ where: { id: f.lekki.id } })).toMatchObject({ isActive: false });
    expect(await db.stockAlert.count({ where: { branchId: f.lekki.id, resolvedAt: null } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "transfer.cancel" } })).toBe(2);
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "branch.close" } })).toMatchObject({ entityId: f.lekki.id });
    await expect(closeBranchInto(ctxFor(f.owner, null), { branchId: f.lekki.id, targetBranchId: f.ikeja.id })).rejects.toThrow("not open");
  });
});

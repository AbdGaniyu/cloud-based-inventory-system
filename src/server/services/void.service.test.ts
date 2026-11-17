import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError } from "@/server/errors";
import { receivablesAging } from "@/server/services/aging.service";
import { loadInvoiceDocument } from "@/server/services/document.service";
import { checkout } from "@/server/services/invoice.service";
import { recordCustomerPayment } from "@/server/services/ledger.service";
import { processReturn } from "@/server/services/return.service";
import { previewVoid, voidInvoice } from "@/server/services/void.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const SALE_TIME = new Date("2026-11-17T11:00:00Z");
const LATER_SAME_DAY = new Date("2026-11-17T20:00:00Z");
const NEXT_DAY = new Date("2026-11-18T09:00:00Z");

describe("voiding an invoice", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const lekManager = await makeUser("BRANCH_MANAGER", lekki.id);
    const owner = await makeUser("OWNER", null);
    const phone = await makeProduct("SERIALIZED");
    await db.product.update({ where: { id: phone.id }, data: { warrantyMonths: 12 } });
    const charger = await makeProduct("NON_SERIALIZED");
    await db.product.update({ where: { id: charger.id }, data: { defaultSellingPrice: "15000", warrantyMonths: 0 } });
    await db.branchInventory.create({ data: { branchId: ikeja.id, productId: charger.id, quantity: 10 } });
    const unit = (imei: string, price = "1000000") =>
      db.serializedUnit.create({ data: { productId: phone.id, imei, branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "800000", sellingPrice: price, receivedAt: SALE_TIME } });
    const units = [await unit("490154203237518"), await unit("356938035643809", "2000000")];
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });
    // Phone + 3 chargers, paid in full: 1,045,000 + 7.5% VAT = 1,123,375 (cash and card).
    const paid = await checkout(
      ctxFor(cashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: units[0].id }, { kind: "accessory", productId: charger.id, quantity: 3 }],
        payment: { type: "FULL", payments: [{ method: "CASH", amount: "1000000" }, { method: "POS_CARD", amount: "123375", reference: "T1" }] },
      },
      { now: SALE_TIME },
    );
    // Instalment sale: total 2,150,000, 500,000 down in cash, 3 × 550,000 monthly from 17 Dec.
    const plan = await checkout(
      ctxFor(cashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: units[1].id }],
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "500000" }], numberOfInstallments: 3, frequency: "MONTHLY", firstDueDate: "2026-12-17" },
      },
      { now: SALE_TIME },
    );
    return { ikeja, lekki, cashier, manager, lekManager, owner, units, charger, customer, paid, plan };
  }

  beforeEach(async () => {
    f = await setup();
  });

  it("lets a branch manager void their own branch's sale on the same day only; cashiers never; owners any time", async () => {
    const input = { invoiceId: f.paid.invoiceId, reason: "Rang up the wrong phone" };
    await expect(voidInvoice(ctxFor(f.cashier), input, { now: LATER_SAME_DAY })).rejects.toThrow(ForbiddenError);
    await expect(voidInvoice(ctxFor(f.lekManager), input, { now: LATER_SAME_DAY })).rejects.toThrow(ForbiddenError);
    await expect(voidInvoice(ctxFor(f.manager), input, { now: NEXT_DAY })).rejects.toThrow(ForbiddenError);
    await expect(voidInvoice(ctxFor(f.owner), input, { now: NEXT_DAY })).resolves.toMatchObject({ refundTotal: "1123375.00" });
  });

  it("puts the goods back, reverses each payment by method, voids warranties and keeps the invoice number", async () => {
    const preview = await previewVoid(ctxFor(f.manager), f.paid.invoiceId, { now: LATER_SAME_DAY });
    expect(preview).toMatchObject({ devices: 1, accessories: 3, warranties: 1, hasPlan: false, refundTotal: "1123375.00", blocker: null });
    expect(preview.refunds).toEqual(expect.arrayContaining([{ method: "CASH", amount: "1000000.00" }, { method: "POS_CARD", amount: "123375.00" }]));

    const result = await voidInvoice(ctxFor(f.manager), { invoiceId: f.paid.invoiceId, reason: "Rang up the wrong phone" }, { now: LATER_SAME_DAY });
    expect(result.number).toBe("INV-IKJ-000001");
    expect(await db.serializedUnit.findUniqueOrThrow({ where: { id: f.units[0].id } })).toMatchObject({ status: "IN_STOCK", branchId: f.ikeja.id });
    expect((await db.branchInventory.findFirstOrThrow({ where: { branchId: f.ikeja.id, productId: f.charger.id } })).quantity).toBe(10);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.paid.invoiceId } });
    expect(invoice).toMatchObject({ status: "VOID", voidReason: "Rang up the wrong phone", voidedById: f.manager.id });
    expect(invoice.amountPaid.toFixed(2)).toBe("0.00");
    expect(invoice.balance.toFixed(2)).toBe("1123375.00"); // ledger identity; VOID is excluded everywhere
    const reversals = await db.customerPayment.findMany({ where: { invoiceId: f.paid.invoiceId, reversalOfId: { not: null } } });
    expect(reversals.map((r) => `${r.method}:${r.amount.toFixed(2)}`).sort()).toEqual(["CASH:-1000000.00", "POS_CARD:-123375.00"]);
    expect((await db.warrantyCard.findMany({ where: { invoiceItem: { invoiceId: f.paid.invoiceId } } })).map((w) => w.status)).toEqual(["VOID"]);
    expect(await db.auditLog.count({ where: { action: "invoice.void", entityId: f.paid.invoiceId } })).toBe(1);

    // The device can be sold again straight away.
    await expect(
      checkout(ctxFor(f.cashier), { customerId: f.customer.id, lines: [{ kind: "unit", unitId: f.units[0].id }], payment: { type: "FULL", payments: [{ method: "CASH", amount: "1075000" }] } }, { now: LATER_SAME_DAY }),
    ).resolves.toMatchObject({ number: "INV-IKJ-000003" });
    await expect(voidInvoice(ctxFor(f.owner), { invoiceId: f.paid.invoiceId, reason: "Again, by mistake" }, { now: LATER_SAME_DAY })).rejects.toThrow(ConflictError);
  });

  it("cancels an instalment plan, refunds what was paid, and drops it from receivables and payments", async () => {
    await recordCustomerPayment(ctxFor(f.cashier), { invoiceId: f.plan.invoiceId, amount: "100000", method: "BANK_TRANSFER", reference: "TRF-9" }, { now: LATER_SAME_DAY });
    expect((await receivablesAging(ctxFor(f.owner), { now: LATER_SAME_DAY })).total).toBe("1550000.00");

    const result = await voidInvoice(ctxFor(f.owner), { invoiceId: f.plan.invoiceId, reason: "Customer's guarantor fell through" }, { now: LATER_SAME_DAY });
    expect(result.refunds).toEqual(expect.arrayContaining([{ method: "CASH", amount: "500000.00" }, { method: "BANK_TRANSFER", amount: "100000.00" }]));
    expect(await db.installmentPlan.findUniqueOrThrow({ where: { invoiceId: f.plan.invoiceId } })).toMatchObject({ status: "CANCELLED", nextDueDate: null });
    expect((await receivablesAging(ctxFor(f.owner), { now: LATER_SAME_DAY })).total).toBe("0.00");
    // Documents (page, PDF, receipt) show it as void: nothing owed, no next due date, unpaid rows cancelled.
    const doc = await loadInvoiceDocument(f.plan.invoiceId);
    expect(doc).toMatchObject({ status: "VOID", balance: "0.00", voided: { reason: "Customer's guarantor fell through" }, plan: { nextDueDate: null } });
    expect(doc.plan?.schedule.map((r) => r.status)).toEqual(["CANCELLED", "CANCELLED", "CANCELLED"]);
    await expect(recordCustomerPayment(ctxFor(f.cashier), { invoiceId: f.plan.invoiceId, amount: "100", method: "CASH" }, { now: LATER_SAME_DAY })).rejects.toThrow(ConflictError);
  });

  it("refuses an invoice that already had a return, pointing to the Returns flow", async () => {
    const chargerItem = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: f.paid.invoiceId, serializedUnitId: null } });
    await processReturn(ctxFor(f.manager), { invoiceId: f.paid.invoiceId, reason: "Faulty", lines: [{ invoiceItemId: chargerItem.id, quantity: 1, disposition: "RESTOCK" }], refundMethod: "CASH" }, { now: LATER_SAME_DAY });
    expect((await previewVoid(ctxFor(f.owner), f.paid.invoiceId, { now: LATER_SAME_DAY })).blocker).toMatch(/already returned/);
    await expect(voidInvoice(ctxFor(f.owner), { invoiceId: f.paid.invoiceId, reason: "Mistake sale" }, { now: LATER_SAME_DAY })).rejects.toThrow(/Return items/);
  });
});

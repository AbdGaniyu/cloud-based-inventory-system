import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { checkout } from "@/server/services/invoice.service";
import { getReturnContext, getSwapContext, listInvoiceReturns, processReturn } from "@/server/services/return.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const SALE_TIME = new Date("2026-11-17T11:00:00Z");
const NEXT_DAY = new Date("2026-11-18T11:00:00Z");

describe("returns and swaps", () => {
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
    const charger = await makeProduct("NON_SERIALIZED");
    await db.product.update({ where: { id: charger.id }, data: { defaultSellingPrice: "15000", warrantyMonths: 0 } });
    await db.branchInventory.create({ data: { branchId: ikeja.id, productId: charger.id, quantity: 10 } });
    const unit = (imei: string) =>
      db.serializedUnit.create({ data: { productId: phone.id, imei, branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "800000", sellingPrice: "1000000", receivedAt: SALE_TIME } });
    const units = [await unit("490154203237518"), await unit("356938035643809"), await unit("353456789012344")];
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    const other = await db.customer.create({ data: { name: "Bisi Akande", phoneE164: "+2347084561190" } });
    await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });
    // Phone + 3 chargers, paid in full: 1,045,000 + 7.5% VAT = 1,123,375.
    const paid = await checkout(
      ctxFor(cashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: units[0].id }, { kind: "accessory", productId: charger.id, quantity: 3 }],
        payment: { type: "FULL", payments: [{ method: "CASH", amount: "1123375" }] },
      },
      { now: SALE_TIME },
    );
    const items = await db.invoiceItem.findMany({ where: { invoiceId: paid.invoiceId } });
    const phoneItem = items.find((i) => i.serializedUnitId) ?? items[0];
    const chargerItem = items.find((i) => !i.serializedUnitId) ?? items[1];
    return { ikeja, lekki, cashier, manager, lekManager, owner, units, charger, customer, other, paid, phoneItem, chargerItem };
  }

  const ret = (lines: { invoiceItemId: string; quantity: number; disposition: "RESTOCK" | "DEFECTIVE" }[], extra: { invoiceId?: string; branchId?: string } = {}) => ({
    invoiceId: extra.invoiceId ?? f.paid.invoiceId,
    branchId: extra.branchId,
    reason: "Customer changed their mind",
    lines,
    refundMethod: "CASH" as const,
  });

  beforeEach(async () => {
    f = await setup();
  });

  it("refunds a returned accessory at its share of the total and puts it back on the shelf", async () => {
    const result = await processReturn(ctxFor(f.manager), ret([{ invoiceItemId: f.chargerItem.id, quantity: 1, disposition: "RESTOCK" }]), { now: NEXT_DAY });
    expect(result).toMatchObject({ number: "RTN-IKJ-000001", creditAmount: "16125.00", appliedToBalance: "0.00", refundAmount: "16125.00", invoiceStatus: "PAID", balance: "0.00" });
    expect((await db.branchInventory.findFirstOrThrow({ where: { branchId: f.ikeja.id, productId: f.charger.id } })).quantity).toBe(8);
    expect(await db.customerPayment.findFirstOrThrow({ where: { kind: "REFUND" } })).toMatchObject({ method: "CASH", branchId: f.ikeja.id });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: f.paid.invoiceId } })).returnedAmount.toFixed(2)).toBe("16125.00");
    expect(await db.auditLog.count({ where: { action: "return.create", entityId: result.returnId } })).toBe(1);
  });

  it("takes a defective device back at the receiving branch, voids its warranty, and closes the invoice once everything is back", async () => {
    const device = await processReturn(ctxFor(f.lekManager), ret([{ invoiceItemId: f.phoneItem.id, quantity: 1, disposition: "DEFECTIVE" }]), { now: NEXT_DAY });
    expect(device.number).toBe("RTN-LEK-000001");
    expect(await db.serializedUnit.findUniqueOrThrow({ where: { id: f.units[0].id } })).toMatchObject({ status: "DEFECTIVE", branchId: f.lekki.id });
    expect(await db.warrantyCard.findFirstOrThrow({ where: { invoiceItemId: f.phoneItem.id } })).toMatchObject({ status: "VOID", voidReason: "Returned on RTN-LEK-000001" });

    const rest = await processReturn(ctxFor(f.manager), ret([{ invoiceItemId: f.chargerItem.id, quantity: 3, disposition: "RESTOCK" }]), { now: NEXT_DAY });
    expect(rest.invoiceStatus).toBe("RETURNED");
    expect(money(device.creditAmount) + money(rest.creditAmount)).toBe(1123375);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.paid.invoiceId } });
    expect(invoice).toMatchObject({ status: "RETURNED" });
    expect(invoice.amountPaid.toFixed(2)).toBe("0.00");
    await expect(processReturn(ctxFor(f.manager), ret([{ invoiceItemId: f.chargerItem.id, quantity: 1, disposition: "RESTOCK" }]))).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects returning more than is left, and cashiers cannot take returns", async () => {
    await processReturn(ctxFor(f.manager), ret([{ invoiceItemId: f.chargerItem.id, quantity: 2, disposition: "RESTOCK" }]), { now: NEXT_DAY });
    await expect(processReturn(ctxFor(f.manager), ret([{ invoiceItemId: f.chargerItem.id, quantity: 2, disposition: "RESTOCK" }]), { now: NEXT_DAY })).rejects.toThrow(
      "Only 1 of",
    );
    await expect(processReturn(ctxFor(f.cashier), ret([{ invoiceItemId: f.chargerItem.id, quantity: 1, disposition: "RESTOCK" }]), { now: NEXT_DAY })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("serialises two returns of the same line so they cannot both succeed", async () => {
    const attempt = () => processReturn(ctxFor(f.manager), ret([{ invoiceItemId: f.chargerItem.id, quantity: 2, disposition: "RESTOCK" }]), { now: NEXT_DAY });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(ValidationError) });
  });

  it("lets only the owner accept a return after the window", async () => {
    const late = new Date("2026-11-30T11:00:00Z");
    const context = await getReturnContext(ctxFor(f.manager), f.paid.invoiceId, late);
    expect(context).toMatchObject({ daysSinceSale: 13, windowDays: 7, blockedByWindow: true });
    await expect(processReturn(ctxFor(f.manager), ret([{ invoiceItemId: f.chargerItem.id, quantity: 1, disposition: "RESTOCK" }]), { now: late })).rejects.toThrow("Only the owner");
    const byOwner = await processReturn(ctxFor(f.owner, f.ikeja.id), ret([{ invoiceItemId: f.chargerItem.id, quantity: 1, disposition: "RESTOCK" }]), { now: late });
    expect(byOwner.refundAmount).toBe("16125.00");
  });

  it("puts return credit against an instalment balance first and refunds only what was overpaid", async () => {
    // 1,075,000 on instalments, 500,000 down, 3 × 191,666.66…
    const plan = await checkout(
      ctxFor(f.cashier),
      {
        customerId: f.customer.id,
        lines: [{ kind: "unit", unitId: f.units[1].id }],
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "500000" }], numberOfInstallments: 3, frequency: "MONTHLY", firstDueDate: "2026-12-17" },
      },
      { now: SALE_TIME },
    );
    const item = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: plan.invoiceId } });
    const result = await processReturn(ctxFor(f.manager), ret([{ invoiceItemId: item.id, quantity: 1, disposition: "RESTOCK" }], { invoiceId: plan.invoiceId }), { now: NEXT_DAY });
    expect(result).toMatchObject({ creditAmount: "1075000.00", appliedToBalance: "575000.00", refundAmount: "500000.00", invoiceStatus: "RETURNED", balance: "0.00" });
    expect(await db.installmentPlan.findFirstOrThrow({ where: { invoiceId: plan.invoiceId } })).toMatchObject({ status: "CANCELLED", nextDueDate: null });
    expect((await db.installmentSchedule.findMany({ where: { plan: { invoiceId: plan.invoiceId } } })).every((r) => r.status === "WAIVED")).toBe(true);
    expect(await db.serializedUnit.findUniqueOrThrow({ where: { id: f.units[1].id } })).toMatchObject({ status: "IN_STOCK" });
  });

  it("links a swap's replacement sale to the return, once, for the same customer and branch", async () => {
    const back = await processReturn(ctxFor(f.manager), ret([{ invoiceItemId: f.phoneItem.id, quantity: 1, disposition: "DEFECTIVE" }]), { now: NEXT_DAY });
    expect(await getSwapContext(ctxFor(f.cashier), back.returnId)).toMatchObject({ number: back.number, customer: { name: "Chioma Eze" }, refundAmount: "1075000.00" });
    const sale = (customerId: string, unitId: string) =>
      checkout(
        ctxFor(f.cashier),
        { customerId, swapReturnId: back.returnId, lines: [{ kind: "unit", unitId }], payment: { type: "FULL", payments: [{ method: "CASH", amount: "1075000" }] } },
        { now: NEXT_DAY },
      );
    await expect(sale(f.other.id, f.units[2].id)).rejects.toThrow("must be for the customer");
    const replacement = await sale(f.customer.id, f.units[2].id);
    expect((await db.return.findUniqueOrThrow({ where: { id: back.returnId } })).replacementInvoiceId).toBe(replacement.invoiceId);
    const [summary] = await listInvoiceReturns(ctxFor(f.manager), f.paid.invoiceId);
    expect(summary).toMatchObject({ replacement: { number: replacement.number }, items: [{ disposition: "DEFECTIVE", identifier: "490154203237518" }] });
    await expect(getSwapContext(ctxFor(f.cashier), back.returnId)).rejects.toBeInstanceOf(ConflictError);
  });
});

const money = (v: string) => Number(v);

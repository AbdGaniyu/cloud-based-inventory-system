import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import type { CheckoutInput } from "@/lib/validators/checkout";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { checkout } from "@/server/services/invoice.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const NOW = new Date("2026-11-17T11:00:00Z"); // 12:00 Lagos
const IMEI = "490154203237518";

async function setup() {
  await resetDatabase();
  const ikeja = await makeBranch({ code: "IKJ" });
  const lekki = await makeBranch({ code: "LEK" });
  const owner = await makeUser("OWNER", null);
  const cashier = await makeUser("CASHIER", ikeja.id);
  const manager = await db.user.create({
    data: { name: "Bola Manager", email: "bola@test.local", passwordHash: await bcrypt.hash("approve-me", 4), role: "BRANCH_MANAGER", branchId: ikeja.id },
  });
  const phone = await makeProduct("SERIALIZED");
  const charger = await makeProduct("NON_SERIALIZED");
  await db.product.update({ where: { id: charger.id }, data: { defaultSellingPrice: "15000.00", defaultCostPrice: "9500.00", warrantyMonths: 3 } });
  const unit = await db.serializedUnit.create({
    data: {
      productId: phone.id,
      imei: IMEI,
      branchId: ikeja.id,
      condition: "BRAND_NEW",
      costPrice: "1150000.00",
      sellingPrice: "1350000.00",
      receivedAt: new Date("2026-10-01T10:00:00Z"),
    },
  });
  await db.branchInventory.create({ data: { productId: charger.id, branchId: ikeja.id, quantity: 10 } });
  const customer = await db.customer.create({ data: { name: "Adaeze Okafor", phoneE164: "+2348031234567" } });
  await db.setting.createMany({
    data: [
      { key: "tax.vatRatePercent", value: "7.50" },
      { key: "installments.approvalThreshold", value: "1000000.00" },
      { key: "installments.minDownPaymentPercent", value: "30" },
      { key: "warranty.defaultTerms", value: "Covers manufacturing defects." },
    ],
  });
  return { ikeja, lekki, owner, cashier, manager, phone, charger, unit, customer };
}
type F = Awaited<ReturnType<typeof setup>>;

function cashSale(f: F, overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    customerId: f.customer.id,
    lines: [
      { kind: "unit", unitId: f.unit.id, discount: "50000" },
      { kind: "accessory", productId: f.charger.id, quantity: 2 },
    ],
    discount: "10000",
    // (1,300,000 + 30,000 − 10,000) × 1.075 = 1,419,000.00
    payment: {
      type: "FULL",
      payments: [
        { method: "POS_CARD", amount: "1000000", reference: "POS-1" },
        { method: "BANK_TRANSFER", amount: "419000", reference: "TRF-9" },
      ],
    },
    ...overrides,
  };
}

describe("checkout — full payment", () => {
  let f: F;
  beforeEach(async () => {
    f = await setup();
  });

  it("creates the invoice, sells stock, records split payments, warranty and audit in one go", async () => {
    const result = await checkout(ctxFor(f.cashier), cashSale(f), { now: NOW });
    expect(result).toMatchObject({ number: "INV-IKJ-000001", total: "1419000.00", amountPaid: "1419000.00", balance: "0.00" });

    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: result.invoiceId }, include: { items: true, payments: true } });
    expect(invoice).toMatchObject({ status: "PAID", paymentType: "FULL", branchId: f.ikeja.id, cashierId: f.cashier.id });
    expect(invoice.subtotal.toFixed(2)).toBe("1330000.00");
    expect(invoice.taxAmount.toFixed(2)).toBe("99000.00");
    expect(invoice.payments.map((p) => [p.kind, p.method, p.amount.toFixed(2)])).toEqual(
      expect.arrayContaining([
        ["CHECKOUT", "POS_CARD", "1000000.00"],
        ["CHECKOUT", "BANK_TRANSFER", "419000.00"],
      ]),
    );
    const phoneLine = invoice.items.find((i) => i.serializedUnitId === f.unit.id);
    expect(phoneLine?.unitCost.toFixed(2)).toBe("1150000.00");
    expect(phoneLine?.lineTotal.toFixed(2)).toBe("1300000.00");

    expect((await db.serializedUnit.findUniqueOrThrow({ where: { id: f.unit.id } })).status).toBe("SOLD");
    const stock = await db.branchInventory.findUniqueOrThrow({ where: { productId_branchId: { productId: f.charger.id, branchId: f.ikeja.id } } });
    expect(stock.quantity).toBe(8);

    const cards = await db.warrantyCard.findMany({ where: { customerId: f.customer.id } });
    expect(cards).toHaveLength(1);
    expect(cards[0].startsAt.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(cards[0].expiresAt.toISOString().slice(0, 10)).toBe("2027-11-16");
    expect(result.warrantyCardIds).toEqual([cards[0].id]);

    expect((await db.auditLog.findMany()).map((a) => a.action)).toEqual(["invoice.checkout"]);
  });

  it("requires the payments to add up exactly to the total", async () => {
    for (const amount of ["418999.99", "419000.01"]) {
      const input = cashSale(f);
      if (input.payment.type === "FULL") input.payment.payments[1].amount = amount;
      await expect(checkout(ctxFor(f.cashier), input, { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await db.invoice.count()).toBe(0);
  });

  it("refuses stock that isn't at the selling branch, and ignores a cashier's branch choice", async () => {
    await db.serializedUnit.update({ where: { id: f.unit.id }, data: { branchId: f.lekki.id } });
    await expect(checkout(ctxFor(f.cashier), cashSale(f, { branchId: f.lekki.id }), { now: NOW })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses more accessories than are on hand", async () => {
    await expect(
      checkout(ctxFor(f.cashier), cashSale(f, { lines: [{ kind: "accessory", productId: f.charger.id, quantity: 11 }] }), { now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("makes the owner pick a branch in all-branches view", async () => {
    await expect(checkout(ctxFor(f.owner, null), cashSale(f), { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    const ok = await checkout(ctxFor(f.owner, null), cashSale(f, { branchId: f.ikeja.id }), { now: NOW });
    expect(ok.number).toBe("INV-IKJ-000001");
  });
});

describe("concurrent IMEI sale (invariant 3)", () => {
  it("lets exactly one of two simultaneous checkouts sell the same unit, without gaps in numbering", async () => {
    const f = await setup();
    const other = await makeUser("CASHIER", f.ikeja.id);
    const sale = (cashierId: typeof f.cashier) =>
      checkout(
        ctxFor(cashierId),
        cashSale(f, {
          lines: [{ kind: "unit", unitId: f.unit.id }],
          discount: undefined,
          payment: { type: "FULL", payments: [{ method: "CASH", amount: "1451250" }] },
        }),
        { now: NOW },
      );
    const results = await Promise.allSettled([sale(f.cashier), sale(other)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected && rejected.status === "rejected" && rejected.reason).toBeInstanceOf(ConflictError);

    expect(await db.invoice.count()).toBe(1);
    expect((await db.branch.findUniqueOrThrow({ where: { id: f.ikeja.id } })).invoiceSequence).toBe(1);
    expect(await db.invoiceItem.count({ where: { serializedUnitId: f.unit.id } })).toBe(1);
  });
});

describe("checkout — installment plans", () => {
  let f: F;
  beforeEach(async () => {
    f = await setup();
  });

  // Phone only: 1,350,000 × 1.075 = 1,451,250.00
  function plan(downPayment: string, extra: Partial<Extract<CheckoutInput["payment"], { type: "INSTALLMENT" }>> = {}): CheckoutInput {
    return {
      customerId: f.customer.id,
      lines: [{ kind: "unit", unitId: f.unit.id }],
      payment: {
        type: "INSTALLMENT",
        downPayments: [{ method: "CASH", amount: downPayment }],
        numberOfInstallments: 3,
        frequency: "MONTHLY",
        firstDueDate: "2026-12-17",
        guarantorName: "Obinna Eze",
        guarantorPhone: "0809 111 2233",
        ...extra,
      },
    };
  }

  it("creates the plan, schedule and down payment; the last row absorbs rounding", async () => {
    const result = await checkout(ctxFor(f.cashier), plan("500000"), { now: NOW });
    expect(result).toMatchObject({ amountPaid: "500000.00", balance: "951250.00", nextDueDate: "2026-12-17" });
    const invoice = await db.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { installmentPlan: { include: { schedule: { orderBy: { sequence: "asc" } } } }, payments: true },
    });
    expect(invoice).toMatchObject({ status: "PARTIALLY_PAID", paymentType: "INSTALLMENT" });
    expect(invoice.payments.map((p) => p.kind)).toEqual(["DOWN_PAYMENT"]);
    const p = invoice.installmentPlan;
    expect(p).toMatchObject({ status: "ACTIVE", numberOfInstallments: 3, frequency: "MONTHLY", requiresApproval: false, guarantorPhone: "+2348091112233" });
    expect(p?.schedule.map((r) => [r.dueDate.toISOString().slice(0, 10), r.amountDue.toFixed(2)])).toEqual([
      ["2026-12-17", "317083.33"],
      ["2027-01-17", "317083.33"],
      ["2027-02-17", "317083.34"],
    ]);
  });

  it("blocks a cashier's plan that needs approval until a manager signs in to approve", async () => {
    // Down payment below 30% → approval needed.
    await expect(checkout(ctxFor(f.cashier), plan("100000"), { now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      checkout(ctxFor(f.cashier), plan("100000", { approver: { email: "bola@test.local", password: "wrong" } }), { now: NOW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await checkout(ctxFor(f.cashier), plan("100000", { approver: { email: "bola@test.local", password: "approve-me" } }), { now: NOW });
    const saved = await db.installmentPlan.findFirstOrThrow({ where: { invoiceId: ok.invoiceId } });
    expect(saved).toMatchObject({ requiresApproval: true, approvedById: f.manager.id });
  });

  it("lets a manager approve their own sale", async () => {
    const ok = await checkout(ctxFor(f.manager), plan("100000"), { now: NOW });
    const saved = await db.installmentPlan.findFirstOrThrow({ where: { invoiceId: ok.invoiceId } });
    expect(saved).toMatchObject({ requiresApproval: true, approvedById: f.manager.id });
  });

  it("rejects first due dates that are not in the future and down payments that cover everything", async () => {
    await expect(checkout(ctxFor(f.cashier), plan("500000", { firstDueDate: "2026-11-17" }), { now: NOW })).rejects.toBeInstanceOf(ValidationError);
    await expect(checkout(ctxFor(f.cashier), plan("1451250"), { now: NOW })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("checkout — trade-in", () => {
  it("deducts the credit and books the device into stock as TRADED_IN", async () => {
    const f = await setup();
    const result = await checkout(
      ctxFor(f.cashier),
      {
        customerId: f.customer.id,
        lines: [{ kind: "unit", unitId: f.unit.id }],
        tradeIn: {
          description: "iPhone 11 64GB, scratched",
          identifier: "356938035643809",
          condition: "UK_USED",
          creditAmount: "150000",
          addToStock: true,
          productId: f.phone.id,
        },
        payment: { type: "FULL", payments: [{ method: "CASH", amount: "1301250" }] },
      },
      { now: NOW },
    );
    expect(result.total).toBe("1301250.00");
    const tradeIn = await db.tradeIn.findFirstOrThrow({ include: { serializedUnit: true } });
    expect(tradeIn.creditAmount.toFixed(2)).toBe("150000.00");
    expect(tradeIn.serializedUnit).toMatchObject({ status: "TRADED_IN", imei: "356938035643809", branchId: f.ikeja.id });
  });
});

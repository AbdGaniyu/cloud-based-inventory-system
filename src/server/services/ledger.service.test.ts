import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { checkout } from "@/server/services/invoice.service";
import {
  getPaymentContext,
  listReceivables,
  recordCustomerPayment,
  reverseCustomerPayment,
  setPlanReminders,
  waiveDebt,
} from "@/server/services/ledger.service";
import { queuePaymentConfirmation } from "@/server/services/message.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const SALE_TIME = new Date("2026-11-17T11:00:00Z");
const LATER = new Date("2026-11-20T10:00:00Z");

describe("receivables ledger", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const lekCashier = await makeUser("CASHIER", lekki.id);
    const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const lekManager = await makeUser("BRANCH_MANAGER", lekki.id);
    const owner = await makeUser("OWNER", null);
    const phone = await makeProduct("SERIALIZED");
    const unit = await db.serializedUnit.create({
      data: { productId: phone.id, imei: "490154203237518", branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "1500000", sellingPrice: "2000000", receivedAt: SALE_TIME },
    });
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });
    await db.messageTemplate.create({
      data: { key: "payment_confirmation", name: "Payment", body: "Hi {{customer_name}}, we received {{amount_paid}} for {{invoice_number}} at {{branch_name}}. Balance: {{balance_remaining}}." },
    });
    // Total 2,150,000 (VAT 7.5%), 500,000 down, 3 × 550,000 monthly from 17 Dec.
    const sale = await checkout(
      ctxFor(cashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: unit.id }],
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "500000" }], numberOfInstallments: 3, frequency: "MONTHLY", firstDueDate: "2026-12-17" },
      },
      { now: SALE_TIME },
    );
    return { ikeja, lekki, cashier, lekCashier, manager, lekManager, owner, sale };
  }

  const schedule = async () =>
    (await db.installmentSchedule.findMany({ where: { plan: { invoiceId: f.sale.invoiceId } }, orderBy: { sequence: "asc" } })).map(
      (r) => `${r.amountPaid.toFixed(2)}/${r.amountWaived.toFixed(2)}:${r.status}`,
    );
  const invoice = () => db.invoice.findUniqueOrThrow({ where: { id: f.sale.invoiceId }, include: { installmentPlan: true } });
  const pay = (ctx = ctxFor(f.cashier), amount = "600000", now = LATER) =>
    recordCustomerPayment(ctx, { invoiceId: f.sale.invoiceId, amount, method: "BANK_TRANSFER", reference: "TRF-1" }, { now });

  beforeEach(async () => {
    f = await setup();
  });

  it("records a repayment at the collecting branch, oldest instalment first, and confirms it", async () => {
    const result = await pay(ctxFor(f.lekCashier));
    expect(result).toMatchObject({ balance: "1050000.00", status: "PARTIALLY_PAID", nextDueDate: "2027-01-17", settledSequences: [1], planCompleted: false });
    expect(await schedule()).toEqual(["550000.00/0.00:PAID", "50000.00/0.00:PARTIAL", "0.00/0.00:PENDING"]);
    const payment = await db.customerPayment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment).toMatchObject({ branchId: f.lekki.id, kind: "INSTALLMENT", receivedById: f.lekCashier.id });
    expect((await invoice()).installmentPlan?.nextDueDate?.toISOString().slice(0, 10)).toBe("2027-01-17");
    expect(await db.auditLog.count({ where: { action: "payment.record", entityId: result.paymentId } })).toBe(1);

    const message = await queuePaymentConfirmation(result.paymentId, f.lekCashier.id);
    const row = await db.notificationLog.findUniqueOrThrow({ where: { id: message?.id } });
    expect(row.body).toBe(`Hi Chioma, we received NGN 600,000.00 for ${f.sale.number} at ${f.lekki.name}. Balance: NGN 1,050,000.00.`);
  });

  it("rejects more than the balance and payments on a settled invoice", async () => {
    await expect(pay(undefined, "1650000.01")).rejects.toBeInstanceOf(ValidationError);
    const done = await pay(undefined, "1650000");
    expect(done).toMatchObject({ status: "PAID", balance: "0.00", nextDueDate: null, planCompleted: true, settledSequences: [1, 2, 3] });
    expect((await invoice()).installmentPlan).toMatchObject({ status: "COMPLETED", nextDueDate: null });
    await expect(pay(undefined, "1")).rejects.toBeInstanceOf(ConflictError);
  });

  it("serialises concurrent payments so the balance can never go negative", async () => {
    const results = await Promise.allSettled([pay(undefined, "1000000"), pay(ctxFor(f.lekCashier), "1000000")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(ValidationError) });
    expect((await invoice()).balance.toFixed(2)).toBe("650000.00");
  });

  it("marks instalments overdue once their date has passed", async () => {
    await pay(undefined, "100000", new Date("2026-12-20T10:00:00Z"));
    expect(await schedule()).toEqual(["100000.00/0.00:OVERDUE", "0.00/0.00:PENDING", "0.00/0.00:PENDING"]);
  });

  it("lets only the owner reverse a payment, once, restoring the balance and the plan", async () => {
    const full = await pay(undefined, "1650000");
    const input = { paymentId: full.paymentId, reason: "Transfer bounced" };
    await expect(reverseCustomerPayment(ctxFor(f.manager), input)).rejects.toBeInstanceOf(ForbiddenError);
    const after = await reverseCustomerPayment(ctxFor(f.owner), input, { now: LATER });
    expect(after).toMatchObject({ balance: "1650000.00", status: "PARTIALLY_PAID", nextDueDate: "2026-12-17" });
    expect(await schedule()).toEqual(["0.00/0.00:PENDING", "0.00/0.00:PENDING", "0.00/0.00:PENDING"]);
    expect((await invoice()).installmentPlan?.status).toBe("ACTIVE");
    expect(await db.customerPayment.findFirstOrThrow({ where: { reversalOfId: full.paymentId } })).toMatchObject({ notes: "Transfer bounced" });
    await expect(reverseCustomerPayment(ctxFor(f.owner), input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets only the owner waive debt; waivers settle the newest instalments", async () => {
    await expect(waiveDebt(ctxFor(f.manager), { invoiceId: f.sale.invoiceId, amount: "550000", reason: "Goodwill" })).rejects.toBeInstanceOf(ForbiddenError);
    const after = await waiveDebt(ctxFor(f.owner), { invoiceId: f.sale.invoiceId, amount: "600000", reason: "Screen fault goodwill" }, { now: LATER });
    expect(after).toMatchObject({ balance: "1050000.00", adjustedAmount: "600000.00" });
    expect(await schedule()).toEqual(["0.00/0.00:PENDING", "0.00/50000.00:PENDING", "0.00/550000.00:WAIVED"]);
    const paid = await pay(undefined, "1050000");
    expect(paid).toMatchObject({ status: "PAID", planCompleted: true });
    expect(await schedule()).toEqual(["550000.00/0.00:PAID", "500000.00/50000.00:PAID", "0.00/550000.00:WAIVED"]);
    await expect(waiveDebt(ctxFor(f.owner), { invoiceId: f.sale.invoiceId, amount: "1", reason: "Too late" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("gives the payment sheet the next instalment as the default amount, from any branch", async () => {
    await pay(undefined, "600000");
    const context = await getPaymentContext(ctxFor(f.lekCashier), f.sale.invoiceId, LATER);
    expect(context).toMatchObject({ balance: "1050000.00", nextAmountDue: "500000.00", installmentPaid: "600000.00", messageChannel: "WHATSAPP" });
    expect(JSON.stringify(context)).not.toContain("1500000");
  });

  it("lists accounts per branch with the ledger summary, and searches every branch", async () => {
    const overdueDay = new Date("2026-12-20T10:00:00Z");
    const list = await listReceivables(ctxFor(f.cashier), {}, overdueDay);
    expect(list.counts).toEqual({ all: 1, due_soon: 0, overdue: 1, completed: 0 });
    expect(list.summary).toEqual({ totalOutstanding: "1650000.00", dueThisWeek: "0.00", overdueAmount: "550000.00", overdueAccounts: 1 });
    expect(list.rows[0]).toMatchObject({ status: "OVERDUE", dueInDays: 3, nextDueDate: "2026-12-17", paidPercent: 23, canView: true, remindersEnabled: true, canManageReminders: false });

    const soon = await listReceivables(ctxFor(f.cashier), { filter: "due_soon" }, new Date("2026-12-12T10:00:00Z"));
    expect(soon.counts.due_soon).toBe(1);
    expect(soon.summary.dueThisWeek).toBe("550000.00");

    expect((await listReceivables(ctxFor(f.lekCashier), {}, overdueDay)).total).toBe(0);
    const found = await listReceivables(ctxFor(f.lekCashier), { q: "chioma" }, overdueDay);
    expect(found).toMatchObject({ total: 1, searchingAllBranches: true });
    expect(found.rows[0]).toMatchObject({ canView: false });
  });

  it("lets managers switch reminders off for their own branch's plans only", async () => {
    await expect(setPlanReminders(ctxFor(f.cashier), { invoiceId: f.sale.invoiceId, enabled: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPlanReminders(ctxFor(f.lekManager), { invoiceId: f.sale.invoiceId, enabled: false })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await setPlanReminders(ctxFor(f.manager), { invoiceId: f.sale.invoiceId, enabled: false })).toBe(false);
    expect((await invoice()).installmentPlan?.remindersEnabled).toBe(false);
    expect(await db.auditLog.count({ where: { action: "plan.reminders" } })).toBe(1);
  });
});

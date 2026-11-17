import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { isAuthorizedCron } from "@/server/jobs/cron";
import { runInstallmentReminders, runOverdueEscalation } from "@/server/jobs/installment-reminders";
import { GAVE_UP_ERROR, runNotificationRetry } from "@/server/jobs/retry-notifications";
import { runStockAlerts } from "@/server/jobs/stock-alerts";
import { deliverMessage, queueMessage } from "@/server/notifications";
import type { Providers } from "@/server/notifications/providers";
import { consoleProvider } from "@/server/notifications/providers/console";
import { type MessageProvider, ProviderError } from "@/server/notifications/providers/types";
import { checkout } from "@/server/services/invoice.service";
import { recordCustomerPayment, setPlanReminders } from "@/server/services/ledger.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const SALE_TIME = new Date("2026-11-17T11:00:00Z");
/** 08:00 in Lagos on a calendar day. */
const at = (day: string) => new Date(`${day}T07:00:00Z`);
const ok: Providers = { whatsapp: consoleProvider("WHATSAPP"), sms: consoleProvider("SMS") };

function failing(channel: "WHATSAPP" | "SMS"): MessageProvider {
  return {
    name: "fail",
    channel,
    async send() {
      throw new ProviderError("Provider down");
    },
  };
}

const TEMPLATE_KEYS = ["installment_due_3d", "installment_due_today", "installment_overdue_1d", "installment_overdue_7d", "installment_overdue_14d"];

async function setupPlan() {
  await resetDatabase();
  const ikeja = await makeBranch({ code: "IKJ" });
  const cashier = await makeUser("CASHIER", ikeja.id);
  const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
  const phone = await makeProduct("SERIALIZED");
  const unit = await db.serializedUnit.create({
    data: { productId: phone.id, imei: "490154203237518", branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "1500000", sellingPrice: "2000000", receivedAt: SALE_TIME },
  });
  const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
  await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });
  await db.messageTemplate.createMany({
    data: TEMPLATE_KEYS.map((key) => ({ key, name: key, body: `[${key}] Hi {{customer_name}}, {{amount_due}} on {{invoice_number}} due {{due_date}}.` })),
  });
  // 3 × 550,000 monthly from 17 Dec 2026.
  const sale = await checkout(
    ctxFor(cashier),
    {
      customerId: customer.id,
      lines: [{ kind: "unit", unitId: unit.id }],
      payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "500000" }], numberOfInstallments: 3, frequency: "MONTHLY", firstDueDate: "2026-12-17" },
    },
    { now: SALE_TIME },
  );
  return { ikeja, cashier, manager, customer, sale };
}

const keys = async () => (await db.notificationLog.findMany({ orderBy: { createdAt: "asc" } })).map((n) => n.templateKey);

describe("instalment reminder jobs", () => {
  let f: Awaited<ReturnType<typeof setupPlan>>;
  beforeEach(async () => {
    f = await setupPlan();
  });

  it("sends the 3-day reminder once, even when the job runs twice", async () => {
    const first = await runInstallmentReminders({ now: at("2026-12-14"), providers: ok });
    expect(first).toMatchObject({ candidates: 1, queued: 1, delivered: 1 });
    const again = await runInstallmentReminders({ now: at("2026-12-14"), providers: ok });
    expect(again).toMatchObject({ candidates: 1, queued: 0, alreadyQueued: 1 });
    const [row] = await db.notificationLog.findMany();
    expect(row).toMatchObject({ templateKey: "installment_due_3d", status: "SENT" });
    expect(row.dedupeKey).toMatch(/^installment_due_3d:[0-9a-f-]{36}:-3$/);
    expect(row.body).toBe(`[installment_due_3d] Hi Chioma, NGN 550,000.00 on ${f.sale.number} due 17 Dec 2026.`);
  });

  it("catches up a missed 3-day reminder, but never sends 'due today' late", async () => {
    await runInstallmentReminders({ now: at("2026-12-16"), providers: ok });
    expect(await keys()).toEqual(["installment_due_3d"]);
    await runInstallmentReminders({ now: at("2026-12-17"), providers: ok });
    expect(await keys()).toEqual(["installment_due_3d", "installment_due_today"]);
    await runInstallmentReminders({ now: at("2026-12-18"), providers: ok });
    expect(await keys()).toHaveLength(2);
  });

  it("skips settled instalments and plans with reminders switched off", async () => {
    await recordCustomerPayment(ctxFor(f.cashier), { invoiceId: f.sale.invoiceId, amount: "550000", method: "CASH" }, { now: at("2026-12-10") });
    expect(await runInstallmentReminders({ now: at("2026-12-14"), providers: ok })).toMatchObject({ candidates: 0 });
    await setPlanReminders(ctxFor(f.manager), { invoiceId: f.sale.invoiceId, enabled: false });
    expect(await runInstallmentReminders({ now: at("2027-01-14"), providers: ok })).toMatchObject({ candidates: 0 });
    expect(await db.notificationLog.count()).toBe(0);
  });

  it("marks past-due rows overdue (audited) and escalates at 1, 7 and 14 days, catching up a missed run", async () => {
    const day1 = await runOverdueEscalation({ now: at("2026-12-18"), providers: ok });
    expect(day1).toMatchObject({ markedOverdue: 1, queued: 1 });
    expect((await db.installmentSchedule.findFirstOrThrow({ where: { sequence: 1 } })).status).toBe("OVERDUE");
    expect(await db.auditLog.count({ where: { action: "job.markOverdue" } })).toBe(1);

    expect(await runOverdueEscalation({ now: at("2026-12-18"), providers: ok })).toMatchObject({ markedOverdue: 0, queued: 0, alreadyQueued: 1 });
    expect(await runOverdueEscalation({ now: at("2026-12-22"), providers: ok })).toMatchObject({ candidates: 0 });
    await runOverdueEscalation({ now: at("2026-12-26"), providers: ok });
    await runOverdueEscalation({ now: at("2026-12-31"), providers: ok });
    expect(await keys()).toEqual(["installment_overdue_1d", "installment_overdue_7d", "installment_overdue_14d"]);
  });
});

describe("stock alert job", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("opens, refreshes, resolves and reopens alerts as conditions change", async () => {
    const branch = await makeBranch({ code: "IKJ" });
    const cable = await makeProduct("NON_SERIALIZED", { reorderLevel: 5 });
    const phone = await makeProduct("SERIALIZED");
    await db.branchInventory.create({ data: { branchId: branch.id, productId: cable.id, quantity: 2 } });
    await db.serializedUnit.create({
      data: { productId: phone.id, imei: "490154203237518", branchId: branch.id, condition: "UK_USED", costPrice: "1", sellingPrice: "2", receivedAt: new Date("2026-09-01T10:00:00Z") },
    });
    const now = new Date("2026-11-17T06:00:00Z");

    expect(await runStockAlerts({ now })).toEqual({ lowStock: 1, aging: 1, opened: 2, resolved: 0 });
    expect(await runStockAlerts({ now })).toEqual({ lowStock: 1, aging: 1, opened: 0, resolved: 0 });
    expect(await db.stockAlert.findFirstOrThrow({ where: { type: "AGING" } })).toMatchObject({ value: 76, threshold: 60 });

    await db.branchInventory.updateMany({ data: { quantity: 10 } });
    expect(await runStockAlerts({ now })).toMatchObject({ lowStock: 0, resolved: 1 });
    await db.branchInventory.updateMany({ data: { quantity: 1 } });
    expect(await runStockAlerts({ now })).toMatchObject({ lowStock: 1, opened: 1 });
    expect(await db.stockAlert.count()).toBe(2);
    expect(await db.stockAlert.findFirstOrThrow({ where: { type: "LOW_STOCK" } })).toMatchObject({ resolvedAt: null, value: 1 });
  });
});

describe("notification retry job", () => {
  let customerId: string;
  const T0 = new Date("2026-11-17T10:00:00Z");
  const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

  async function failedMessage(dedupeKey: string, smsOptIn = false) {
    await db.customer.update({ where: { id: customerId }, data: { smsOptIn } });
    const queued = await queueMessage({ templateKey: "receipt", customerId, dedupeKey, variables: { customer_name: "Ada" } }, { now: T0 });
    await deliverMessage(queued?.id ?? "", { now: T0, providers: { whatsapp: failing("WHATSAPP"), sms: smsOptIn ? ok.sms : failing("SMS") } });
    return queued?.id ?? "";
  }

  beforeEach(async () => {
    await resetDatabase();
    customerId = (await db.customer.create({ data: { name: "Ada Obi", phoneE164: "+2348031234567" } })).id;
    await db.messageTemplate.create({ data: { key: "receipt", name: "Receipt", body: "Hi {{customer_name}}" } });
  });

  it("retries a failed message after a pause, but not one already covered by an SMS fallback", async () => {
    const failed = await failedMessage("receipt:a");
    const covered = await failedMessage("receipt:b", true);
    expect(await runNotificationRetry({ now: later(5), providers: ok })).toMatchObject({ retried: 0 });
    expect(await runNotificationRetry({ now: later(11), providers: ok })).toMatchObject({ retried: 1, sent: 1 });
    expect(await db.notificationLog.findUniqueOrThrow({ where: { id: failed } })).toMatchObject({ status: "SENT", attempts: 2 });
    expect(await db.notificationLog.findUniqueOrThrow({ where: { id: covered } })).toMatchObject({ status: "FAILED", attempts: 1 });
  });

  it("leaves messages older than a day alone and gives up on stuck sends at the attempt limit", async () => {
    await failedMessage("receipt:old");
    expect(await runNotificationRetry({ now: later(25 * 60), providers: ok })).toMatchObject({ retried: 0 });

    const stuck = await queueMessage({ templateKey: "receipt", customerId, dedupeKey: "receipt:stuck", variables: {} }, { now: T0 });
    await db.notificationLog.update({ where: { id: stuck?.id }, data: { attempts: 3, lastAttemptAt: T0 } });
    expect(await runNotificationRetry({ now: later(11), providers: ok })).toMatchObject({ gaveUp: 1 });
    expect(await db.notificationLog.findUniqueOrThrow({ where: { id: stuck?.id } })).toMatchObject({ status: "FAILED", error: GAVE_UP_ERROR });
  });

  it("sends messages that were queued but never attempted", async () => {
    const queued = await queueMessage({ templateKey: "receipt", customerId, dedupeKey: "receipt:never", variables: {} }, { now: T0 });
    expect(await runNotificationRetry({ now: later(11), providers: ok })).toMatchObject({ retried: 1, sent: 1 });
    expect((await db.notificationLog.findUniqueOrThrow({ where: { id: queued?.id } })).status).toBe("SENT");
  });
});

describe("cron authorisation", () => {
  it("accepts only the exact bearer secret", () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cret-value";
    const req = (header?: string) => new Request("http://x/api/cron/stock-alerts", { headers: header ? { authorization: header } : {} });
    expect(isAuthorizedCron(req("Bearer s3cret-value"))).toBe(true);
    expect(isAuthorizedCron(req("Bearer s3cret-valuE"))).toBe(false);
    expect(isAuthorizedCron(req("s3cret-value"))).toBe(false);
    expect(isAuthorizedCron(req())).toBe(false);
    process.env.CRON_SECRET = "";
    expect(isAuthorizedCron(req("Bearer "))).toBe(false);
    process.env.CRON_SECRET = previous;
  });
});

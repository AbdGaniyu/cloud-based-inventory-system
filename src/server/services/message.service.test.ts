import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { deliverMessages } from "@/server/notifications";
import type { Providers } from "@/server/notifications/providers";
import { consoleProvider } from "@/server/notifications/providers/console";
import { checkout } from "@/server/services/invoice.service";
import { listInvoiceMessages, queueCheckoutMessages, resendMessage, sendInvoiceReminder } from "@/server/services/message.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const SALE_TIME = new Date("2026-11-17T11:00:00Z");
const providers: Providers = { whatsapp: consoleProvider("WHATSAPP"), sms: consoleProvider("SMS") };

describe("customer messages", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const lekCashier = await makeUser("CASHIER", lekki.id);
    const phone = await makeProduct("SERIALIZED");
    const units = await Promise.all(
      ["490154203237518", "356938035643809"].map((imei) =>
        db.serializedUnit.create({
          data: { productId: phone.id, imei, branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "800000", sellingPrice: "1000000", receivedAt: SALE_TIME },
        }),
      ),
    );
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    await db.setting.createMany({
      data: [
        { key: "installments.approvalThreshold", value: "5000000" },
        { key: "installments.minDownPaymentPercent", value: "10" },
        { key: "payments.instructions", value: "Transfer to Zenith 1012345678." },
      ],
    });
    await db.messageTemplate.createMany({
      data: [
        { key: "receipt", name: "Receipt", body: "Hi {{customer_name}}, invoice {{invoice_number}}: {{invoice_total}}.", smsBody: "Receipt {{invoice_number}}: {{document_link}}" },
        { key: "warranty_card", name: "Warranty", body: "{{device_name}} ({{serial_masked}}) covered to {{warranty_expiry}}. {{warranty_link}}" },
        { key: "manual_reminder", name: "Reminder", body: "Hi {{customer_name}}, {{invoice_number}} balance {{balance_remaining}}, next {{amount_due}} on {{due_date}}. {{payment_instructions}}" },
      ],
    });
    const ctx = ctxFor(cashier);
    const sale = await checkout(
      ctx,
      {
        customerId: customer.id,
        lines: units.map((u) => ({ kind: "unit" as const, unitId: u.id })),
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "500000" }], numberOfInstallments: 2, frequency: "MONTHLY", firstDueDate: "2026-12-17" },
      },
      { now: SALE_TIME },
    );
    return { cashier, lekCashier, customer, sale, ctx };
  }

  beforeEach(async () => {
    f = await setup();
  });

  it("queues a receipt with the invoice PDF and one warranty card per device after checkout, once", async () => {
    const queued = await queueCheckoutMessages(f.sale.invoiceId, f.cashier.id, { providers, now: SALE_TIME });
    expect(queued.map((m) => m.templateKey)).toEqual(["receipt", "warranty_card", "warranty_card"]);
    expect(queued.every((m) => m.status === "QUEUED" && m.channel === "WHATSAPP")).toBe(true);

    const receipt = await db.notificationLog.findFirstOrThrow({ where: { templateKey: "receipt" } });
    expect(receipt.body).toBe(`Hi Chioma, invoice ${f.sale.number}: NGN 2,150,000.00.`);
    expect(receipt.mediaUrl).toMatch(new RegExp(`/api/pdf/invoice/${f.sale.invoiceId}\\?exp=\\d+&sig=`));
    const cards = await db.notificationLog.findMany({ where: { templateKey: "warranty_card" }, orderBy: { body: "asc" } });
    expect(cards.map((c) => c.body)).toEqual(expect.arrayContaining([expect.stringContaining("(ending 7518) covered to 16 Nov 2027")]));
    expect(cards[0].mediaUrl).toContain("/api/pdf/warranty/");

    const again = await queueCheckoutMessages(f.sale.invoiceId, f.cashier.id, { providers, now: SALE_TIME });
    expect(again.every((m) => !m.created)).toBe(true);
    expect(await db.notificationLog.count()).toBe(3);
  });

  it("sends a reminder with the next instalment, audited, and treats a double click as one message", async () => {
    const now = new Date("2026-11-20T09:00:00Z");
    const first = await sendInvoiceReminder(f.ctx, f.sale.invoiceId, { providers, now });
    const second = await sendInvoiceReminder(f.ctx, f.sale.invoiceId, { providers, now: new Date("2026-11-20T09:00:30Z") });
    expect(second).toMatchObject({ id: first.id, created: false });
    const row = await db.notificationLog.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.body).toBe(`Hi Chioma, ${f.sale.number} balance NGN 1,650,000.00, next NGN 825,000.00 on 17 Dec 2026. Transfer to Zenith 1012345678.`);
    expect(row.triggeredById).toBe(f.cashier.id);
    expect(await db.auditLog.count({ where: { action: "message.reminder", entityId: first.id } })).toBe(1);
  });

  it("keeps reminders to the invoice's branch and to customers who can be reached", async () => {
    await expect(sendInvoiceReminder(ctxFor(f.lekCashier), f.sale.invoiceId, { providers })).rejects.toBeInstanceOf(ForbiddenError);
    await db.customer.update({ where: { id: f.customer.id }, data: { whatsappOptIn: false, smsOptIn: false } });
    await expect(sendInvoiceReminder(f.ctx, f.sale.invoiceId, { providers })).rejects.toBeInstanceOf(ValidationError);
  });

  it("resends a receipt as a new message with a freshly signed link, starting from the original", async () => {
    const [receipt] = await queueCheckoutMessages(f.sale.invoiceId, f.cashier.id, { providers, now: SALE_TIME });
    await deliverMessages([receipt.id], { providers });
    const later = new Date("2027-08-01T10:00:00Z");
    const resent = await resendMessage(f.ctx, receipt.id, { providers, now: later });
    expect(resent.created).toBe(true);
    const row = await db.notificationLog.findUniqueOrThrow({ where: { id: resent.id } });
    expect(row.dedupeKey).toBe(`resend:${receipt.id}:2027-08-01T10:00`);
    const exp = Number(new URL(row.mediaUrl ?? "").searchParams.get("exp"));
    expect(exp).toBeGreaterThan(later.getTime() / 1000);

    const views = await listInvoiceMessages(f.ctx, f.sale.invoiceId);
    expect(views[0]).toMatchObject({ id: resent.id, label: "Receipt", status: "QUEUED", triggeredByName: f.cashier.name });
    await expect(listInvoiceMessages(ctxFor(f.lekCashier), f.sale.invoiceId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError } from "@/server/errors";
import { createCustomer, searchCustomers } from "@/server/services/customer.service";
import { checkout } from "@/server/services/invoice.service";
import { recordCustomerPayment } from "@/server/services/ledger.service";
import { ERASED_NAME, eraseCustomer, exportCustomerData, recordPrivacyNotice, redactOldMessages } from "@/server/services/privacy.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const NOW = new Date("2026-11-17T11:00:00Z");

describe("customer privacy (NDPA)", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const owner = await makeUser("OWNER", null);
    const phone = await makeProduct("SERIALIZED");
    const unit = await db.serializedUnit.create({
      data: { productId: phone.id, imei: "490154203237518", branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "1500000", sellingPrice: "2000000", receivedAt: NOW },
    });
    await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });
    const customer = await createCustomer(ctxFor(cashier), { name: "Chioma Eze", phone: "0706 345 6789", email: undefined, whatsappOptIn: true, smsOptIn: true, noticeGiven: true });
    // 2,150,000 on instalments with a guarantor; 500,000 down.
    const sale = await checkout(
      ctxFor(cashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: unit.id }],
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "500000" }], numberOfInstallments: 3, frequency: "MONTHLY", firstDueDate: "2026-12-17", guarantorName: "Emeka Obi", guarantorPhone: "08031234567" },
      },
      { now: NOW },
    );
    await db.notificationLog.create({
      data: { customerId: customer.id, invoiceId: sale.invoiceId, templateKey: "receipt", channel: "SMS", provider: "console", to: "+2347063456789", body: "Hi Chioma, thanks for buying", status: "SENT", dedupeKey: "k1", createdAt: NOW },
    });
    return { ikeja, cashier, manager, owner, customer, sale };
  }

  beforeEach(async () => {
    f = await setup();
  });

  it("records who gave the privacy notice when a customer is added, and lets staff record it later", async () => {
    expect(await db.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).toMatchObject({ noticeGivenById: f.cashier.id, noticeGivenAt: expect.any(Date) });
    const older = await db.customer.create({ data: { name: "Old Customer", phoneE164: "+2348031112222" } });
    await recordPrivacyNotice(ctxFor(f.manager), older.id, NOW);
    expect(await db.customer.findUniqueOrThrow({ where: { id: older.id } })).toMatchObject({ noticeGivenAt: NOW, noticeGivenById: f.manager.id });
  });

  it("exports everything held on a customer for the owner only, and audits it", async () => {
    await expect(exportCustomerData(ctxFor(f.manager), f.customer.id)).rejects.toThrow(ForbiddenError);
    const data = await exportCustomerData(ctxFor(f.owner), f.customer.id, NOW);
    expect(data.customer).toMatchObject({ name: "Chioma Eze", phone: "+2347063456789" });
    expect(data.invoices[0]).toMatchObject({ items: [{ imei: "490154203237518" }], instalmentPlan: { guarantorName: "Emeka Obi" } });
    expect(data.payments).toHaveLength(1);
    expect(data.messages[0]).toMatchObject({ text: "Hi Chioma, thanks for buying" });
    expect(await db.auditLog.count({ where: { action: "customer.export", entityId: f.customer.id } })).toBe(1);
  });

  it("refuses to erase while money is owed, then erases personal details but keeps the financial records", async () => {
    const input = { customerId: f.customer.id, reason: "Asked in person at Ikeja" };
    await expect(eraseCustomer(ctxFor(f.manager), input)).rejects.toThrow(ForbiddenError);
    await expect(eraseCustomer(ctxFor(f.owner), input)).rejects.toThrow(ConflictError);

    await recordCustomerPayment(ctxFor(f.cashier), { invoiceId: f.sale.invoiceId, amount: "1650000", method: "BANK_TRANSFER", reference: "TRF" }, { now: NOW });
    await eraseCustomer(ctxFor(f.owner), input, NOW);

    const erased = await db.customer.findUniqueOrThrow({ where: { id: f.customer.id } });
    expect(erased).toMatchObject({ name: ERASED_NAME, email: null, address: null, notes: null, whatsappOptIn: false, smsOptIn: false, erasedAt: NOW });
    expect(erased.phoneE164).toBe(`erased-${f.customer.id}`);
    expect(await db.installmentPlan.findFirstOrThrow({ where: { invoiceId: f.sale.invoiceId } })).toMatchObject({ guarantorName: null, guarantorPhone: null });
    expect(await db.notificationLog.findFirstOrThrow({ where: { customerId: f.customer.id } })).toMatchObject({ to: "[removed]", body: "[removed]", redactedAt: NOW });
    expect(await db.invoice.count({ where: { customerId: f.customer.id } })).toBe(1);
    expect(await db.customerPayment.count({ where: { customerId: f.customer.id } })).toBe(2);
    // Gone from search, by name or by digits that happen to be in the placeholder.
    expect(await searchCustomers(ctxFor(f.cashier), "Chioma")).toEqual([]);
    expect(await searchCustomers(ctxFor(f.cashier), f.customer.id.replace(/\D/g, "").slice(0, 4))).toEqual([]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "customer.erase" } });
    expect(JSON.stringify(audit.after)).not.toContain("Chioma");
    await expect(eraseCustomer(ctxFor(f.owner), input)).rejects.toThrow(/already erased/);
  });

  it("removes message texts once they pass the retention period", async () => {
    expect(await redactOldMessages(new Date("2027-06-01T00:00:00Z"))).toBe(0);
    expect(await redactOldMessages(new Date("2027-11-18T00:00:00Z"))).toBe(1);
    expect(await db.notificationLog.findFirstOrThrow()).toMatchObject({ body: "[removed]", to: "[removed]" });
    await db.setting.create({ data: { key: "privacy.messageRetentionDays", value: 30 } });
    await db.notificationLog.create({ data: { customerId: f.customer.id, templateKey: "receipt", channel: "SMS", provider: "console", to: "+234", body: "x", status: "SENT", dedupeKey: "k2", createdAt: NOW } });
    expect(await redactOldMessages(new Date("2026-12-20T00:00:00Z"))).toBe(1);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { getCustomerProfile, listCustomers, updateCustomerPreferences } from "@/server/services/customer.service";
import { checkout } from "@/server/services/invoice.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const SALE_TIME = new Date("2026-11-17T11:00:00Z");

describe("customer profiles", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const lekCashier = await makeUser("CASHIER", lekki.id);
    const phone = await makeProduct("SERIALIZED");
    const unit = await db.serializedUnit.create({
      data: { productId: phone.id, imei: "490154203237518", branchId: ikeja.id, condition: "UK_USED", costPrice: "700000", sellingPrice: "1000000", receivedAt: SALE_TIME },
    });
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    await db.customer.create({ data: { name: "Bisi Akande", phoneE164: "+2347084561190" } });
    await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });
    const sale = await checkout(
      ctxFor(cashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: unit.id }],
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "275000" }], numberOfInstallments: 2, frequency: "MONTHLY", firstDueDate: "2026-12-17" },
      },
      { now: SALE_TIME },
    );
    return { cashier, lekCashier, customer, sale };
  }

  beforeEach(async () => {
    f = await setup();
  });

  it("lists customers with what they owe across branches, and filters to those owing", async () => {
    const all = await listCustomers(ctxFor(f.lekCashier), {});
    expect(all.rows.map((r) => [r.name, r.outstanding, r.invoiceCount])).toEqual([
      ["Bisi Akande", "0.00", 0],
      ["Chioma Eze", "800000.00", 1],
    ]);
    const owing = await listCustomers(ctxFor(f.lekCashier), { owing: true });
    expect(owing).toMatchObject({ total: 1, owingCount: 1 });
    expect((await listCustomers(ctxFor(f.cashier), { q: "0708" })).rows.map((r) => r.name)).toEqual(["Bisi Akande"]);
  });

  it("shows plans, purchases and warranties, with invoice links only for the selling branch", async () => {
    const profile = await getCustomerProfile(ctxFor(f.lekCashier), f.customer.id, new Date("2026-12-20T10:00:00Z"));
    expect(profile).toMatchObject({ lifetimeSpend: "1075000.00", outstanding: "800000.00" });
    expect(profile.plans[0]).toMatchObject({ number: f.sale.number, paidPercent: 25, overdue: true, nextDueDate: "2026-12-17", canView: false });
    expect(profile.purchases[0]).toMatchObject({ number: f.sale.number, status: "PARTIALLY_PAID", canView: false });
    expect(profile.warranties[0]).toMatchObject({ identifier: "490154203237518", status: "ACTIVE" });
    expect(JSON.stringify(profile)).not.toContain("700000");
    expect((await getCustomerProfile(ctxFor(f.cashier), f.customer.id)).plans[0].canView).toBe(true);
  });

  it("saves message opt-ins and notes with an audit row", async () => {
    await updateCustomerPreferences(ctxFor(f.cashier), { customerId: f.customer.id, whatsappOptIn: false, smsOptIn: true, notes: "Call after 5pm" });
    expect(await db.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).toMatchObject({ whatsappOptIn: false, smsOptIn: true, notes: "Call after 5pm" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "customer.update" } });
    expect(audit.before).toMatchObject({ whatsappOptIn: true });
    expect(audit.after).toMatchObject({ whatsappOptIn: false });
  });
});

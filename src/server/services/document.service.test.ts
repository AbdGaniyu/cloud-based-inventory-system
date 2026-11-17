import { beforeAll, describe, expect, it } from "vitest";

import { parseCalendarDate } from "@/lib/dates";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { getInvoiceDocument, getPublicWarranty, loadInvoiceDocument, maskIdentifier } from "@/server/services/document.service";
import { checkout } from "@/server/services/invoice.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

const SALE_TIME = new Date("2026-11-17T11:00:00Z");

describe("documents", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const lekCashier = await makeUser("CASHIER", lekki.id);
    const phone = await makeProduct("SERIALIZED");
    const unit = await db.serializedUnit.create({
      data: { productId: phone.id, imei: "490154203237518", branchId: ikeja.id, condition: "BRAND_NEW", costPrice: "800000", sellingPrice: "1000000", receivedAt: SALE_TIME },
    });
    const customer = await db.customer.create({ data: { name: "Chioma Eze", phoneE164: "+2347063456789" } });
    await db.setting.createMany({ data: [{ key: "installments.approvalThreshold", value: "5000000" }, { key: "installments.minDownPaymentPercent", value: "10" }] });
    const sale = await checkout(
      ctxFor(cashier),
      {
        customerId: customer.id,
        lines: [{ kind: "unit", unitId: unit.id }],
        payment: { type: "INSTALLMENT", downPayments: [{ method: "CASH", amount: "200000" }], numberOfInstallments: 2, frequency: "MONTHLY", firstDueDate: "2026-12-17" },
      },
      { now: SALE_TIME },
    );
    const card = await db.warrantyCard.findFirstOrThrow();
    return { cashier, lekCashier, sale, card };
  }

  beforeAll(async () => {
    f = await setup();
  });

  it("public warranty page shows device facts with the IMEI masked and no customer data", async () => {
    const view = await getPublicWarranty(f.card.publicId, parseCalendarDate("2026-12-01"));
    expect(view).toMatchObject({ status: "ACTIVE", maskedIdentifier: "•••••••••••7518", purchasedOn: "2026-11-17", expiresAt: "2027-11-16" });
    const json = JSON.stringify(view);
    expect(json).not.toContain("Chioma");
    expect(json).not.toContain("490154203237518");
    expect(json).not.toContain("+234");
  });

  it("derives expired status from the date, and returns null for unknown or malformed IDs", async () => {
    expect((await getPublicWarranty(f.card.publicId, parseCalendarDate("2027-11-17")))?.status).toBe("EXPIRED");
    expect(await getPublicWarranty("doesNotExist1")).toBeNull();
    expect(await getPublicWarranty("../etc")).toBeNull();
  });

  it("shows an invoice as Overdue once an instalment passes its due date unpaid", async () => {
    expect((await loadInvoiceDocument(f.sale.invoiceId, parseCalendarDate("2026-12-01"))).displayStatus).toBe("PARTIALLY_PAID");
    const later = await loadInvoiceDocument(f.sale.invoiceId, parseCalendarDate("2026-12-20"));
    expect(later.displayStatus).toBe("OVERDUE");
    expect(later.plan?.schedule.map((r) => r.status)).toEqual(["OVERDUE", "PENDING"]);
    expect(JSON.stringify(later)).not.toContain("800000");
  });

  it("keeps staff to their own branch's invoices", async () => {
    await expect(getInvoiceDocument(ctxFor(f.lekCashier), f.sale.invoiceId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getInvoiceDocument(ctxFor(f.cashier), f.sale.invoiceId)).number).toBe(f.sale.number);
  });

  it("masks short and long identifiers to their last four characters", () => {
    expect(maskIdentifier("ABC")).toBe("ABC");
    expect(maskIdentifier("FVFHM3MBA0A1")).toBe("••••••••A0A1");
  });
});

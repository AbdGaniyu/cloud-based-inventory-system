import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { checkout } from "@/server/services/invoice.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

import { verifyLedger } from "./verify-ledger";

const NOW = new Date("2026-11-17T11:00:00Z");

describe("ledger integrity check", () => {
  beforeEach(async () => {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const charger = await makeProduct("NON_SERIALIZED");
    await db.product.update({ where: { id: charger.id }, data: { defaultSellingPrice: "15000" } });
    await db.branchInventory.create({ data: { branchId: ikeja.id, productId: charger.id, quantity: 5 } });
    const customer = await db.customer.create({ data: { name: "Ada", phoneE164: "+2348031234567" } });
    await checkout(ctxFor(cashier), { customerId: customer.id, lines: [{ kind: "accessory", productId: charger.id, quantity: 1 }], payment: { type: "FULL", payments: [{ method: "CASH", amount: "16125" }] } }, { now: NOW });
  });

  const failures = async () => (await verifyLedger(process.env.DATABASE_URL ?? "")).filter((r) => r.problems > 0).map((r) => r.name);

  it("passes on a consistent database and names what's wrong when it isn't", async () => {
    expect(await failures()).toEqual([]);
    await db.branchInventory.updateMany({ data: { reservedQuantity: 3 } });
    await db.$executeRawUnsafe(`UPDATE branches SET invoice_sequence = 0`);
    expect(await failures()).toEqual(["In-transit accessory quantities match open transfers", "Invoice numbers are gapless per branch"]);
  });
});

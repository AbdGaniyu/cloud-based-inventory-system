import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { searchCustomers } from "@/server/services/customer.service";
import { searchCatalog } from "@/server/services/pos.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

describe("POS catalog", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ", name: "Ikeja" });
    const lekki = await makeBranch({ code: "LEK", name: "Lekki" });
    const cashier = await makeUser("CASHIER", ikeja.id);
    const phone = await makeProduct("SERIALIZED");
    const unit = (imei: string, branchId: string) =>
      db.serializedUnit.create({
        data: { productId: phone.id, imei, branchId, condition: "BRAND_NEW", costPrice: "777777.00", sellingPrice: "999999.00", receivedAt: new Date() },
      });
    await unit("490154203237518", ikeja.id);
    await unit("356938035643809", lekki.id);
    await unit("356938035643817", lekki.id);
    await db.customer.create({ data: { name: "Adaeze Okafor", phoneE164: "+2348031234567" } });
    return { ikeja, lekki, cashier, phone };
  }

  beforeAll(async () => {
    f = await setup();
  });

  it("never returns cost, and shows other branches as counts without IMEIs", async () => {
    const catalog = await searchCatalog(ctxFor(f.cashier), { branchId: f.ikeja.id, q: "Product" });
    const json = JSON.stringify(catalog);
    expect(json).not.toContain("777777");
    expect(json).not.toContain("356938035643809");
    expect(catalog.units.map((u) => u.identifier)).toEqual(["490154203237518"]);
    expect(catalog.elsewhere).toEqual([expect.objectContaining({ branchName: "Lekki", count: 2 })]);
  });

  it("flags an exact IMEI scan so the screen can add it straight to the cart", async () => {
    const catalog = await searchCatalog(ctxFor(f.cashier), { branchId: f.ikeja.id, q: "490154203237518" });
    expect(catalog.exact).toEqual({ kind: "unit", id: catalog.units[0].id });
  });

  it("refuses a cashier searching another branch's shelf", async () => {
    await expect(searchCatalog(ctxFor(f.cashier), { branchId: f.lekki.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("finds customers by local phone format and by name", async () => {
    expect((await searchCustomers(ctxFor(f.cashier), "0803 123")).map((c) => c.name)).toEqual(["Adaeze Okafor"]);
    expect((await searchCustomers(ctxFor(f.cashier), "adaeze")).map((c) => c.name)).toEqual(["Adaeze Okafor"]);
  });
});

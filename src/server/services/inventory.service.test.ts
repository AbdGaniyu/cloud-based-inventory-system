import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { acceptTradeIn } from "@/server/services/inventory.service";
import { ctxFor, makeBranch, makeProduct, makeUser, resetDatabase } from "@/test/db";

describe("acceptTradeIn", () => {
  let fixture: Awaited<ReturnType<typeof setup>>;
  async function setup() {
    await resetDatabase();
    const branch = await makeBranch();
    const owner = await makeUser("OWNER", null);
    const manager = await makeUser("BRANCH_MANAGER", branch.id);
    const product = await makeProduct("SERIALIZED");
    const unit = await db.serializedUnit.create({
      data: { productId: product.id, imei: "356938035643809", branchId: branch.id, condition: "UK_USED", costPrice: "150000", sellingPrice: "150000", status: "TRADED_IN", receivedAt: new Date() },
    });
    return { owner, manager, unit };
  }
  beforeEach(async () => {
    fixture = await setup();
  });

  it("lets the owner price the device and release it into stock, with an audit row", async () => {
    await acceptTradeIn(ctxFor(fixture.owner, null), { unitId: fixture.unit.id, condition: "REFURBISHED", batteryHealth: 82, sellingPrice: "230000" });
    const unit = await db.serializedUnit.findUniqueOrThrow({ where: { id: fixture.unit.id } });
    expect(unit).toMatchObject({ status: "IN_STOCK", condition: "REFURBISHED", batteryHealth: 82 });
    expect(unit.sellingPrice.toFixed(2)).toBe("230000.00");
    expect(unit.costPrice.toFixed(2)).toBe("150000.00");
    expect((await db.auditLog.findMany()).map((a) => a.action)).toEqual(["unit.acceptTradeIn"]);
  });

  it("is owner-only and only for traded-in devices", async () => {
    const input = { unitId: fixture.unit.id, condition: "UK_USED" as const, batteryHealth: null, sellingPrice: "200000" };
    await expect(acceptTradeIn(ctxFor(fixture.manager), input)).rejects.toBeInstanceOf(ForbiddenError);
    await acceptTradeIn(ctxFor(fixture.owner, null), input);
    await expect(acceptTradeIn(ctxFor(fixture.owner, null), input)).rejects.toBeInstanceOf(ValidationError);
  });
});

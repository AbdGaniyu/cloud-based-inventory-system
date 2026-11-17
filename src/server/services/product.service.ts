import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { toDb } from "@/lib/money";
import type { ProductInput } from "@/lib/validators/product";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";

function toData(input: ProductInput) {
  return {
    name: input.name,
    brand: input.brand,
    category: input.category,
    trackingType: input.trackingType,
    sku: input.sku,
    barcode: input.barcode ?? null,
    defaultCostPrice: toDb(input.defaultCostPrice),
    defaultSellingPrice: toDb(input.defaultSellingPrice),
    warrantyMonths: input.warrantyMonths,
    reorderLevel: input.reorderLevel,
    isActive: input.isActive,
  };
}

function uniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = JSON.stringify(error.meta ?? {});
    if (target.includes("barcode")) throw new ValidationError("Another product already uses this barcode.", { barcode: ["Already in use"] });
    throw new ValidationError("Another product already uses this SKU.", { sku: ["Already in use"] });
  }
  throw error;
}

/** Owner only (CLAUDE.md §8 "Edit prices"). */
export async function createProduct(ctx: Ctx, input: ProductInput): Promise<{ id: string }> {
  assertCan(ctx, "price.edit");
  try {
    return await db.$transaction(async (tx) => {
      const product = await tx.product.create({ data: toData(input), select: { id: true } });
      await writeAudit(tx, {
        userId: ctx.userId,
        branchId: null,
        action: "product.create",
        entityType: "Product",
        entityId: product.id,
        after: toData(input),
      });
      return product;
    });
  } catch (error) {
    uniqueViolation(error);
  }
}

export async function updateProduct(ctx: Ctx, id: string, input: ProductInput): Promise<{ id: string }> {
  assertCan(ctx, "price.edit");
  const before = await db.product.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("That product no longer exists.");
  if (before.trackingType !== input.trackingType) {
    const [units, stock] = await Promise.all([
      db.serializedUnit.count({ where: { productId: id } }),
      db.branchInventory.count({ where: { productId: id } }),
    ]);
    if (units + stock > 0) {
      throw new ValidationError("This product already has stock, so its tracking type can't change.", {
        trackingType: ["Locked once stock exists"],
      });
    }
  }
  try {
    return await db.$transaction(async (tx) => {
      const product = await tx.product.update({ where: { id }, data: toData(input), select: { id: true } });
      await writeAudit(tx, {
        userId: ctx.userId,
        branchId: null,
        action: "product.update",
        entityType: "Product",
        entityId: id,
        before,
        after: toData(input),
      });
      return product;
    });
  } catch (error) {
    uniqueViolation(error);
  }
}

/** Full product record for the edit form (owner only, includes cost). */
export async function getProductForEdit(ctx: Ctx, id: string): Promise<ProductInput & { id: string }> {
  assertCan(ctx, "price.edit");
  const p = await db.product.findUnique({ where: { id } });
  if (!p) throw new NotFoundError("That product no longer exists.");
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    trackingType: p.trackingType,
    sku: p.sku,
    barcode: p.barcode ?? undefined,
    defaultCostPrice: p.defaultCostPrice.toFixed(2),
    defaultSellingPrice: p.defaultSellingPrice.toFixed(2),
    warrantyMonths: p.warrantyMonths,
    reorderLevel: p.reorderLevel,
    isActive: p.isActive,
  };
}

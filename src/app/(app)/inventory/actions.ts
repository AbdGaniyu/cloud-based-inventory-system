"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { productSchema } from "@/lib/validators/product";
import { accessoryAdjustmentSchema, stockCountSchema, unitAdjustmentSchema } from "@/lib/validators/stock";
import { acceptTradeInSchema } from "@/lib/validators/unit";
import { acceptTradeIn } from "@/server/services/inventory.service";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { parseInput } from "@/server/parse-input";
import { createProduct, updateProduct } from "@/server/services/product.service";
import { adjustAccessory, adjustUnit, applyStockCount, type CountReview, reviewStockCount } from "@/server/services/stock-adjustment.service";

const saveProductSchema = z.object({ id: z.guid().optional(), product: productSchema });

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.filter((p) => p !== "product").join(".");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export async function saveProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = saveProductSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Check the highlighted fields.", fieldErrors(parsed.error));
    const ctx = await requireActionSession();
    const result = parsed.data.id
      ? await updateProduct(ctx, parsed.data.id, parsed.data.product)
      : await createProduct(ctx, parsed.data.product);
    revalidatePath("/inventory");
    return result;
  });
}

export async function releaseTradeIn(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const parsed = acceptTradeInSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the details.", fieldErrors(parsed.error));
    await acceptTradeIn(await requireActionSession(), parsed.data);
    revalidatePath("/inventory");
    return null;
  });
}

export async function adjustAccessoryStock(input: unknown): Promise<ActionResult<{ quantityBefore: number; quantityAfter: number }>> {
  return runAction(async () => {
    const result = await adjustAccessory(await requireActionSession(), parseInput(accessoryAdjustmentSchema, input));
    revalidatePath("/inventory");
    return result;
  });
}

export async function adjustUnitStatus(input: unknown): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const result = await adjustUnit(await requireActionSession(), parseInput(unitAdjustmentSchema, input));
    revalidatePath("/inventory");
    return result;
  });
}

export async function reviewCount(input: unknown): Promise<ActionResult<CountReview>> {
  return runAction(async () => reviewStockCount(await requireActionSession(), parseInput(stockCountSchema, input)));
}

export async function applyCount(input: unknown): Promise<ActionResult<{ stockCountId: string; adjustments: number }>> {
  return runAction(async () => {
    const result = await applyStockCount(await requireActionSession(), parseInput(stockCountSchema, input));
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return result;
  });
}

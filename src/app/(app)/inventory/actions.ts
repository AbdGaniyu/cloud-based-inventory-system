"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { productSchema } from "@/lib/validators/product";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { createProduct, updateProduct } from "@/server/services/product.service";

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

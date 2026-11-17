"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { intakeSchema } from "@/lib/validators/intake";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { checkIdentifiers, createIntake, type IdentifierStatus } from "@/server/services/intake.service";
import { quickSupplierSchema } from "@/lib/validators/supplier";
import { createSupplier } from "@/server/services/supplier.service";

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) (out[issue.path.join(".")] ??= []).push(issue.message);
  return out;
}

export async function receiveStock(input: unknown): Promise<ActionResult<{ id: string; number: string }>> {
  return runAction(async () => {
    const parsed = intakeSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Check the highlighted fields.", fieldErrors(parsed.error));
    const ctx = await requireActionSession();
    const result = await createIntake(ctx, parsed.data);
    revalidatePath("/inventory", "layout");
    return result;
  });
}

const identifiersSchema = z.array(z.string().max(60)).max(2000);

export async function checkIntakeIdentifiers(input: unknown): Promise<ActionResult<Record<string, IdentifierStatus>>> {
  return runAction(async () => {
    const values = identifiersSchema.parse(input);
    const ctx = await requireActionSession();
    return checkIdentifiers(ctx, values);
  });
}

export async function addSupplier(input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const parsed = quickSupplierSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Check the supplier details.", fieldErrors(parsed.error));
    const ctx = await requireActionSession();
    return createSupplier(ctx, parsed.data);
  });
}

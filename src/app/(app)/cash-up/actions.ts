"use server";

import { revalidatePath } from "next/cache";

import { reviewCashUpSchema, submitCashUpSchema } from "@/lib/validators/cashup";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { parseInput } from "@/server/parse-input";
import { type CashUpView, reviewCashUp, submitCashUp } from "@/server/services/cashup.service";

export async function submitDrawer(input: unknown): Promise<ActionResult<CashUpView>> {
  return runAction(async () => {
    const result = await submitCashUp(await requireActionSession(), parseInput(submitCashUpSchema, input));
    revalidatePath("/cash-up");
    revalidatePath("/dashboard");
    return result;
  });
}

export async function signOffCashUp(input: unknown): Promise<ActionResult<CashUpView>> {
  return runAction(async () => {
    const result = await reviewCashUp(await requireActionSession(), parseInput(reviewCashUpSchema, input));
    revalidatePath("/cash-up");
    revalidatePath("/dashboard");
    return result;
  });
}

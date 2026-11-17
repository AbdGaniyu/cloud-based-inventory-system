"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { eraseCustomerSchema } from "@/lib/validators/privacy";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { parseInput } from "@/server/parse-input";
import { eraseCustomer, recordPrivacyNotice } from "@/server/services/privacy.service";

export async function markNoticeGiven(customerId: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await recordPrivacyNotice(await requireActionSession(), parseInput(z.guid(), customerId));
    revalidatePath("/customers/[id]", "page");
    return null;
  });
}

export async function erasePersonalData(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await eraseCustomer(await requireActionSession(), parseInput(eraseCustomerSchema, input));
    revalidatePath("/customers/[id]", "page");
    revalidatePath("/customers");
    return null;
  });
}

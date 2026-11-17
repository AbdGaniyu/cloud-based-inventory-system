"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { checkoutSchema } from "@/lib/validators/checkout";
import { quickCustomerSchema } from "@/lib/validators/customer";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { createCustomer, type CustomerOption, searchCustomers } from "@/server/services/customer.service";
import { type CheckoutResult, checkout } from "@/server/services/invoice.service";
import { listPosStores, POS_BRANCH_COOKIE, type PosCatalog, searchCatalog } from "@/server/services/pos.service";
import { assertCan } from "@/server/auth/permissions";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
  throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the sale details.", fieldErrors);
}

const catalogSchema = z.object({
  branchId: z.guid(),
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
});

export async function searchPosCatalog(input: unknown): Promise<ActionResult<PosCatalog>> {
  return runAction(async () => searchCatalog(await requireActionSession(), parse(catalogSchema, input)));
}

export async function findCustomers(input: unknown): Promise<ActionResult<CustomerOption[]>> {
  return runAction(async () => searchCustomers(await requireActionSession(), parse(z.string().max(80), input)));
}

export async function addCustomer(input: unknown): Promise<ActionResult<CustomerOption>> {
  return runAction(async () => createCustomer(await requireActionSession(), parse(quickCustomerSchema, input)));
}

export async function completeSale(input: unknown): Promise<ActionResult<CheckoutResult>> {
  return runAction(async () => {
    const data = parse(checkoutSchema, input);
    const result = await checkout(await requireActionSession(), data);
    revalidatePath("/inventory");
    revalidatePath("/pos");
    return result;
  });
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Owner, all-branches view: which store the POS sells from (remembered per browser). */
export async function choosePosBranch(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const branchId = parse(z.guid(), input);
    const ctx = await requireActionSession();
    assertCan(ctx, "branch.viewAll");
    const stores = await listPosStores(ctx);
    if (!stores.some((s) => s.id === branchId)) throw new ValidationError("Choose an active store.");
    (await cookies()).set(POS_BRANCH_COOKIE, branchId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: ONE_YEAR_SECONDS });
    revalidatePath("/pos");
    return null;
  });
}

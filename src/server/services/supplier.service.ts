import "server-only";

import { normalizePhone } from "@/lib/phone";
import type { QuickSupplierInput } from "@/lib/validators/supplier";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";

/** Names only — balances and payables are owner-only (step 8). */
export async function listSupplierOptions(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  assertCan(ctx, "intake.create");
  return db.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Lets whoever is receiving stock add a new supplier inline during intake. */
export async function createSupplier(ctx: Ctx, input: QuickSupplierInput): Promise<{ id: string; name: string }> {
  assertCan(ctx, "intake.create");
  let phone: string | null = null;
  if (input.phone) {
    phone = normalizePhone(input.phone);
    if (!phone) throw new ValidationError("Enter a valid phone number.", { phone: ["Enter a valid phone number"] });
  }
  const duplicate = await db.supplier.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" }, isActive: true },
    select: { id: true },
  });
  if (duplicate) throw new ValidationError("A supplier with this name already exists.", { name: ["Already exists"] });

  return db.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: { name: input.name, phone, contactPerson: input.contactPerson ?? null },
      select: { id: true, name: true },
    });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: ctx.branchId,
      action: "supplier.create",
      entityType: "Supplier",
      entityId: supplier.id,
      after: { name: input.name, phone },
    });
    return supplier;
  });
}

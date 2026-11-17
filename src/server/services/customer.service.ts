import "server-only";

import { normalizePhone } from "@/lib/phone";
import type { QuickCustomerInput } from "@/lib/validators/customer";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";

export type CustomerOption = { id: string; name: string; phoneE164: string; whatsappOptIn: boolean; smsOptIn: boolean };

const SEARCH_LIMIT = 8;
const OPTION_SELECT = { id: true, name: true, phoneE164: true, whatsappOptIn: true, smsOptIn: true } as const;

/** Customers are global (not branch-scoped). Finds by name or by any run of phone digits. */
export async function searchCustomers(ctx: Ctx, query: string): Promise<CustomerOption[]> {
  assertCan(ctx, "customer.view");
  const q = query.trim();
  if (q.length < 2) {
    return db.customer.findMany({ select: OPTION_SELECT, orderBy: { updatedAt: "desc" }, take: SEARCH_LIMIT });
  }
  const digits = q.replace(/\D/g, "");
  // "0803…" is stored as "+234803…": search on the national number without the leading 0.
  const phoneFragment = digits.startsWith("0") ? digits.slice(1) : digits;
  return db.customer.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(phoneFragment.length >= 3 ? [{ phoneE164: { contains: phoneFragment } }] : []),
      ],
    },
    select: OPTION_SELECT,
    orderBy: { name: "asc" },
    take: SEARCH_LIMIT,
  });
}

export async function createCustomer(ctx: Ctx, input: QuickCustomerInput): Promise<CustomerOption> {
  assertCan(ctx, "customer.create");
  const phoneE164 = normalizePhone(input.phone);
  if (!phoneE164) throw new ValidationError("Enter a valid phone number.", { phone: ["Enter a valid phone number"] });
  const existing = await db.customer.findUnique({ where: { phoneE164 }, select: { name: true } });
  if (existing) {
    throw new ValidationError(`This number already belongs to ${existing.name}. Search for them instead.`, { phone: ["Already a customer"] });
  }
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        name: input.name,
        phoneE164,
        email: input.email ?? null,
        whatsappOptIn: input.whatsappOptIn,
        smsOptIn: input.smsOptIn,
        notes: input.notes ?? null,
        createdById: ctx.userId,
      },
      select: OPTION_SELECT,
    });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: ctx.branchId,
      action: "customer.create",
      entityType: "Customer",
      entityId: customer.id,
      after: { name: input.name, phoneE164, whatsappOptIn: input.whatsappOptIn, smsOptIn: input.smsOptIn },
    });
    return customer;
  });
}

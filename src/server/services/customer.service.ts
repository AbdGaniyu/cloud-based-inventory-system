import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { InstallmentPlanStatus, InvoiceStatus, WarrantyStatus } from "@/generated/prisma/enums";
import { type CalendarDate, fromDbDate, todayInStoreTz } from "@/lib/dates";
import { money, sum } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import type { QuickCustomerInput } from "@/lib/validators/customer";
import type { CustomerPreferencesInput } from "@/lib/validators/payment";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { NotFoundError, requireRecordId, ValidationError } from "@/server/errors";
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

// ─── Customer list and profile (DESIGN.md §5.10) ──────────────────────────

export type CustomerListRow = {
  id: string;
  name: string;
  phoneE164: string;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
  invoiceCount: number;
  outstanding: string;
  lastPurchaseAt: string | null;
};

const CUSTOMER_PAGE_SIZE = 25;

/** Customers are shared by every branch; balances shown are across all branches (no cost data). */
export async function listCustomers(
  ctx: Ctx,
  params: { q?: string; owing?: boolean; page?: number },
): Promise<{ rows: CustomerListRow[]; total: number; page: number; pageSize: number; owingCount: number }> {
  assertCan(ctx, "customer.view");
  const q = params.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const phoneFragment = digits.startsWith("0") ? digits.slice(1) : digits;
  const owing: Prisma.CustomerWhereInput = { invoices: { some: { status: { not: "VOID" }, balance: { gt: 0 } } } };
  const search: Prisma.CustomerWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(phoneFragment.length >= 3 ? [{ phoneE164: { contains: phoneFragment } }] : [])] }
    : {};
  const where: Prisma.CustomerWhereInput = { AND: [search, params.owing ? owing : {}] };
  const page = Math.max(1, params.page ?? 1);
  const [customers, total, owingCount] = await Promise.all([
    db.customer.findMany({
      where,
      select: {
        ...OPTION_SELECT,
        _count: { select: { invoices: { where: { status: { not: "VOID" } } } } },
        invoices: { where: { status: { not: "VOID" }, balance: { gt: 0 } }, select: { balance: true } },
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * CUSTOMER_PAGE_SIZE,
      take: CUSTOMER_PAGE_SIZE,
    }),
    db.customer.count({ where }),
    db.customer.count({ where: { AND: [search, owing] } }),
  ]);
  const lastPurchases = await db.invoice.groupBy({
    by: ["customerId"],
    where: { customerId: { in: customers.map((c) => c.id) }, status: { not: "VOID" } },
    _max: { createdAt: true },
  });
  const last = new Map(lastPurchases.map((l) => [l.customerId, l._max.createdAt]));
  return {
    rows: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phoneE164: c.phoneE164,
      whatsappOptIn: c.whatsappOptIn,
      smsOptIn: c.smsOptIn,
      invoiceCount: c._count.invoices,
      outstanding: sum(c.invoices.map((i) => i.balance)).toFixed(2),
      lastPurchaseAt: last.get(c.id)?.toISOString() ?? null,
    })),
    total,
    page,
    pageSize: CUSTOMER_PAGE_SIZE,
    owingCount,
  };
}

export type CustomerProfile = {
  id: string;
  name: string;
  phoneE164: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
  createdAt: string;
  lifetimeSpend: string;
  outstanding: string;
  plans: {
    invoiceId: string;
    number: string;
    branchName: string;
    total: string;
    amountPaid: string;
    balance: string;
    paidPercent: number;
    nextDueDate: CalendarDate | null;
    overdue: boolean;
    status: InstallmentPlanStatus;
    canView: boolean;
  }[];
  purchases: { invoiceId: string; number: string; branchName: string; createdAt: string; items: string; total: string; balance: string; status: InvoiceStatus; canView: boolean }[];
  warranties: { id: string; publicId: string; device: string; identifier: string | null; branchName: string; expiresAt: CalendarDate; status: WarrantyStatus; invoiceNumber: string }[];
};

const PROFILE_LIMIT = 50;

export async function getCustomerProfile(ctx: Ctx, id: string, now: Date = new Date()): Promise<CustomerProfile> {
  requireRecordId(id, "That customer no longer exists.");
  assertCan(ctx, "customer.view");
  const today = todayInStoreTz(now);
  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      invoices: {
        include: {
          branch: { select: { name: true } },
          items: { select: { description: true, quantity: true } },
          installmentPlan: { select: { status: true, nextDueDate: true } },
        },
        orderBy: { createdAt: "desc" },
        take: PROFILE_LIMIT,
      },
      warrantyCards: {
        include: {
          branch: { select: { name: true } },
          serializedUnit: { select: { imei: true, serialNumber: true } },
          invoiceItem: { select: { description: true, invoice: { select: { number: true } } } },
        },
        orderBy: { expiresAt: "desc" },
        take: PROFILE_LIMIT,
      },
    },
  });
  if (!customer) throw new NotFoundError("That customer no longer exists.");
  const [spend, owed] = await Promise.all([
    db.invoice.aggregate({ where: { customerId: id, status: { not: "VOID" } }, _sum: { total: true, returnedAmount: true } }),
    db.invoice.aggregate({ where: { customerId: id, status: { not: "VOID" }, balance: { gt: 0 } }, _sum: { balance: true } }),
  ]);
  const canView = (branchId: string) => ctx.role === "OWNER" || ctx.branchId === branchId;
  const live = customer.invoices.filter((i) => i.status !== "VOID");
  return {
    id: customer.id,
    name: customer.name,
    phoneE164: customer.phoneE164,
    email: customer.email,
    address: customer.address,
    notes: customer.notes,
    whatsappOptIn: customer.whatsappOptIn,
    smsOptIn: customer.smsOptIn,
    createdAt: customer.createdAt.toISOString(),
    lifetimeSpend: money(spend._sum.total ?? 0).minus(spend._sum.returnedAmount ?? 0).toFixed(2),
    outstanding: money(owed._sum.balance ?? 0).toFixed(2),
    plans: live
      .filter((i) => i.installmentPlan && i.installmentPlan.status !== "CANCELLED")
      .map((i) => {
        const nextDueDate = i.installmentPlan?.nextDueDate ? fromDbDate(i.installmentPlan.nextDueDate) : null;
        return {
          invoiceId: i.id,
          number: i.number,
          branchName: i.branch.name,
          total: i.total.toFixed(2),
          amountPaid: i.amountPaid.toFixed(2),
          balance: i.balance.toFixed(2),
          paidPercent: i.total.gt(0) ? Math.min(100, Math.floor(i.amountPaid.div(i.total).times(100).toNumber())) : 100,
          nextDueDate,
          overdue: nextDueDate !== null && nextDueDate < today && i.balance.gt(0),
          status: i.installmentPlan?.status ?? "ACTIVE",
          canView: canView(i.branchId),
        };
      }),
    purchases: customer.invoices.map((i) => ({
      invoiceId: i.id,
      number: i.number,
      branchName: i.branch.name,
      createdAt: i.createdAt.toISOString(),
      items: i.items.map((it) => (it.quantity > 1 ? `${it.quantity} × ${it.description}` : it.description)).join(", "),
      total: i.total.toFixed(2),
      balance: i.balance.toFixed(2),
      status: i.status,
      canView: canView(i.branchId),
    })),
    warranties: customer.warrantyCards.map((w) => {
      const expiresAt = fromDbDate(w.expiresAt);
      return {
        id: w.id,
        publicId: w.publicId,
        device: w.invoiceItem.description,
        identifier: w.serializedUnit.imei ?? w.serializedUnit.serialNumber,
        branchName: w.branch.name,
        expiresAt,
        status: w.status === "ACTIVE" && expiresAt < today ? "EXPIRED" : w.status,
        invoiceNumber: w.invoiceItem.invoice.number,
      };
    }),
  };
}

/** Message opt-ins and notes; every change is audited (opt-outs must be provable). */
export async function updateCustomerPreferences(ctx: Ctx, input: CustomerPreferencesInput): Promise<void> {
  assertCan(ctx, "customer.create");
  const before = await db.customer.findUnique({ where: { id: input.customerId }, select: { whatsappOptIn: true, smsOptIn: true, notes: true } });
  if (!before) throw new NotFoundError("That customer no longer exists.");
  const after = { whatsappOptIn: input.whatsappOptIn, smsOptIn: input.smsOptIn, notes: input.notes ?? null };
  await db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: input.customerId }, data: after });
    await writeAudit(tx, { userId: ctx.userId, branchId: ctx.branchId, action: "customer.update", entityType: "Customer", entityId: input.customerId, before, after });
  });
}

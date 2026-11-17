import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, PaymentTerms, PurchaseOrderStatus } from "@/generated/prisma/enums";
import { addDays, type CalendarDate, daysBetween, fromDbDate, todayInStoreTz, toDbDate } from "@/lib/dates";
import { money, sum, toDb, ZERO } from "@/lib/money";
import type { SupplierPayoutInput } from "@/lib/validators/payment";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import { DUE_SOON_DAYS } from "@/server/services/ledger.service";

/**
 * Payables ledger (CLAUDE.md §7.2, §5.5). Owner only: supplier balances are cost data (invariant 9).
 * A supplier's balance is derived from its purchase orders and payouts, never stored.
 */

type Tx = Prisma.TransactionClient;

function poStatus(totalCost: Prisma.Decimal, amountPaid: Prisma.Decimal): PurchaseOrderStatus {
  if (amountPaid.gte(totalCost)) return "PAID";
  return amountPaid.gt(0) ? "PARTIALLY_PAID" : "UNPAID";
}

/** Re-derives the PO's cached amount paid and status from its payout rows (invariant 5). */
async function recomputePurchaseOrder(tx: Tx, purchaseOrderId: string): Promise<{ amountPaid: string; balance: string; status: PurchaseOrderStatus }> {
  const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { totalCost: true } });
  const payments = await tx.supplierPayment.findMany({ where: { purchaseOrderId }, select: { amount: true } });
  const amountPaid = new Prisma.Decimal(sum(payments.map((p) => p.amount)).toFixed(2));
  if (amountPaid.gt(po.totalCost)) throw new ValidationError("That is more than the balance on this purchase order.");
  const status = poStatus(po.totalCost, amountPaid);
  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { amountPaid, status } });
  return { amountPaid: amountPaid.toFixed(2), balance: po.totalCost.minus(amountPaid).toFixed(2), status };
}

export type PayoutResult = { paymentId: string; purchaseOrderNumber: string; supplierName: string; amount: string; balance: string; status: PurchaseOrderStatus };

/** Pays a supplier against one purchase order. The PO row is locked so two payouts cannot overpay it. */
export async function recordSupplierPayout(ctx: Ctx, input: SupplierPayoutInput, options: { now?: Date } = {}): Promise<PayoutResult> {
  assertCan(ctx, "supplier.payout");
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM purchase_orders WHERE id = ${input.purchaseOrderId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("That purchase order no longer exists.");
    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: input.purchaseOrderId },
      select: { id: true, number: true, branchId: true, supplierId: true, totalCost: true, amountPaid: true, status: true, supplier: { select: { name: true } } },
    });
    const balance = po.totalCost.minus(po.amountPaid);
    if (balance.lte(0)) throw new ConflictError("This purchase order is already paid.");
    if (money(input.amount).gt(balance)) {
      throw new ValidationError(`That is more than the balance of ${balance.toFixed(2)}.`, { amount: ["More than the balance"] });
    }
    const payment = await tx.supplierPayment.create({
      data: {
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        amount: toDb(input.amount),
        method: input.method,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        paidById: ctx.userId,
        paidAt: now,
      },
    });
    const after = await recomputePurchaseOrder(tx, po.id);
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: po.branchId,
      action: "supplier.payout",
      entityType: "SupplierPayment",
      entityId: payment.id,
      before: { purchaseOrderNumber: po.number, amountPaid: po.amountPaid.toFixed(2), status: po.status },
      after: { purchaseOrderNumber: po.number, amount: toDb(input.amount), method: input.method, reference: input.reference ?? null, ...after },
    });
    return { paymentId: payment.id, purchaseOrderNumber: po.number, supplierName: po.supplier.name, amount: toDb(input.amount), balance: after.balance, status: after.status };
  });
}

export type PayablesFilter = "all" | "due_soon" | "overdue" | "paid";

export type PayableRow = {
  purchaseOrderId: string;
  number: string;
  supplierId: string;
  supplierName: string;
  branchCode: string;
  paymentTerms: PaymentTerms;
  totalCost: string;
  amountPaid: string;
  balance: string;
  dueDate: CalendarDate | null;
  /** Positive: days overdue. Negative: days until due. */
  dueInDays: number | null;
  status: PurchaseOrderStatus | "OVERDUE";
  receivedAt: string;
};

const PAGE_SIZE = 25;

function rowOf(po: {
  id: string;
  number: string;
  supplierId: string;
  supplier: { name: string };
  branch: { code: string };
  paymentTerms: PaymentTerms;
  totalCost: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  dueDate: Date | null;
  status: PurchaseOrderStatus;
  receivedAt: Date;
}, today: CalendarDate): PayableRow {
  const dueDate = po.dueDate ? fromDbDate(po.dueDate) : null;
  const open = po.status !== "PAID";
  const dueInDays = open && dueDate ? daysBetween(dueDate, today) : null;
  return {
    purchaseOrderId: po.id,
    number: po.number,
    supplierId: po.supplierId,
    supplierName: po.supplier.name,
    branchCode: po.branch.code,
    paymentTerms: po.paymentTerms,
    totalCost: po.totalCost.toFixed(2),
    amountPaid: po.amountPaid.toFixed(2),
    balance: po.totalCost.minus(po.amountPaid).toFixed(2),
    dueDate,
    dueInDays,
    status: dueInDays !== null && dueInDays > 0 ? "OVERDUE" : po.status,
    receivedAt: po.receivedAt.toISOString(),
  };
}

const PO_ROW_SELECT = {
  id: true,
  number: true,
  supplierId: true,
  supplier: { select: { name: true } },
  branch: { select: { code: true } },
  paymentTerms: true,
  totalCost: true,
  amountPaid: true,
  dueDate: true,
  status: true,
  receivedAt: true,
} satisfies Prisma.PurchaseOrderSelect;

async function owedSum(where: Prisma.PurchaseOrderWhereInput): Promise<string> {
  const agg = await db.purchaseOrder.aggregate({ where: { ...where, status: { not: "PAID" } }, _sum: { totalCost: true, amountPaid: true } });
  return (agg._sum.totalCost ?? ZERO).minus(agg._sum.amountPaid ?? ZERO).toFixed(2);
}

export async function listPayables(
  ctx: Ctx,
  params: { filter?: PayablesFilter; q?: string; page?: number },
  now: Date = new Date(),
): Promise<{ rows: PayableRow[]; total: number; page: number; pageSize: number; counts: Record<PayablesFilter, number>; summary: { totalOwed: string; dueThisWeek: string; overdue: string } }> {
  assertCan(ctx, "payables.view");
  const today = todayInStoreTz(now);
  const todayDb = toDbDate(today);
  const weekEnd = toDbDate(addDays(today, DUE_SOON_DAYS - 1));
  const q = params.q?.trim();
  const scope: Prisma.PurchaseOrderWhereInput = {
    ...(ctx.activeBranchId ? { branchId: ctx.activeBranchId } : {}),
    ...(q
      ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }, { supplierReference: { contains: q, mode: "insensitive" } }] }
      : {}),
  };
  const open: Prisma.PurchaseOrderWhereInput = { status: { not: "PAID" } };
  const filters: Record<PayablesFilter, Prisma.PurchaseOrderWhereInput> = {
    all: {},
    due_soon: { ...open, dueDate: { gte: todayDb, lte: weekEnd } },
    overdue: { ...open, dueDate: { lt: todayDb } },
    paid: { status: "PAID" },
  };
  const filter = params.filter ?? "all";
  const where = { AND: [scope, filters[filter]] };
  const page = Math.max(1, params.page ?? 1);

  const [rows, total, [all, dueSoon, overdue, paid], [totalOwed, dueThisWeek, overdueSum]] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      select: PO_ROW_SELECT,
      // Open bills first, soonest due first; paid ones after, newest first.
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { receivedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.purchaseOrder.count({ where }),
    Promise.all((["all", "due_soon", "overdue", "paid"] as const).map((f) => db.purchaseOrder.count({ where: { AND: [scope, filters[f]] } }))),
    Promise.all([owedSum(scope), owedSum({ AND: [scope, filters.due_soon] }), owedSum({ AND: [scope, filters.overdue] })]),
  ]);
  return {
    rows: rows.map((po) => rowOf(po, today)),
    total,
    page,
    pageSize: PAGE_SIZE,
    counts: { all, due_soon: dueSoon, overdue, paid },
    summary: { totalOwed, dueThisWeek, overdue: overdueSum },
  };
}

export type SupplierListRow = { id: string; name: string; contactPerson: string | null; phone: string | null; openOrders: number; balance: string; overdue: boolean; lastDeliveryAt: string | null };

export async function listSuppliers(ctx: Ctx, params: { q?: string } = {}, now: Date = new Date()): Promise<SupplierListRow[]> {
  assertCan(ctx, "payables.view");
  const todayDb = toDbDate(todayInStoreTz(now));
  const q = params.q?.trim();
  const suppliers = await db.supplier.findMany({
    where: { isActive: true, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    select: {
      id: true,
      name: true,
      contactPerson: true,
      phone: true,
      purchaseOrders: { where: { status: { not: "PAID" } }, select: { totalCost: true, amountPaid: true, dueDate: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  const lastDeliveries = await db.purchaseOrder.groupBy({ by: ["supplierId"], where: { supplierId: { in: suppliers.map((s) => s.id) } }, _max: { receivedAt: true } });
  const last = new Map(lastDeliveries.map((d) => [d.supplierId, d._max.receivedAt]));
  return suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    contactPerson: s.contactPerson,
    phone: s.phone,
    openOrders: s.purchaseOrders.length,
    balance: sum(s.purchaseOrders.map((po) => money(po.totalCost).minus(po.amountPaid))).toFixed(2),
    overdue: s.purchaseOrders.some((po) => po.dueDate !== null && po.dueDate < todayDb),
    lastDeliveryAt: last.get(s.id)?.toISOString() ?? null,
  }));
}

export type SupplierProfile = {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  balance: string;
  overdueBalance: string;
  totalPurchased: string;
  orders: PayableRow[];
  payments: { id: string; paidAt: string; purchaseOrderNumber: string; amount: string; method: PaymentMethod; reference: string | null; paidByName: string; isReversal: boolean }[];
};

const PROFILE_HISTORY_LIMIT = 100;

export async function getSupplierProfile(ctx: Ctx, id: string, now: Date = new Date()): Promise<SupplierProfile> {
  assertCan(ctx, "payables.view");
  const today = todayInStoreTz(now);
  const supplier = await db.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: { select: PO_ROW_SELECT, orderBy: [{ receivedAt: "desc" }], take: PROFILE_HISTORY_LIMIT },
      payments: {
        include: { purchaseOrder: { select: { number: true } }, paidBy: { select: { name: true } } },
        orderBy: { paidAt: "desc" },
        take: PROFILE_HISTORY_LIMIT,
      },
    },
  });
  if (!supplier) throw new NotFoundError("That supplier no longer exists.");
  const [owed, purchased] = await Promise.all([
    db.purchaseOrder.aggregate({ where: { supplierId: id, status: { not: "PAID" } }, _sum: { totalCost: true, amountPaid: true } }),
    db.purchaseOrder.aggregate({ where: { supplierId: id }, _sum: { totalCost: true } }),
  ]);
  const orders = supplier.purchaseOrders.map((po) => rowOf(po, today));
  return {
    id: supplier.id,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    balance: (owed._sum.totalCost ?? ZERO).minus(owed._sum.amountPaid ?? ZERO).toFixed(2),
    overdueBalance: sum(orders.filter((o) => o.status === "OVERDUE").map((o) => o.balance)).toFixed(2),
    totalPurchased: (purchased._sum.totalCost ?? ZERO).toFixed(2),
    orders,
    payments: supplier.payments.map((p) => ({
      id: p.id,
      paidAt: p.paidAt.toISOString(),
      purchaseOrderNumber: p.purchaseOrder.number,
      amount: p.amount.toFixed(2),
      method: p.method,
      reference: p.reference,
      paidByName: p.paidBy.name,
      isReversal: p.reversalOfId !== null,
    })),
  };
}

import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { InvoiceStatus, PaymentMethod, ScheduleStatus } from "@/generated/prisma/enums";
import { addDays, type CalendarDate, daysBetween, fromDbDate, todayInStoreTz, toDbDate } from "@/lib/dates";
import { allocateSchedule, deriveInvoiceStatus } from "@/lib/ledger";
import { money, sum, toDb } from "@/lib/money";
import type { RecordPaymentInput, ReversePaymentInput, WaiveDebtInput } from "@/lib/validators/payment";
import { assertCan, can, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";

/**
 * Receivables ledger (CLAUDE.md §7.5). Payments, reversals and waivers are append-only rows; the
 * cached totals on the invoice, plan and schedule are recomputed from them inside the same
 * transaction (invariant 5), with the invoice row locked so concurrent payments queue up.
 */

type Tx = Prisma.TransactionClient;

const SETTLED: ScheduleStatus[] = ["PAID", "WAIVED"];
/** "Due soon" and "due this week" both mean the next seven days (DESIGN.md §5.4). */
export const DUE_SOON_DAYS = 7;

async function lockInvoice(tx: Tx, invoiceId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError("That invoice no longer exists.");
}

export type LedgerSnapshot = { amountPaid: string; adjustedAmount: string; balance: string; status: InvoiceStatus; nextDueDate: CalendarDate | null; settledSequences: number[] };

/**
 * Rebuilds the invoice's cached ledger from its payment and adjustment rows: amount paid, balance,
 * status, every schedule row (instalment payments oldest-first, waivers newest-first) and the plan's
 * next due date and completion. Call inside the mutation's transaction after locking the invoice.
 */
export async function recomputeInvoiceLedger(tx: Tx, invoiceId: string, now: Date): Promise<LedgerSnapshot> {
  const today = todayInStoreTz(now);
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { installmentPlan: { include: { schedule: { orderBy: { sequence: "asc" } } } } },
  });
  const [payments, adjustments] = await Promise.all([
    tx.customerPayment.findMany({ where: { invoiceId }, select: { amount: true, kind: true } }),
    tx.invoiceAdjustment.findMany({ where: { invoiceId }, select: { amount: true } }),
  ]);
  const amountPaid = sum(payments.map((p) => p.amount));
  const adjustedAmount = sum(adjustments.map((a) => a.amount));
  const balance = money(invoice.total).minus(invoice.returnedAmount).minus(adjustedAmount).minus(amountPaid);
  if (balance.lt(0)) throw new ValidationError("That is more than the balance on this invoice.");
  const status = deriveInvoiceStatus(invoice.status, { amountPaid, balance });

  let nextDueDate: CalendarDate | null = null;
  let settledSequences: number[] = [];
  const plan = invoice.installmentPlan;
  if (plan) {
    const previous = plan.schedule.map((r) => ({ sequence: r.sequence, status: r.status }));
    const allocation = allocateSchedule(
      plan.schedule.map((r) => ({ sequence: r.sequence, dueDate: fromDbDate(r.dueDate), amountDue: r.amountDue })),
      { paid: sum(payments.filter((p) => p.kind === "INSTALLMENT").map((p) => p.amount)), waived: adjustedAmount, today },
      previous,
    );
    for (const row of allocation.rows) {
      const stored = plan.schedule.find((r) => r.sequence === row.sequence);
      if (!stored) continue;
      const settled = SETTLED.includes(row.status);
      const changed = !stored.amountPaid.equals(row.amountPaid) || !stored.amountWaived.equals(row.amountWaived) || stored.status !== row.status;
      if (!changed) continue;
      await tx.installmentSchedule.update({
        where: { id: stored.id },
        data: {
          amountPaid: row.amountPaid,
          amountWaived: row.amountWaived,
          status: row.status,
          paidAt: settled ? (stored.paidAt ?? now) : null,
        },
      });
    }
    nextDueDate = allocation.nextDueDate;
    settledSequences = allocation.newlySettled;
    const completed = balance.lte(0);
    await tx.installmentPlan.update({
      where: { id: plan.id },
      data: {
        nextDueDate: nextDueDate && !completed ? toDbDate(nextDueDate) : null,
        status: completed ? "COMPLETED" : plan.status === "COMPLETED" ? "ACTIVE" : plan.status,
      },
    });
    if (completed) nextDueDate = null;
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: toDb(amountPaid), adjustedAmount: toDb(adjustedAmount), balance: toDb(balance), status },
  });
  return { amountPaid: amountPaid.toFixed(2), adjustedAmount: adjustedAmount.toFixed(2), balance: balance.toFixed(2), status, nextDueDate, settledSequences };
}

function assertOpen(invoice: { status: InvoiceStatus; balance: Prisma.Decimal }, amount: string): void {
  if (invoice.status === "VOID") throw new ConflictError("This invoice is void.");
  if (invoice.status === "RETURNED") throw new ConflictError("This invoice was returned.");
  if (invoice.balance.lte(0)) throw new ConflictError("This invoice is already fully paid.");
  if (money(amount).gt(invoice.balance)) {
    throw new ValidationError(`That is more than the balance of ${invoice.balance.toFixed(2)}.`, { amount: ["More than the balance"] });
  }
}

export type PaymentResult = {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: string;
  method: PaymentMethod;
  balance: string;
  status: InvoiceStatus;
  nextDueDate: CalendarDate | null;
  settledSequences: number[];
  planCompleted: boolean;
};

/**
 * Records a repayment at the branch that collected it (any branch may collect for any open invoice;
 * owners in "All branches" collect for the selling branch). Rejects more than the balance.
 */
export async function recordCustomerPayment(ctx: Ctx, input: RecordPaymentInput, options: { now?: Date } = {}): Promise<PaymentResult> {
  assertCan(ctx, "payment.record");
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockInvoice(tx, input.invoiceId);
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      select: { id: true, number: true, branchId: true, customerId: true, status: true, balance: true, installmentPlan: { select: { id: true } } },
    });
    assertOpen(invoice, input.amount);
    const branchId = ctx.role === "OWNER" ? (ctx.activeBranchId ?? invoice.branchId) : ctx.branchId;
    if (!branchId) throw new ValidationError("Choose the branch that collected this payment.");

    const payment = await tx.customerPayment.create({
      data: {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        branchId,
        amount: toDb(input.amount),
        method: input.method,
        reference: input.reference ?? null,
        kind: "INSTALLMENT",
        receivedById: ctx.userId,
        paidAt: now,
      },
    });
    const after = await recomputeInvoiceLedger(tx, invoice.id, now);
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId,
      action: "payment.record",
      entityType: "CustomerPayment",
      entityId: payment.id,
      before: { invoiceNumber: invoice.number, balance: invoice.balance.toFixed(2), status: invoice.status },
      after: { invoiceNumber: invoice.number, amount: toDb(input.amount), method: input.method, reference: input.reference ?? null, ...after },
    });
    return {
      paymentId: payment.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: toDb(input.amount),
      method: input.method,
      balance: after.balance,
      status: after.status,
      nextDueDate: after.nextDueDate,
      settledSequences: after.settledSequences,
      planCompleted: invoice.installmentPlan !== null && money(after.balance).lte(0),
    };
  });
}

/** Owner: cancels a payment recorded in error (bounced transfer, wrong invoice) with an offsetting row. */
export async function reverseCustomerPayment(ctx: Ctx, input: ReversePaymentInput, options: { now?: Date } = {}): Promise<LedgerSnapshot> {
  assertCan(ctx, "payment.reverse");
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    const original = await tx.customerPayment.findUnique({ where: { id: input.paymentId }, include: { reversedBy: { select: { id: true } } } });
    if (!original) throw new NotFoundError("That payment no longer exists.");
    if (original.reversalOfId || original.kind === "REFUND") throw new ConflictError("Only a received payment can be reversed.");
    if (original.reversedBy) throw new ConflictError("This payment was already reversed.");
    await lockInvoice(tx, original.invoiceId);
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: original.invoiceId }, select: { number: true, status: true, balance: true } });
    if (invoice.status === "VOID") throw new ConflictError("This invoice is void.");

    const reversal = await tx.customerPayment.create({
      data: {
        invoiceId: original.invoiceId,
        customerId: original.customerId,
        branchId: original.branchId,
        amount: original.amount.negated(),
        method: original.method,
        reference: original.reference,
        kind: original.kind,
        reversalOfId: original.id,
        notes: input.reason,
        receivedById: ctx.userId,
        paidAt: now,
      },
    });
    const after = await recomputeInvoiceLedger(tx, original.invoiceId, now);
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: original.branchId,
      action: "payment.reverse",
      entityType: "CustomerPayment",
      entityId: reversal.id,
      before: { invoiceNumber: invoice.number, balance: invoice.balance.toFixed(2), reversedPaymentId: original.id, amount: original.amount.toFixed(2) },
      after: { reason: input.reason, ...after },
    });
    return after;
  });
}

/** Owner: forgives part or all of the remaining balance, with a reason. Waived instalments are never chased. */
export async function waiveDebt(ctx: Ctx, input: WaiveDebtInput, options: { now?: Date } = {}): Promise<LedgerSnapshot> {
  assertCan(ctx, "debt.waive");
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockInvoice(tx, input.invoiceId);
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId }, select: { number: true, branchId: true, status: true, balance: true } });
    assertOpen(invoice, input.amount);
    const adjustment = await tx.invoiceAdjustment.create({
      data: { invoiceId: input.invoiceId, kind: "WAIVER", amount: toDb(input.amount), reason: input.reason, createdById: ctx.userId },
    });
    const after = await recomputeInvoiceLedger(tx, input.invoiceId, now);
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: invoice.branchId,
      action: "debt.waive",
      entityType: "InvoiceAdjustment",
      entityId: adjustment.id,
      before: { invoiceNumber: invoice.number, balance: invoice.balance.toFixed(2), status: invoice.status },
      after: { amount: toDb(input.amount), reason: input.reason, ...after },
    });
    return after;
  });
}

/** Managers (own branch) and owners switch automated reminders for one plan on or off. */
export async function setPlanReminders(ctx: Ctx, input: { invoiceId: string; enabled: boolean }): Promise<boolean> {
  const plan = await db.installmentPlan.findUnique({
    where: { invoiceId: input.invoiceId },
    select: { id: true, remindersEnabled: true, invoice: { select: { branchId: true, number: true } } },
  });
  if (!plan) throw new NotFoundError("This invoice has no instalment plan.");
  assertCan(ctx, "reminders.manage", { branchId: plan.invoice.branchId });
  if (plan.remindersEnabled === input.enabled) return input.enabled;
  await db.$transaction(async (tx) => {
    await tx.installmentPlan.update({ where: { id: plan.id }, data: { remindersEnabled: input.enabled } });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: plan.invoice.branchId,
      action: "plan.reminders",
      entityType: "InstallmentPlan",
      entityId: plan.id,
      before: { remindersEnabled: plan.remindersEnabled },
      after: { invoiceNumber: plan.invoice.number, remindersEnabled: input.enabled },
    });
  });
  return input.enabled;
}

// ─── Read models ───────────────────────────────────────────────────────────

export type PaymentContext = {
  invoiceId: string;
  number: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  total: string;
  amountPaid: string;
  balance: string;
  status: InvoiceStatus;
  /** Remaining on the next unsettled instalment: the sheet's default amount. */
  nextAmountDue: string | null;
  installmentPaid: string;
  waived: string;
  schedule: { sequence: number; dueDate: CalendarDate; amountDue: string; amountPaid: string; amountWaived: string; status: ScheduleStatus }[];
  messageChannel: "WHATSAPP" | "SMS" | null;
  today: CalendarDate;
};

/** What the Record payment sheet needs. Any branch may collect, so this is not branch-scoped; it carries no cost data. */
export async function getPaymentContext(ctx: Ctx, invoiceId: string, now: Date = new Date()): Promise<PaymentContext> {
  assertCan(ctx, "payment.record");
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { name: true, phoneE164: true, whatsappOptIn: true, smsOptIn: true } },
      branch: { select: { name: true } },
      installmentPlan: { include: { schedule: { orderBy: { sequence: "asc" } } } },
      payments: { where: { kind: "INSTALLMENT" }, select: { amount: true } },
    },
  });
  if (!invoice) throw new NotFoundError("That invoice no longer exists.");
  const schedule = (invoice.installmentPlan?.schedule ?? []).map((r) => ({
    sequence: r.sequence,
    dueDate: fromDbDate(r.dueDate),
    amountDue: r.amountDue.toFixed(2),
    amountPaid: r.amountPaid.toFixed(2),
    amountWaived: r.amountWaived.toFixed(2),
    status: r.status,
  }));
  const next = schedule.find((r) => !SETTLED.includes(r.status));
  const nextRemaining = next ? money(next.amountDue).minus(next.amountPaid).minus(next.amountWaived) : null;
  return {
    invoiceId: invoice.id,
    number: invoice.number,
    customerName: invoice.customer.name,
    customerPhone: invoice.customer.phoneE164,
    branchName: invoice.branch.name,
    total: invoice.total.toFixed(2),
    amountPaid: invoice.amountPaid.toFixed(2),
    balance: invoice.balance.toFixed(2),
    status: invoice.status,
    nextAmountDue: nextRemaining ? (nextRemaining.gt(invoice.balance) ? invoice.balance : nextRemaining).toFixed(2) : null,
    installmentPaid: sum(invoice.payments.map((p) => p.amount)).toFixed(2),
    waived: invoice.adjustedAmount.toFixed(2),
    schedule,
    messageChannel: invoice.customer.whatsappOptIn ? "WHATSAPP" : invoice.customer.smsOptIn ? "SMS" : null,
    today: todayInStoreTz(now),
  };
}

export type ReceivablesFilter = "all" | "due_soon" | "overdue" | "completed";

export type ReceivableRow = {
  invoiceId: string;
  number: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  total: string;
  amountPaid: string;
  balance: string;
  paidPercent: number;
  status: InvoiceStatus | "OVERDUE";
  nextDueDate: CalendarDate | null;
  /** Positive: days past the oldest unpaid due date. Negative: days until the next one. */
  dueInDays: number | null;
  remindersEnabled: boolean | null;
  canManageReminders: boolean;
  canView: boolean;
};

export type ReceivablesSummary = { totalOutstanding: string; dueThisWeek: string; overdueAmount: string; overdueAccounts: number };

const PAGE_SIZE = 25;

function unsettledRow(where: Prisma.InstallmentScheduleWhereInput): Prisma.InvoiceWhereInput {
  return { installmentPlan: { schedule: { some: { status: { notIn: SETTLED }, ...where } } } };
}

/**
 * Accounts on credit: instalment invoices (open or completed) plus any invoice still owing.
 * Scoped to the active branch; a search looks across every branch, because any branch may collect.
 */
export async function listReceivables(
  ctx: Ctx,
  params: { filter?: ReceivablesFilter; q?: string; page?: number },
  now: Date = new Date(),
): Promise<{ rows: ReceivableRow[]; total: number; page: number; pageSize: number; counts: Record<ReceivablesFilter, number>; summary: ReceivablesSummary; searchingAllBranches: boolean }> {
  assertCan(ctx, "payment.record");
  const today = todayInStoreTz(now);
  const todayDb = toDbDate(today);
  const weekEnd = toDbDate(addDays(today, DUE_SOON_DAYS - 1));
  const branchId = ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
  const q = params.q?.trim();
  const searchingAllBranches = Boolean(q) && branchId !== null;
  const digits = q?.replace(/\D/g, "") ?? "";
  const phoneFragment = digits.startsWith("0") ? digits.slice(1) : digits;

  const base: Prisma.InvoiceWhereInput = {
    status: { not: "VOID" },
    OR: [{ installmentPlan: { isNot: null } }, { balance: { gt: 0 } }],
    ...(branchId && !q ? { branchId } : {}),
  };
  const search: Prisma.InvoiceWhereInput = q
    ? {
        OR: [
          { number: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
          ...(phoneFragment.length >= 3 ? [{ customer: { phoneE164: { contains: phoneFragment } } }] : []),
        ],
      }
    : {};
  const overdue: Prisma.InvoiceWhereInput = { balance: { gt: 0 }, ...unsettledRow({ dueDate: { lt: todayDb } }) };
  const dueSoon: Prisma.InvoiceWhereInput = { balance: { gt: 0 }, NOT: overdue, ...unsettledRow({ dueDate: { gte: todayDb, lte: weekEnd } }) };
  const completed: Prisma.InvoiceWhereInput = { balance: { lte: 0 } };
  const filters: Record<ReceivablesFilter, Prisma.InvoiceWhereInput> = { all: {}, due_soon: dueSoon, overdue, completed };
  const filter = params.filter ?? "all";
  const where: Prisma.InvoiceWhereInput = { AND: [base, search, filters[filter]] };
  const page = Math.max(1, params.page ?? 1);

  const [invoices, total, ...counts] = await Promise.all([
    db.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phoneE164: true } },
        branch: { select: { name: true } },
        installmentPlan: {
          select: { remindersEnabled: true, nextDueDate: true, schedule: { where: { status: { notIn: SETTLED } }, orderBy: { sequence: "asc" }, take: 1, select: { dueDate: true } } },
        },
      },
      orderBy: [{ installmentPlan: { nextDueDate: { sort: "asc", nulls: "last" } } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.invoice.count({ where }),
    ...(["all", "due_soon", "overdue", "completed"] as const).map((f) => db.invoice.count({ where: { AND: [base, search, filters[f]] } })),
  ]);

  // The summary strip always describes the branch in view, whatever is being searched.
  const branchSql = branchId ? Prisma.sql`AND i.branch_id = ${branchId}::uuid` : Prisma.empty;
  const [outstanding, schedSums] = await Promise.all([
    db.invoice.aggregate({ where: { status: { not: "VOID" }, balance: { gt: 0 }, ...(branchId ? { branchId } : {}) }, _sum: { balance: true } }),
    db.$queryRaw<{ due_week: Prisma.Decimal | null; overdue_amount: Prisma.Decimal | null; overdue_accounts: bigint }[]>`
          SELECT
            SUM(s.amount_due - s.amount_paid - s.amount_waived) FILTER (WHERE s.due_date BETWEEN ${todayDb} AND ${weekEnd}) AS due_week,
            SUM(s.amount_due - s.amount_paid - s.amount_waived) FILTER (WHERE s.due_date < ${todayDb}) AS overdue_amount,
            COUNT(DISTINCT i.id) FILTER (WHERE s.due_date < ${todayDb}) AS overdue_accounts
          FROM installment_schedules s
          JOIN installment_plans p ON p.id = s.plan_id
          JOIN invoices i ON i.id = p.invoice_id
          WHERE s.status NOT IN ('PAID', 'WAIVED') AND i.status NOT IN ('VOID', 'RETURNED') AND i.balance > 0 ${branchSql}`,
  ]);
  const sums = schedSums[0];

  return {
    rows: invoices.map((inv) => {
      const nextDue = inv.installmentPlan?.schedule[0]?.dueDate ?? null;
      const nextDueDate = inv.balance.gt(0) && nextDue ? fromDbDate(nextDue) : null;
      const dueInDays = nextDueDate ? daysBetween(nextDueDate, today) : null;
      const isOverdue = dueInDays !== null && dueInDays > 0;
      return {
        invoiceId: inv.id,
        number: inv.number,
        customerId: inv.customer.id,
        customerName: inv.customer.name,
        customerPhone: inv.customer.phoneE164,
        branchName: inv.branch.name,
        total: inv.total.toFixed(2),
        amountPaid: inv.amountPaid.toFixed(2),
        balance: inv.balance.toFixed(2),
        paidPercent: inv.total.gt(0) ? Math.min(100, Math.floor(inv.amountPaid.div(inv.total).times(100).toNumber())) : 100,
        status: isOverdue ? "OVERDUE" : inv.status,
        nextDueDate,
        dueInDays,
        remindersEnabled: inv.installmentPlan?.remindersEnabled ?? null,
        canManageReminders: inv.installmentPlan !== null && inv.balance.gt(0) && can(ctx, "reminders.manage", { branchId: inv.branchId }),
        canView: ctx.role === "OWNER" || ctx.branchId === inv.branchId,
      };
    }),
    total,
    page,
    pageSize: PAGE_SIZE,
    counts: { all: counts[0], due_soon: counts[1], overdue: counts[2], completed: counts[3] },
    summary: {
      totalOutstanding: (outstanding._sum.balance ?? new Prisma.Decimal(0)).toFixed(2),
      dueThisWeek: (sums?.due_week ?? new Prisma.Decimal(0)).toFixed(2),
      overdueAmount: (sums?.overdue_amount ?? new Prisma.Decimal(0)).toFixed(2),
      overdueAccounts: Number(sums?.overdue_accounts ?? 0),
    },
    searchingAllBranches,
  };
}

import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { CashUpStatus } from "@/generated/prisma/enums";
import { type CalendarDate, fromDbDate, storeInstant, todayInStoreTz, toDbDate } from "@/lib/dates";
import { z } from "zod";

import { money } from "@/lib/money";
import type { ReviewCashUpInput, SubmitCashUpInput } from "@/lib/validators/cashup";
import { assertCan, can, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError, requireRecordId, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import { getSetting } from "@/server/services/settings.service";

/**
 * Daily cash-up (drawer reconciliation). Each person cashes up their own takings at one branch:
 * every payment they recorded there since their previous cash-up (refunds and reversals they handed
 * out count negative). The count is blind: the form never shows expected figures, so the count
 * can't be made to match. Managers sign off their branch's cash-ups (never their own); owners any.
 */

type Tx = Prisma.TransactionClient;

export type CashUpView = {
  id: string;
  businessDate: CalendarDate;
  periodStart: string;
  periodEnd: string;
  branchName: string;
  userId: string;
  userName: string;
  paymentCount: number;
  openingFloat: string;
  expected: { cash: string; card: string; transfer: string };
  counted: { cash: string; card: string | null; transfer: string | null };
  variance: { cash: string; card: string | null; transfer: string | null };
  note: string | null;
  status: CashUpStatus;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Whether the viewer may sign this one off now. */
  canReview: boolean;
};

/** Where the person is cashing up: their branch, or the owner's chosen branch. */
function drawerBranch(ctx: Ctx): string {
  const branchId = ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
  if (!branchId) throw new ValidationError("Choose the branch you're cashing up at (branch switcher, top left).");
  return branchId;
}

async function lastCashUp(client: Tx | typeof db, userId: string, branchId: string) {
  return client.cashUp.findFirst({ where: { userId, branchId }, orderBy: { periodEnd: "desc" }, select: { periodEnd: true, createdAt: true } });
}

/**
 * Where a drawer's first period starts: when cash-up went live (set by its migration), so someone
 * who never cashes up keeps every payment since then in their drawer; the start of today otherwise.
 */
async function firstPeriodStart(now: Date): Promise<Date> {
  const launched = await getSetting("cashup.startedAt", z.iso.datetime(), "");
  return launched ? new Date(launched) : storeInstant(todayInStoreTz(now), 0, 0);
}

/** A drawer's period starts where the previous cash-up ended (or at the first period start). */
async function periodStartFor(previous: { periodEnd: Date } | null, now: Date): Promise<Date> {
  return previous?.periodEnd ?? (await firstPeriodStart(now));
}

type Takings = { cash: Prisma.Decimal; card: Prisma.Decimal; transfer: Prisma.Decimal; count: number };

async function takings(client: Tx | typeof db, userId: string, branchId: string, from: Date, to: Date): Promise<Takings> {
  const rows = await client.customerPayment.groupBy({
    by: ["method"],
    where: { receivedById: userId, branchId, paidAt: { gte: from, lt: to } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const by = (m: string) => rows.find((r) => r.method === m)?._sum.amount ?? new Prisma.Decimal(0);
  return { cash: by("CASH"), card: by("POS_CARD"), transfer: by("BANK_TRANSFER"), count: rows.reduce((n, r) => n + r._count._all, 0) };
}

export type DrawerStatus = {
  branch: { id: string; name: string } | null;
  /** Where this drawer's period starts (previous cash-up, or the start of today). */
  periodStart: string | null;
  /** How many payments are waiting to be cashed up (the amounts stay hidden until the count is in). */
  paymentCount: number;
  lastCashUpAt: string | null;
};

/** The signed-in person's open drawer, blind: a count of payments, never their total. */
export async function getDrawerStatus(ctx: Ctx, now: Date = new Date()): Promise<DrawerStatus> {
  assertCan(ctx, "cashup.submit");
  const branchId = ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
  if (!branchId) return { branch: null, periodStart: null, paymentCount: 0, lastCashUpAt: null };
  const [branch, previous] = await Promise.all([db.branch.findUniqueOrThrow({ where: { id: branchId }, select: { id: true, name: true } }), lastCashUp(db, ctx.userId, branchId)]);
  const start = await periodStartFor(previous, now);
  const paymentCount = await db.customerPayment.count({ where: { receivedById: ctx.userId, branchId, paidAt: { gte: start, lt: now } } });
  return { branch, periodStart: start.toISOString(), paymentCount, lastCashUpAt: previous?.createdAt.toISOString() ?? null };
}

const viewInclude = { branch: { select: { name: true } }, user: { select: { name: true } }, reviewedBy: { select: { name: true } } } as const;
type CashUpRow = Prisma.CashUpGetPayload<{ include: typeof viewInclude }>;

function toView(ctx: Ctx, row: CashUpRow): CashUpView {
  const fix = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));
  return {
    id: row.id,
    businessDate: fromDbDate(row.businessDate),
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    branchName: row.branch.name,
    userId: row.userId,
    userName: row.user.name,
    paymentCount: row.paymentCount,
    openingFloat: row.openingFloat.toFixed(2),
    expected: { cash: row.expectedCash.toFixed(2), card: row.expectedCard.toFixed(2), transfer: row.expectedTransfer.toFixed(2) },
    counted: { cash: row.countedCash.toFixed(2), card: fix(row.countedCard), transfer: fix(row.countedTransfer) },
    variance: { cash: row.cashVariance.toFixed(2), card: fix(row.cardVariance), transfer: fix(row.transferVariance) },
    note: row.note,
    status: row.status,
    reviewedByName: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    canReview: row.status === "SUBMITTED" && reviewAllowed(ctx, row),
  };
}

function reviewAllowed(ctx: Ctx, row: { branchId: string; userId: string }): boolean {
  // Someone else signs off a drawer; the owner may sign off their own (there may be nobody above them).
  if (row.userId === ctx.userId && ctx.role !== "OWNER") return false;
  return can(ctx, "cashup.review", { branchId: row.branchId });
}

/** Counts the drawer and records the cash-up. Returns it with the expected figures now revealed. */
export async function submitCashUp(ctx: Ctx, input: SubmitCashUpInput, options: { now?: Date } = {}): Promise<CashUpView> {
  assertCan(ctx, "cashup.submit");
  const now = options.now ?? new Date();
  const branchId = drawerBranch(ctx);
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { isActive: true } });
  if (!branch?.isActive) throw new NotFoundError("That branch is not open.");

  return db.$transaction(async (tx) => {
    // One cash-up at a time per drawer: a double click can't create two overlapping periods.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cashup:${ctx.userId}:${branchId}`}))`;
    const previous = await lastCashUp(tx, ctx.userId, branchId);
    const periodStart = await periodStartFor(previous, now);
    if (periodStart >= now) throw new ConflictError("You've just cashed up. Wait a moment before cashing up again.");
    const t = await takings(tx, ctx.userId, branchId, periodStart, now);

    const openingFloat = money(input.openingFloat);
    const countedCash = money(input.countedCash);
    const countedCard = input.countedCard === undefined ? null : money(input.countedCard);
    const countedTransfer = input.countedTransfer === undefined ? null : money(input.countedTransfer);
    const row = await tx.cashUp.create({
      data: {
        branchId,
        userId: ctx.userId,
        periodStart,
        periodEnd: now,
        businessDate: toDbDate(todayInStoreTz(now)),
        paymentCount: t.count,
        openingFloat: openingFloat.toFixed(2),
        expectedCash: t.cash,
        expectedCard: t.card,
        expectedTransfer: t.transfer,
        countedCash: countedCash.toFixed(2),
        countedCard: countedCard?.toFixed(2) ?? null,
        countedTransfer: countedTransfer?.toFixed(2) ?? null,
        cashVariance: countedCash.minus(openingFloat).minus(money(t.cash)).toFixed(2),
        cardVariance: countedCard ? countedCard.minus(money(t.card)).toFixed(2) : null,
        transferVariance: countedTransfer ? countedTransfer.minus(money(t.transfer)).toFixed(2) : null,
        note: input.note || null,
      },
      include: viewInclude,
    });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId,
      action: "cashup.submit",
      entityType: "CashUp",
      entityId: row.id,
      after: { periodStart: periodStart.toISOString(), payments: t.count, cashVariance: row.cashVariance.toFixed(2), cardVariance: row.cardVariance?.toFixed(2) ?? null, transferVariance: row.transferVariance?.toFixed(2) ?? null },
    });
    return toView(ctx, row);
  });
}

/** Signs off a cash-up; any difference needs a note on what was found. */
export async function reviewCashUp(ctx: Ctx, input: ReviewCashUpInput, options: { now?: Date } = {}): Promise<CashUpView> {
  requireRecordId(input.id, "That cash-up no longer exists.");
  const now = options.now ?? new Date();
  const row = await db.cashUp.findUnique({ where: { id: input.id }, include: viewInclude });
  if (!row) throw new NotFoundError("That cash-up no longer exists.");
  assertCan(ctx, "cashup.review", { branchId: row.branchId });
  if (row.userId === ctx.userId && ctx.role !== "OWNER") throw new ForbiddenError("Another manager or the owner signs off your own cash-up.");
  if (row.status !== "SUBMITTED") throw new ConflictError("This cash-up was already signed off.");
  const off = [row.cashVariance, row.cardVariance, row.transferVariance].some((v) => v !== null && !v.isZero());
  if (off && !input.note) throw new ValidationError("This drawer didn't balance. Note what you found (miscount, change given, missing cash…).", { note: ["Required when there is a difference"] });
  return db.$transaction(async (tx) => {
    const updated = await tx.cashUp.update({
      where: { id: row.id, status: "SUBMITTED" },
      data: { status: "REVIEWED", reviewedById: ctx.userId, reviewedAt: now, reviewNote: input.note || null },
      include: viewInclude,
    });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: row.branchId,
      action: "cashup.review",
      entityType: "CashUp",
      entityId: row.id,
      before: { status: "SUBMITTED" },
      after: { status: "REVIEWED", note: input.note || null, cashVariance: row.cashVariance.toFixed(2) },
    });
    return toView(ctx, updated);
  });
}

const PAGE_SIZE = 30;

/** Reviewers see their branch's cash-ups (owners: the active branch, or all); everyone else their own. */
export async function listCashUps(ctx: Ctx, params: { status?: CashUpStatus; page?: number } = {}): Promise<{ rows: CashUpView[]; total: number; page: number; pageSize: number; scope: "own" | "branch" }> {
  assertCan(ctx, "cashup.submit");
  const reviewer = can(ctx, "cashup.review");
  const page = Math.max(1, params.page ?? 1);
  const where: Prisma.CashUpWhereInput = {
    ...(reviewer ? (ctx.role === "OWNER" ? (ctx.activeBranchId ? { branchId: ctx.activeBranchId } : {}) : { branchId: ctx.branchId ?? "" }) : { userId: ctx.userId }),
    ...(params.status ? { status: params.status } : {}),
  };
  const [rows, total] = await Promise.all([
    db.cashUp.findMany({ where, include: viewInclude, orderBy: { periodEnd: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.cashUp.count({ where }),
  ]);
  return { rows: rows.map((r) => toView(ctx, r)), total, page, pageSize: PAGE_SIZE, scope: reviewer ? "branch" : "own" };
}

export type PendingDrawer = { userId: string; userName: string; branchId: string; branchName: string; since: string; payments: number; cash: string; card: string; transfer: string; fromBeforeToday: boolean };

/** For reviewers: everyone else holding takings that aren't cashed up yet, oldest first (never your own: that count is blind). */
export async function pendingDrawers(ctx: Ctx, now: Date = new Date()): Promise<PendingDrawer[]> {
  assertCan(ctx, "cashup.review");
  const branchId = ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
  const todayStart = storeInstant(todayInStoreTz(now), 0, 0);
  const firstStart = await firstPeriodStart(now);
  const branchFilter = branchId ? Prisma.sql`AND p.branch_id = ${branchId}::uuid` : Prisma.empty;
  // A drawer's open period starts at its last cash-up; with none, at the first period start.
  const rows = await db.$queryRaw<
    { user_id: string; user_name: string; branch_id: string; branch_name: string; since: Date; payments: number; cash: Prisma.Decimal; card: Prisma.Decimal; transfer: Prisma.Decimal }[]
  >`
    SELECT p.received_by_id AS user_id, u.name AS user_name, p.branch_id, b.name AS branch_name,
           MIN(p.paid_at) AS since, COUNT(*)::int AS payments,
           COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'CASH'), 0) AS cash,
           COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'POS_CARD'), 0) AS card,
           COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'BANK_TRANSFER'), 0) AS transfer
    FROM customer_payments p
    JOIN users u ON u.id = p.received_by_id
    JOIN branches b ON b.id = p.branch_id
    WHERE p.paid_at < ${now}
      -- A closed branch's drawers can't be cashed up any more, so they would alert forever.
      AND b.is_active
      -- Your own drawer stays blind until you count it, reviewer or not.
      AND p.received_by_id <> ${ctx.userId}::uuid
      AND p.paid_at >= COALESCE(
        (SELECT MAX(c.period_end) FROM cash_ups c WHERE c.user_id = p.received_by_id AND c.branch_id = p.branch_id),
        ${firstStart})
      ${branchFilter}
    GROUP BY p.received_by_id, u.name, p.branch_id, b.name
    ORDER BY since ASC`;
  return rows.map((r) => ({
    userId: r.user_id,
    userName: r.user_name,
    branchId: r.branch_id,
    branchName: r.branch_name,
    since: r.since.toISOString(),
    payments: r.payments,
    cash: money(r.cash).toFixed(2),
    card: money(r.card).toFixed(2),
    transfer: money(r.transfer).toFixed(2),
    fromBeforeToday: r.since < todayStart,
  }));
}

/** Dashboard: drawers not cashed up since before today, and signed-off-pending cash-ups that didn't balance. */
export async function cashUpAlerts(ctx: Ctx, now: Date = new Date()): Promise<{ lateDrawers: PendingDrawer[]; unbalanced: { id: string; userName: string; branchName: string; cashVariance: string; businessDate: CalendarDate }[] }> {
  if (!can(ctx, "cashup.review")) return { lateDrawers: [], unbalanced: [] };
  const branchId = ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
  const [drawers, open] = await Promise.all([
    pendingDrawers(ctx, now),
    db.cashUp.findMany({
      where: { status: "SUBMITTED", ...(branchId ? { branchId } : {}), OR: [{ cashVariance: { not: 0 } }, { cardVariance: { not: 0 } }, { transferVariance: { not: 0 } }] },
      include: viewInclude,
      orderBy: { periodEnd: "asc" },
      take: 20,
    }),
  ]);
  return {
    lateDrawers: drawers.filter((d) => d.fromBeforeToday),
    unbalanced: open.map((c) => ({ id: c.id, userName: c.user.name, branchName: c.branch.name, cashVariance: c.cashVariance.toFixed(2), businessDate: fromDbDate(c.businessDate) })),
  };
}

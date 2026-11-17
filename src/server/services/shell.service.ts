import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { toDbDate, todayInStoreTz } from "@/lib/dates";
import { can, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { agingCountsByBranch, countPendingTradeIns, lowStockCountsByBranch } from "@/server/services/inventory.service";

export type AlertBreakdown = {
  overdueAccounts: number;
  lowStock: number;
  agingUnits: number;
  /** Null when the role may not see payables. */
  overduePayables: number | null;
  failedMessages: number;
  /** Owner only: traded-in devices waiting to be inspected and priced. */
  tradeInsPending: number | null;
  total: number;
};

export type ShellSummary = {
  counts: { invoices: number; openTransfers: number; overdueAccounts: number; failedMessages: number };
  alerts: AlertBreakdown;
  /** Open alerts per branch id, for the rail badges. */
  branchAlerts: Record<string, number>;
};

/** Invoices with at least one instalment past its due date and not fully paid, per selling branch. */
async function overdueAccountsByBranch(ctx: Ctx): Promise<Map<string, number>> {
  const today = toDbDate(todayInStoreTz());
  const scope =
    ctx.activeBranchId === null ? Prisma.sql`TRUE` : Prisma.sql`i.branch_id = ${ctx.activeBranchId}::uuid`;
  const rows = await db.$queryRaw<{ branch_id: string; n: number }[]>`
    SELECT i.branch_id, count(DISTINCT i.id)::int AS n
    FROM invoices i
    JOIN installment_plans p ON p.invoice_id = i.id
    JOIN installment_schedules s ON s.plan_id = p.id
    WHERE i.status IN ('UNPAID', 'PARTIALLY_PAID')
      AND p.status = 'ACTIVE'
      AND s.status IN ('PENDING', 'PARTIAL', 'OVERDUE')
      AND s.due_date < ${today}::date
      AND ${scope}
    GROUP BY i.branch_id`;
  return new Map(rows.map((r) => [r.branch_id, r.n]));
}

function total(map: Map<string, number>): number {
  let n = 0;
  for (const v of map.values()) n += v;
  return n;
}

/** Counts for the nav, the Alerts button and the branch rail. Counts only — no money or cost data. */
export async function getShellSummary(ctx: Ctx): Promise<ShellSummary> {
  const branchFilter = ctx.activeBranchId ? { branchId: ctx.activeBranchId } : {};
  const seesPayables = can(ctx, "payables.view");
  const pricesTradeIns = can(ctx, "price.edit");
  const today = toDbDate(todayInStoreTz());

  // Rail badges always cover every branch the user can pick, so compute those unscoped for owners.
  const railCtx: Ctx = ctx.role === "OWNER" ? { ...ctx, activeBranchId: null } : ctx;

  const [invoices, openTransfers, failedMessages, overduePayables, overdue, lowStock, aging, tradeInsPending] = await Promise.all([
    db.invoice.count({ where: branchFilter }),
    db.stockTransfer.count({
      where: {
        status: { in: ["DRAFT", "IN_TRANSIT"] },
        ...(ctx.activeBranchId
          ? { OR: [{ fromBranchId: ctx.activeBranchId }, { toBranchId: ctx.activeBranchId }] }
          : {}),
      },
    }),
    db.notificationLog.count({
      where: {
        status: "FAILED",
        fallbacks: { none: {} },
        ...(ctx.activeBranchId ? { invoice: { branchId: ctx.activeBranchId } } : {}),
      },
    }),
    seesPayables
      ? db.purchaseOrder.count({ where: { status: { not: "PAID" }, dueDate: { lt: today }, ...branchFilter } })
      : Promise.resolve(null),
    overdueAccountsByBranch(railCtx),
    lowStockCountsByBranch(railCtx),
    agingCountsByBranch(railCtx),
    pricesTradeIns ? countPendingTradeIns(ctx) : Promise.resolve(null),
  ]);

  const branchAlerts: Record<string, number> = {};
  for (const map of [overdue, lowStock, aging]) {
    for (const [branchId, n] of map) branchAlerts[branchId] = (branchAlerts[branchId] ?? 0) + n;
  }

  const inScope = (map: Map<string, number>) =>
    ctx.activeBranchId ? (map.get(ctx.activeBranchId) ?? 0) : total(map);
  const overdueAccounts = inScope(overdue);
  const lowStockCount = inScope(lowStock);
  const agingUnits = inScope(aging);

  return {
    counts: { invoices, openTransfers, overdueAccounts, failedMessages },
    alerts: {
      overdueAccounts,
      lowStock: lowStockCount,
      agingUnits,
      overduePayables,
      failedMessages,
      tradeInsPending,
      total: overdueAccounts + lowStockCount + agingUnits + (overduePayables ?? 0) + failedMessages + (tradeInsPending ?? 0),
    },
    branchAlerts,
  };
}

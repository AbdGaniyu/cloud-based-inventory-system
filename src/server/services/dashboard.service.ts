import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { addDays, type CalendarDate, daysBetween, fromDbDate, storeInstant, todayInStoreTz, toDbDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { type BucketTotals, receivablesAgingSummary, scopeBranchId } from "@/server/services/aging.service";
import { jobHealth } from "@/server/ops/jobs";
import { lowStockCountsByBranch } from "@/server/services/inventory.service";

/**
 * Executive dashboard (CLAUDE.md §7.8, DESIGN.md §5.1). Each figure is scoped to the active branch
 * (owner) or the user's branch. Cost-based figures — net profit, payables, valuation at cost — are
 * computed only for the owner and come back null for everyone else (invariant 9).
 */

export type DashboardRange = "today" | "7d" | "30d" | "month";
export const DASHBOARD_RANGES: { value: DashboardRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "month", label: "This month" },
];

type Period = { from: CalendarDate; to: CalendarDate; start: Date; end: Date };

/** The selected period and the equally long period just before it, as Lagos calendar days. */
export function periodsFor(range: DashboardRange, today: CalendarDate): { current: Period; previous: Period } {
  const from = range === "today" ? today : range === "7d" ? addDays(today, -6) : range === "30d" ? addDays(today, -29) : (`${today.slice(0, 8)}01` as CalendarDate);
  const length = daysBetween(from, today) + 1;
  const make = (f: CalendarDate, t: CalendarDate): Period => ({ from: f, to: t, start: storeInstant(f, 0, 0), end: storeInstant(addDays(t, 1), 0, 0) });
  return { current: make(from, today), previous: make(addDays(from, -length), addDays(from, -1)) };
}

/** A figure with its change against the previous period (null when there is nothing to compare). */
export type Kpi = { value: string; previous: string | null; changePercent: number | null };

export type Dashboard = {
  range: DashboardRange;
  period: { from: CalendarDate; to: CalendarDate };
  kpis: {
    invoiced: Kpi;
    collected: Kpi & { collectionRate: number | null };
    netProfit: Kpi | null;
    receivables: Kpi & { overdue: string };
    payables: (Kpi & { overdue: string }) | null;
    inventory: { value: string; basis: "cost" | "selling"; devices: number; accessories: number } | null;
  };
  trend: { label: string; key: string; invoiced: string; collected: string }[];
  aging: { total: string; buckets: BucketTotals };
  branches: BranchPerformance[] | null;
  topProducts: { productId: string; name: string; units: number; revenue: string }[] | null;
  dueThisWeek: { invoiceId: string; number: string; customerName: string; dueDate: CalendarDate; amount: string; sequence: number }[];
  dueThisWeekTotal: string;
  alerts: DashboardAlert[];
  alertCount: number;
};

export type BranchPerformance = {
  id: string;
  code: string;
  name: string;
  type: "STORE" | "WAREHOUSE";
  /** Same order as the branch switcher, so the row wears the branch's colour. */
  colorIndex: number;
  invoiced: string;
  collected: string;
  collectionRate: number | null;
  receivables: string;
  unitsSold: number;
  stockValue: string;
  lowStock: number;
};

export type DashboardAlert = { id: string; kind: "LOW_STOCK" | "AGING" | "OVERDUE_BILL" | "FAILED_MESSAGE" | "SYSTEM"; title: string; detail: string; href: string };

const ZERO = new Prisma.Decimal(0);
const dec = (v: Prisma.Decimal | null | undefined) => v ?? ZERO;

function change(current: Prisma.Decimal, previous: Prisma.Decimal | null): number | null {
  if (previous === null || previous.isZero()) return null;
  return Number(current.minus(previous).div(previous.abs()).times(100).toFixed(1));
}

function kpi(current: Prisma.Decimal, previous: Prisma.Decimal | null): Kpi {
  return { value: current.toFixed(2), previous: previous?.toFixed(2) ?? null, changePercent: change(current, previous) };
}

const branchSql = (column: string, branchId: string | null) => (branchId ? Prisma.sql`AND ${Prisma.raw(column)} = ${branchId}::uuid` : Prisma.empty);

async function invoicedBetween(branchId: string | null, p: Period): Promise<{ total: Prisma.Decimal; revenueExVat: Prisma.Decimal }> {
  const [row] = await db.$queryRaw<{ total: Prisma.Decimal | null; revenue: Prisma.Decimal | null }[]>`
    SELECT SUM(total) AS total, SUM(subtotal - discount) AS revenue FROM invoices
    WHERE status <> 'VOID' AND created_at >= ${p.start} AND created_at < ${p.end} ${branchSql("branch_id", branchId)}`;
  return { total: dec(row?.total), revenueExVat: dec(row?.revenue) };
}

async function collectedBetween(branchId: string | null, p: Period): Promise<Prisma.Decimal> {
  const [row] = await db.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
    SELECT SUM(amount) AS amount FROM customer_payments WHERE paid_at >= ${p.start} AND paid_at < ${p.end} ${branchSql("branch_id", branchId)}`;
  return dec(row?.amount);
}

/** Cost of goods sold on invoices in the period: the unit cost snapshot taken at checkout. */
async function costOfSalesBetween(branchId: string | null, p: Period): Promise<Prisma.Decimal> {
  const [row] = await db.$queryRaw<{ cost: Prisma.Decimal | null }[]>`
    SELECT SUM(ii.unit_cost * ii.quantity) AS cost FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status <> 'VOID' AND i.created_at >= ${p.start} AND i.created_at < ${p.end} ${branchSql("i.branch_id", branchId)}`;
  return dec(row?.cost);
}

/** What customers owed at an instant: invoiced − paid − waived (returns arrive in step 11). */
async function receivablesAt(branchId: string | null, at: Date): Promise<Prisma.Decimal> {
  const [row] = await db.$queryRaw<{ owed: Prisma.Decimal | null }[]>`
    SELECT
      (SELECT COALESCE(SUM(total - returned_amount), 0) FROM invoices i WHERE status <> 'VOID' AND created_at < ${at} ${branchSql("i.branch_id", branchId)})
      - (SELECT COALESCE(SUM(p.amount), 0) FROM customer_payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.status <> 'VOID' AND p.paid_at < ${at} ${branchSql("i.branch_id", branchId)})
      - (SELECT COALESCE(SUM(a.amount), 0) FROM invoice_adjustments a JOIN invoices i ON i.id = a.invoice_id WHERE i.status <> 'VOID' AND a.created_at < ${at} ${branchSql("i.branch_id", branchId)})
      AS owed`;
  return dec(row?.owed);
}

async function payablesAt(branchId: string | null, at: Date): Promise<Prisma.Decimal> {
  const [row] = await db.$queryRaw<{ owed: Prisma.Decimal | null }[]>`
    SELECT
      (SELECT COALESCE(SUM(total_cost), 0) FROM purchase_orders po WHERE received_at < ${at} ${branchSql("po.branch_id", branchId)})
      - (SELECT COALESCE(SUM(sp.amount), 0) FROM supplier_payments sp JOIN purchase_orders po ON po.id = sp.purchase_order_id WHERE sp.paid_at < ${at} ${branchSql("po.branch_id", branchId)})
      AS owed`;
  return dec(row?.owed);
}

async function inventoryValue(branchId: string | null, basis: "cost" | "selling") {
  const unitPrice = Prisma.raw(basis === "cost" ? "u.cost_price" : "u.selling_price");
  const productPrice = Prisma.raw(basis === "cost" ? "p.default_cost_price" : "p.default_selling_price");
  const [row] = await db.$queryRaw<{ units_value: Prisma.Decimal | null; units: number; acc_value: Prisma.Decimal | null; accessories: number }[]>`
    SELECT
      (SELECT SUM(${unitPrice}) FROM serialized_units u WHERE u.status = 'IN_STOCK' ${branchSql("u.branch_id", branchId)}) AS units_value,
      (SELECT COUNT(*)::int FROM serialized_units u WHERE u.status = 'IN_STOCK' ${branchSql("u.branch_id", branchId)}) AS units,
      (SELECT SUM(bi.quantity * ${productPrice}) FROM branch_inventory bi JOIN products p ON p.id = bi.product_id
        WHERE p.tracking_type = 'NON_SERIALIZED' ${branchSql("bi.branch_id", branchId)}) AS acc_value,
      (SELECT COALESCE(SUM(bi.quantity), 0)::int FROM branch_inventory bi JOIN products p ON p.id = bi.product_id
        WHERE p.tracking_type = 'NON_SERIALIZED' ${branchSql("bi.branch_id", branchId)}) AS accessories`;
  return { value: dec(row?.units_value).plus(dec(row?.acc_value)).toFixed(2), devices: row?.units ?? 0, accessories: row?.accessories ?? 0 };
}

async function overdueReceivables(branchId: string | null, today: CalendarDate): Promise<Prisma.Decimal> {
  const [row] = await db.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
    SELECT SUM(s.amount_due - s.amount_paid - s.amount_waived) AS amount
    FROM installment_schedules s JOIN installment_plans p ON p.id = s.plan_id JOIN invoices i ON i.id = p.invoice_id
    WHERE s.status NOT IN ('PAID', 'WAIVED') AND s.due_date < ${toDbDate(today)}::date AND i.status NOT IN ('VOID', 'RETURNED') AND i.balance > 0
    ${branchSql("i.branch_id", branchId)}`;
  return dec(row?.amount);
}

async function overduePayables(branchId: string | null, today: CalendarDate): Promise<Prisma.Decimal> {
  const [row] = await db.$queryRaw<{ amount: Prisma.Decimal | null }[]>`
    SELECT SUM(total_cost - amount_paid) AS amount FROM purchase_orders po
    WHERE status <> 'PAID' AND due_date < ${toDbDate(today)}::date ${branchSql("po.branch_id", branchId)}`;
  return dec(row?.amount);
}

/** Daily buckets, or hourly for "Today"; every bucket present even when nothing happened. */
async function trend(branchId: string | null, range: DashboardRange, p: Period) {
  const hourly = range === "today";
  const fmt = hourly ? "HH24" : "YYYY-MM-DD";
  const [invoiced, collected] = await Promise.all([
    db.$queryRaw<{ k: string; amount: Prisma.Decimal }[]>`
      SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', ${fmt}) AS k, SUM(total) AS amount FROM invoices
      WHERE status <> 'VOID' AND created_at >= ${p.start} AND created_at < ${p.end} ${branchSql("branch_id", branchId)} GROUP BY 1`,
    db.$queryRaw<{ k: string; amount: Prisma.Decimal }[]>`
      SELECT to_char(paid_at AT TIME ZONE 'Africa/Lagos', ${fmt}) AS k, SUM(amount) AS amount FROM customer_payments
      WHERE paid_at >= ${p.start} AND paid_at < ${p.end} ${branchSql("branch_id", branchId)} GROUP BY 1`,
  ]);
  const inv = new Map(invoiced.map((r) => [r.k, r.amount]));
  const col = new Map(collected.map((r) => [r.k, r.amount]));
  const dayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const keys = hourly
    ? Array.from({ length: 24 }, (_, h) => ({ key: String(h).padStart(2, "0"), label: `${String(h).padStart(2, "0")}:00` }))
    : Array.from({ length: daysBetween(p.from, p.to) + 1 }, (_, i) => {
        const d = addDays(p.from, i);
        return { key: d, label: dayLabel.format(new Date(`${d}T00:00:00Z`)) };
      });
  return keys.map(({ key, label }) => ({ key, label, invoiced: dec(inv.get(key)).toFixed(2), collected: dec(col.get(key)).toFixed(2) }));
}

async function branchPerformance(ctx: Ctx, p: Period): Promise<BranchPerformance[]> {
  const [branches, invoiced, collected, owed, units, stock, lowStock] = await Promise.all([
    db.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, type: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.$queryRaw<{ id: string; amount: Prisma.Decimal }[]>`
      SELECT branch_id AS id, SUM(total) AS amount FROM invoices WHERE status <> 'VOID' AND created_at >= ${p.start} AND created_at < ${p.end} GROUP BY 1`,
    db.$queryRaw<{ id: string; amount: Prisma.Decimal }[]>`
      SELECT branch_id AS id, SUM(amount) AS amount FROM customer_payments WHERE paid_at >= ${p.start} AND paid_at < ${p.end} GROUP BY 1`,
    db.$queryRaw<{ id: string; amount: Prisma.Decimal }[]>`
      SELECT branch_id AS id, SUM(balance) AS amount FROM invoices WHERE status NOT IN ('VOID', 'RETURNED') AND balance > 0 GROUP BY 1`,
    db.$queryRaw<{ id: string; n: number }[]>`
      SELECT i.branch_id AS id, SUM(ii.quantity)::int AS n FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status <> 'VOID' AND i.created_at >= ${p.start} AND i.created_at < ${p.end} GROUP BY 1`,
    db.$queryRaw<{ id: string; amount: Prisma.Decimal }[]>`
      SELECT id, SUM(amount) AS amount FROM (
        SELECT branch_id AS id, cost_price AS amount FROM serialized_units WHERE status = 'IN_STOCK'
        UNION ALL
        SELECT bi.branch_id, bi.quantity * p.default_cost_price FROM branch_inventory bi JOIN products p ON p.id = bi.product_id WHERE p.tracking_type = 'NON_SERIALIZED'
      ) x GROUP BY 1`,
    lowStockCountsByBranch({ ...ctx, activeBranchId: null }),
  ]);
  const map = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const [inv, col, ow, un, st] = [map(invoiced), map(collected), map(owed), map(units), map(stock)];
  return branches.map((b, colorIndex) => {
    const invoicedAmount = dec(inv.get(b.id)?.amount);
    const collectedAmount = dec(col.get(b.id)?.amount);
    return {
      ...b,
      colorIndex,
      invoiced: invoicedAmount.toFixed(2),
      collected: collectedAmount.toFixed(2),
      collectionRate: invoicedAmount.gt(0) ? Math.round(collectedAmount.div(invoicedAmount).times(100).toNumber()) : null,
      receivables: dec(ow.get(b.id)?.amount).toFixed(2),
      unitsSold: un.get(b.id)?.n ?? 0,
      stockValue: dec(st.get(b.id)?.amount).toFixed(2),
      lowStock: lowStock.get(b.id) ?? 0,
    };
  });
}

const ALERT_LIMIT = 8;
const alertDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MS_PER_DAY = 86_400_000;

/** Open stock alerts (refreshed daily at 07:00), overdue supplier bills (owner) and failed messages. */
async function alerts(ctx: Ctx, branchId: string | null, today: CalendarDate, now: Date): Promise<{ items: DashboardAlert[]; count: number }> {
  const branchWhere = branchId ? { branchId } : {};
  const [stock, stockCount, bills, failed] = await Promise.all([
    db.stockAlert.findMany({
      where: { resolvedAt: null, ...branchWhere },
      include: { product: { select: { name: true } }, branch: { select: { name: true } }, serializedUnit: { select: { imei: true, serialNumber: true } } },
      orderBy: [{ type: "desc" }, { value: "asc" }],
      take: ALERT_LIMIT,
    }),
    db.stockAlert.count({ where: { resolvedAt: null, ...branchWhere } }),
    can(ctx, "payables.view")
      ? db.purchaseOrder.findMany({
          where: { status: { not: "PAID" }, dueDate: { lt: toDbDate(today) }, ...branchWhere },
          include: { supplier: { select: { name: true } } },
          orderBy: { dueDate: "asc" },
        })
      : Promise.resolve([]),
    db.notificationLog.findMany({
      where: { status: "FAILED", fallbacks: { none: {} }, ...(branchId ? { invoice: { branchId } } : {}) },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: ALERT_LIMIT,
    }),
  ]);
  // Owner: scheduled jobs that are late or failing, and unexpected server errors in the last day.
  const system: DashboardAlert[] = [];
  if (can(ctx, "settings.view")) {
    const [jobs, errors] = await Promise.all([jobHealth(now), db.errorEvent.count({ where: { createdAt: { gte: new Date(now.getTime() - MS_PER_DAY) } } })]);
    for (const j of jobs.filter((x) => x.status === "stale" || x.status === "failing")) {
      system.push({ id: `job:${j.job}`, kind: "SYSTEM", title: `${j.label} ${j.status === "failing" ? "is failing" : "is not running on schedule"}`, detail: j.lastError ?? "Check the cron set-up", href: "/settings?section=system" });
    }
    if (errors > 0) system.push({ id: "errors", kind: "SYSTEM", title: `${errors} server error${errors === 1 ? "" : "s"} in the last 24 hours`, detail: "See Settings → System", href: "/settings?section=system" });
  }
  const failedCount = await db.notificationLog.count({ where: { status: "FAILED", fallbacks: { none: {} }, ...(branchId ? { invoice: { branchId } } : {}) } });
  const items: DashboardAlert[] = [
    ...system,
    ...bills.map((po) => ({
      id: po.id,
      kind: "OVERDUE_BILL" as const,
      title: `${po.number} overdue · ${po.supplier.name}`,
      detail: `${formatMoney(po.totalCost.minus(po.amountPaid))} owed · was due ${po.dueDate ? alertDate.format(po.dueDate) : "—"}`,
      href: `/suppliers/${po.supplierId}`,
    })),
    ...failed.map((n) => ({
      id: n.id,
      kind: "FAILED_MESSAGE" as const,
      title: `Message failed · ${n.customer.name}`,
      detail: n.error ?? "Not delivered",
      href: n.invoiceId ? `/invoices/${n.invoiceId}` : `/customers/${n.customerId}`,
    })),
    ...stock.map((a) =>
      a.type === "LOW_STOCK"
        ? { id: a.id, kind: "LOW_STOCK" as const, title: `Low stock · ${a.product.name}`, detail: `${a.value} left at ${a.branch.name} (reorder at ${a.threshold})`, href: "/inventory?tab=accessories&low=1" }
        : {
            id: a.id,
            kind: "AGING" as const,
            title: `In stock ${a.value + Math.max(0, Math.floor((now.getTime() - a.lastDetectedAt.getTime()) / MS_PER_DAY))} days · ${a.product.name}`,
            detail: `${a.serializedUnit?.imei ?? a.serializedUnit?.serialNumber ?? ""} at ${a.branch.name}`,
            href: a.serializedUnitId ? `/inventory?unit=${a.serializedUnitId}` : "/inventory",
          },
    ),
  ];
  return { items: items.slice(0, ALERT_LIMIT), count: system.length + bills.length + failedCount + stockCount };
}

export async function getDashboard(ctx: Ctx, range: DashboardRange, now: Date = new Date()): Promise<Dashboard> {
  const branchId = scopeBranchId(ctx);
  const today = todayInStoreTz(now);
  const { current, previous } = periodsFor(range, today);
  const isOwner = can(ctx, "cost.view");
  const seesPayables = can(ctx, "payables.view");
  const valuationBasis = isOwner ? "cost" : ctx.role === "BRANCH_MANAGER" ? "selling" : null;

  const [inv, invPrev, col, colPrev, cost, costPrev, owedNow, owedThen, overdueOwed, payNow, payThen, payOverdue, stockValue, chart, aging, due] = await Promise.all([
    invoicedBetween(branchId, current),
    invoicedBetween(branchId, previous),
    collectedBetween(branchId, current),
    collectedBetween(branchId, previous),
    isOwner ? costOfSalesBetween(branchId, current) : Promise.resolve(null),
    isOwner ? costOfSalesBetween(branchId, previous) : Promise.resolve(null),
    receivablesAt(branchId, now),
    receivablesAt(branchId, current.start),
    overdueReceivables(branchId, today),
    seesPayables ? payablesAt(branchId, now) : Promise.resolve(null),
    seesPayables ? payablesAt(branchId, current.start) : Promise.resolve(null),
    seesPayables ? overduePayables(branchId, today) : Promise.resolve(null),
    valuationBasis ? inventoryValue(branchId, valuationBasis) : Promise.resolve(null),
    trend(branchId, range, current),
    receivablesAgingSummary(ctx, now),
    db.installmentSchedule.findMany({
      where: {
        status: { notIn: ["PAID", "WAIVED"] },
        dueDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, 6)) },
        plan: { invoice: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, balance: { gt: 0 }, ...(branchId ? { branchId } : {}) } },
      },
      include: { plan: { select: { invoice: { select: { id: true, number: true, customer: { select: { name: true } } } } } } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: 50,
    }),
  ]);
  const showBranches = branchId === null;
  const [branches, topProducts, alertList] = await Promise.all([
    showBranches ? branchPerformance(ctx, current) : Promise.resolve(null),
    showBranches
      ? Promise.resolve(null)
      : db.$queryRaw<{ product_id: string; name: string; units: number; revenue: Prisma.Decimal }[]>`
          SELECT ii.product_id, p.name, SUM(ii.quantity)::int AS units, SUM(ii.line_total) AS revenue
          FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN products p ON p.id = ii.product_id
          WHERE i.status <> 'VOID' AND i.created_at >= ${current.start} AND i.created_at < ${current.end} ${branchSql("i.branch_id", branchId)}
          GROUP BY 1, 2 ORDER BY revenue DESC LIMIT 5`,
    alerts(ctx, branchId, today, now),
  ]);

  const dueRows = due.map((r) => ({
    invoiceId: r.plan.invoice.id,
    number: r.plan.invoice.number,
    customerName: r.plan.invoice.customer.name,
    dueDate: fromDbDate(r.dueDate),
    amount: r.amountDue.minus(r.amountPaid).minus(r.amountWaived).toFixed(2),
    sequence: r.sequence,
  }));

  return {
    range,
    period: { from: current.from, to: current.to },
    kpis: {
      invoiced: kpi(inv.total, invPrev.total),
      collected: { ...kpi(col, colPrev), collectionRate: inv.total.gt(0) ? Math.round(col.div(inv.total).times(100).toNumber()) : null },
      netProfit: cost && costPrev ? kpi(inv.revenueExVat.minus(cost), invPrev.revenueExVat.minus(costPrev)) : null,
      receivables: { ...kpi(owedNow, owedThen), overdue: overdueOwed.toFixed(2) },
      payables: payNow && payThen && payOverdue ? { ...kpi(payNow, payThen), overdue: payOverdue.toFixed(2) } : null,
      inventory: stockValue && valuationBasis ? { ...stockValue, basis: valuationBasis } : null,
    },
    trend: chart,
    aging,
    branches,
    topProducts: topProducts?.map((t) => ({ productId: t.product_id, name: t.name, units: t.units, revenue: t.revenue.toFixed(2) })) ?? null,
    dueThisWeek: dueRows.slice(0, 8),
    dueThisWeekTotal: dueRows.reduce((acc, r) => acc.plus(r.amount), ZERO).toFixed(2),
    alerts: alertList.items,
    alertCount: alertList.count,
  };
}

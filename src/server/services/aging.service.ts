import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/aging";
import { addDays, type CalendarDate, fromDbDate, todayInStoreTz, toDbDate } from "@/lib/dates";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";

/**
 * Aging (CLAUDE.md §7.8, DESIGN.md §5.6). Receivables age per instalment (an invoice with no plan
 * that still owes counts as one line, not yet due); payables age per purchase order. Buckets are
 * computed in SQL so the cards, the table and the CSV always agree.
 */

export type BucketTotals = Record<AgingBucket, { amount: string; count: number }>;

export type ReceivableAgingRow = {
  invoiceId: string;
  number: string;
  customerName: string;
  customerPhone: string;
  branchName: string;
  sequence: number | null;
  dueDate: CalendarDate | null;
  daysOverdue: number;
  bucket: AgingBucket;
  amount: string;
};

export type PayableAgingRow = {
  purchaseOrderId: string;
  number: string;
  supplierId: string;
  supplierName: string;
  branchName: string;
  dueDate: CalendarDate | null;
  daysOverdue: number;
  bucket: AgingBucket;
  amount: string;
};

export type AgingReport<Row> = { total: string; buckets: BucketTotals; rows: Row[]; rowCount: number; upcoming: Row[]; upcomingTotal: string };

const UPCOMING_DAYS = 7;
/** CSV exports stop here; the report says so if a scope ever grows past it. */
export const AGING_EXPORT_LIMIT = 5000;

/** Branch the figures cover: the owner's active branch (or all), everyone else their own. */
export function scopeBranchId(ctx: Ctx): string | null {
  return ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
}

const BUCKET_SQL = (days: Prisma.Sql) => Prisma.sql`CASE
  WHEN ${days} <= 0 THEN 'not_due' WHEN ${days} <= 7 THEN 'd1_7' WHEN ${days} <= 14 THEN 'd8_14'
  WHEN ${days} <= 30 THEN 'd15_30' ELSE 'd30_plus' END`;

function receivableLines(branchId: string | null, today: Date): Prisma.Sql {
  const branch = branchId ? Prisma.sql`AND i.branch_id = ${branchId}::uuid` : Prisma.empty;
  return Prisma.sql`
    WITH lines AS (
      SELECT i.id AS id, i.number, c.name AS party, c.phone_e164 AS phone, b.name AS branch_name,
             s.sequence, s.due_date, (s.amount_due - s.amount_paid - s.amount_waived) AS amount
      FROM installment_schedules s
      JOIN installment_plans p ON p.id = s.plan_id
      JOIN invoices i ON i.id = p.invoice_id
      JOIN customers c ON c.id = i.customer_id
      JOIN branches b ON b.id = i.branch_id
      WHERE s.status NOT IN ('PAID', 'WAIVED') AND i.status NOT IN ('VOID', 'RETURNED') AND i.balance > 0 ${branch}
      UNION ALL
      SELECT i.id, i.number, c.name, c.phone_e164, b.name, NULL, NULL, i.balance
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN branches b ON b.id = i.branch_id
      WHERE i.balance > 0 AND i.status NOT IN ('VOID', 'RETURNED')
        AND NOT EXISTS (SELECT 1 FROM installment_plans p WHERE p.invoice_id = i.id) ${branch}
    ), aged AS (
      SELECT *, CASE WHEN due_date IS NULL OR due_date >= ${today}::date THEN 0 ELSE (${today}::date - due_date) END AS days
      FROM lines WHERE amount > 0
    )
    SELECT *, ${BUCKET_SQL(Prisma.sql`days`)} AS bucket FROM aged`;
}

function payableLines(branchId: string | null, today: Date): Prisma.Sql {
  const branch = branchId ? Prisma.sql`AND po.branch_id = ${branchId}::uuid` : Prisma.empty;
  return Prisma.sql`
    WITH aged AS (
      SELECT po.id AS id, po.number, s.id AS supplier_id, s.name AS party, b.name AS branch_name, po.due_date,
             (po.total_cost - po.amount_paid) AS amount,
             CASE WHEN po.due_date IS NULL OR po.due_date >= ${today}::date THEN 0 ELSE (${today}::date - po.due_date) END AS days
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN branches b ON b.id = po.branch_id
      WHERE po.status <> 'PAID' AND po.total_cost > po.amount_paid ${branch}
    )
    SELECT *, ${BUCKET_SQL(Prisma.sql`days`)} AS bucket FROM aged`;
}

type RawLine = {
  id: string;
  number: string;
  party: string;
  phone?: string;
  supplier_id?: string;
  branch_name: string;
  sequence?: number | null;
  due_date: Date | null;
  amount: Prisma.Decimal;
  days: number;
  bucket: AgingBucket;
};

async function bucketTotals(lines: Prisma.Sql): Promise<{ total: string; buckets: BucketTotals }> {
  const rows = await db.$queryRaw<{ bucket: AgingBucket; amount: Prisma.Decimal; n: number }[]>`
    SELECT bucket, SUM(amount) AS amount, COUNT(*)::int AS n FROM (${lines}) x GROUP BY bucket`;
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, { amount: "0.00", count: 0 }])) as BucketTotals;
  let total = new Prisma.Decimal(0);
  for (const r of rows) {
    buckets[r.bucket] = { amount: r.amount.toFixed(2), count: r.n };
    total = total.plus(r.amount);
  }
  return { total: total.toFixed(2), buckets };
}

async function fetchLines(lines: Prisma.Sql, where: Prisma.Sql, limit: number, offset: number): Promise<{ rows: RawLine[]; count: number }> {
  const [rows, count] = await Promise.all([
    db.$queryRaw<RawLine[]>`SELECT * FROM (${lines}) x WHERE ${where} ORDER BY days DESC, due_date ASC NULLS LAST, number ASC LIMIT ${limit} OFFSET ${offset}`,
    db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM (${lines}) x WHERE ${where}`,
  ]);
  return { rows, count: count[0]?.n ?? 0 };
}

function upcomingWhere(today: CalendarDate): Prisma.Sql {
  return Prisma.sql`due_date BETWEEN ${toDbDate(today)}::date AND ${toDbDate(addDays(today, UPCOMING_DAYS - 1))}::date`;
}

const bucketWhere = (bucket: AgingBucket | undefined) => (bucket ? Prisma.sql`bucket = ${bucket}` : Prisma.sql`TRUE`);

function toReceivable(r: RawLine): ReceivableAgingRow {
  return {
    invoiceId: r.id,
    number: r.number,
    customerName: r.party,
    customerPhone: r.phone ?? "",
    branchName: r.branch_name,
    sequence: r.sequence ?? null,
    dueDate: r.due_date ? fromDbDate(r.due_date) : null,
    daysOverdue: r.days,
    bucket: r.bucket,
    amount: r.amount.toFixed(2),
  };
}

function toPayable(r: RawLine): PayableAgingRow {
  return {
    purchaseOrderId: r.id,
    number: r.number,
    supplierId: r.supplier_id ?? "",
    supplierName: r.party,
    branchName: r.branch_name,
    dueDate: r.due_date ? fromDbDate(r.due_date) : null,
    daysOverdue: r.days,
    bucket: r.bucket,
    amount: r.amount.toFixed(2),
  };
}

type ReportParams = { bucket?: AgingBucket; limit?: number; offset?: number; now?: Date };

/** Customer receivables by instalment. Amounts only, no cost data: managers see their own branch. */
export async function receivablesAging(ctx: Ctx, params: ReportParams = {}): Promise<AgingReport<ReceivableAgingRow>> {
  assertCan(ctx, "report.view");
  const today = todayInStoreTz(params.now ?? new Date());
  const lines = receivableLines(scopeBranchId(ctx), toDbDate(today));
  const [summary, page, upcoming] = await Promise.all([
    bucketTotals(lines),
    fetchLines(lines, bucketWhere(params.bucket), params.limit ?? 100, params.offset ?? 0),
    fetchLines(lines, upcomingWhere(today), 50, 0),
  ]);
  return {
    ...summary,
    rows: page.rows.map(toReceivable),
    rowCount: page.count,
    upcoming: upcoming.rows.map(toReceivable).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
    upcomingTotal: upcoming.rows.reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0)).toFixed(2),
  };
}

/** Supplier payables by purchase order. Owner only (invariant 9). */
export async function payablesAging(ctx: Ctx, params: ReportParams = {}): Promise<AgingReport<PayableAgingRow>> {
  assertCan(ctx, "payables.view");
  const today = todayInStoreTz(params.now ?? new Date());
  const lines = payableLines(scopeBranchId(ctx), toDbDate(today));
  const [summary, page, upcoming] = await Promise.all([
    bucketTotals(lines),
    fetchLines(lines, bucketWhere(params.bucket), params.limit ?? 100, params.offset ?? 0),
    fetchLines(lines, upcomingWhere(today), 50, 0),
  ]);
  return {
    ...summary,
    rows: page.rows.map(toPayable),
    rowCount: page.count,
    upcoming: upcoming.rows.map(toPayable).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
    upcomingTotal: upcoming.rows.reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0)).toFixed(2),
  };
}

/** Receivables bucket totals for the dashboard panel; all staff see their own scope. */
export async function receivablesAgingSummary(ctx: Ctx, now: Date = new Date()): Promise<{ total: string; buckets: BucketTotals }> {
  assertCan(ctx, "dashboard.view");
  return bucketTotals(receivableLines(scopeBranchId(ctx), toDbDate(todayInStoreTz(now))));
}

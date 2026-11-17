import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { addDays, type CalendarDate, storeInstant } from "@/lib/dates";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";

/**
 * Audit log viewer (DESIGN.md §5.12). Read-only: there is no code path that edits or deletes audit
 * rows (invariant 7; the table also rejects UPDATE/DELETE). Owners see every branch; managers see
 * their own branch, with cost figures removed (invariant 9).
 */

export type AuditRow = {
  id: string;
  createdAt: string;
  userName: string | null;
  branchName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  ip: string | null;
};

export type AuditFilters = { userId?: string; branchId?: string; action?: string; from?: CalendarDate; to?: CalendarDate; q?: string; page?: number };

const PAGE_SIZE = 50;
const COST_KEY = /cost|margin|profit/i;

/** Removes cost-like fields at any depth for people who may not see cost data. */
export function redactCosts(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (Array.isArray(value)) return value.map((v) => redactCosts(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !COST_KEY.test(k)).map(([k, v]) => [k, redactCosts(v ?? null)]));
  }
  return value;
}

const SUMMARY_KEYS = ["number", "invoiceNumber", "purchaseOrderNumber", "name", "email", "key"] as const;

function summarise(after: Prisma.JsonValue | null, before: Prisma.JsonValue | null): string {
  const pick = (v: Prisma.JsonValue | null) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const a = pick(after);
  const b = pick(before);
  const label = SUMMARY_KEYS.map((k) => a[k] ?? b[k]).find((v) => typeof v === "string");
  const amount = ["amount", "creditAmount", "refundAmount"].map((k) => a[k]).find((v) => typeof v === "string" || typeof v === "number");
  return [label, amount !== undefined ? `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}` : null].filter(Boolean).join(" · ");
}

export async function listAuditLogs(
  ctx: Ctx,
  filters: AuditFilters,
): Promise<{ rows: AuditRow[]; total: number; page: number; pageSize: number; actions: string[]; users: { id: string; name: string }[] }> {
  const branchId = ctx.role === "OWNER" ? (filters.branchId ?? ctx.activeBranchId ?? undefined) : (ctx.branchId ?? undefined);
  assertCan(ctx, "audit.view", ctx.role === "OWNER" ? undefined : { branchId: branchId ?? null });
  const q = filters.q?.trim();
  const where: Prisma.AuditLogWhereInput = {
    ...(branchId ? { branchId } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.action ? (filters.action.endsWith(".") ? { action: { startsWith: filters.action } } : { action: filters.action }) : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: storeInstant(filters.from, 0, 0) } : {}), ...(filters.to ? { lt: storeInstant(addDays(filters.to, 1), 0, 0) } : {}) } }
      : {}),
    ...(q
      ? {
          OR: [
            { entityId: q },
            { after: { path: ["number"], equals: q } },
            { after: { path: ["invoiceNumber"], equals: q } },
            { before: { path: ["invoiceNumber"], equals: q } },
            { after: { path: ["purchaseOrderNumber"], equals: q } },
            { after: { path: ["email"], equals: q.toLowerCase() } },
          ],
        }
      : {}),
  };
  const page = Math.max(1, filters.page ?? 1);
  const scope = branchId ? { branchId } : {};
  const [rows, total, actions, users] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { name: true } }, branch: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["action"], where: scope, orderBy: { action: "asc" } }),
    db.user.findMany({ where: { auditLogs: { some: scope } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const owner = ctx.role === "OWNER";
  return {
    rows: rows.map((r) => {
      const before = owner ? r.before : redactCosts(r.before);
      const after = owner ? r.after : redactCosts(r.after);
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        userName: r.user?.name ?? null,
        branchName: r.branch?.name ?? null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        summary: summarise(after, before),
        before,
        after,
        ip: r.ip,
      };
    }),
    total,
    page,
    pageSize: PAGE_SIZE,
    actions: actions.map((a) => a.action),
    users,
  };
}

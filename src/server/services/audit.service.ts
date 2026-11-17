import type { Prisma } from "@/generated/prisma/client";

export type AuditEntry = {
  userId: string | null;
  branchId: string | null;
  /** dot.case verb, e.g. invoice.create, transfer.ship */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

/** Decimals → strings, Dates → ISO strings, undefined dropped: a plain JSON snapshot. */
export function toAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Writes an audit row. Always pass the transaction client of the mutation being audited so that a
 * failed audit write rolls the mutation back (invariant 2). audit_logs is append-only (invariant 7).
 */
export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      branchId: entry.branchId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: toAuditJson(entry.before),
      after: toAuditJson(entry.after),
      ip: entry.ip ?? null,
    },
  });
}

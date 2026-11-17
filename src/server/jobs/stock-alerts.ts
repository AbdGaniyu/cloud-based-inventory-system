import "server-only";

import type { StockAlertType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { agingThresholdDays } from "@/server/services/inventory.service";

/**
 * Daily 07:00 (CLAUDE.md §7.1): records every low-stock accessory and every serialized unit in
 * stock past the aging threshold as an open StockAlert, keeps first/last detection dates, and
 * resolves alerts whose condition has cleared. A condition that returns reopens its alert.
 */

export type StockAlertSummary = { lowStock: number; aging: number; opened: number; resolved: number };

const MS_PER_DAY = 86_400_000;

type Detected = { dedupeKey: string; type: StockAlertType; branchId: string; productId: string; serializedUnitId: string | null; value: number; threshold: number };

async function detect(now: Date): Promise<Detected[]> {
  const days = await agingThresholdDays();
  const [low, aged] = await Promise.all([
    db.$queryRaw<{ branch_id: string; product_id: string; quantity: number; threshold: number }[]>`
      SELECT bi.branch_id, bi.product_id, bi.quantity, COALESCE(bi.reorder_level, p.reorder_level) AS threshold
      FROM branch_inventory bi
      JOIN products p ON p.id = bi.product_id
      JOIN branches b ON b.id = bi.branch_id
      WHERE p.is_active AND b.is_active
        AND p.tracking_type = 'NON_SERIALIZED'
        AND COALESCE(bi.reorder_level, p.reorder_level) > 0
        AND bi.quantity <= COALESCE(bi.reorder_level, p.reorder_level)`,
    db.serializedUnit.findMany({
      where: { status: "IN_STOCK", receivedAt: { lt: new Date(now.getTime() - days * MS_PER_DAY) } },
      select: { id: true, productId: true, branchId: true, receivedAt: true },
    }),
  ]);
  return [
    ...low.map((r) => ({
      dedupeKey: `LOW_STOCK:${r.branch_id}:${r.product_id}`,
      type: "LOW_STOCK" as const,
      branchId: r.branch_id,
      productId: r.product_id,
      serializedUnitId: null,
      value: r.quantity,
      threshold: r.threshold,
    })),
    ...aged.map((u) => ({
      dedupeKey: `AGING:${u.id}`,
      type: "AGING" as const,
      branchId: u.branchId,
      productId: u.productId,
      serializedUnitId: u.id,
      value: Math.floor((now.getTime() - u.receivedAt.getTime()) / MS_PER_DAY),
      threshold: days,
    })),
  ];
}

export async function runStockAlerts(options: { now?: Date } = {}): Promise<StockAlertSummary> {
  const now = options.now ?? new Date();
  const detected = await detect(now);
  const existing = new Map(
    (await db.stockAlert.findMany({ where: { dedupeKey: { in: detected.map((d) => d.dedupeKey) } }, select: { dedupeKey: true, resolvedAt: true } })).map((a) => [a.dedupeKey, a]),
  );

  let opened = 0;
  const fresh = detected.filter((d) => !existing.has(d.dedupeKey));
  if (fresh.length > 0) {
    // skipDuplicates: a concurrent run may have inserted the same alert.
    opened += (await db.stockAlert.createMany({ data: fresh.map((d) => ({ ...d, firstDetectedAt: now, lastDetectedAt: now })), skipDuplicates: true })).count;
  }
  for (const d of detected) {
    const alert = existing.get(d.dedupeKey);
    if (!alert) continue;
    const reopening = alert.resolvedAt !== null;
    if (reopening) opened++;
    await db.stockAlert.update({
      where: { dedupeKey: d.dedupeKey },
      data: { value: d.value, threshold: d.threshold, branchId: d.branchId, lastDetectedAt: now, ...(reopening ? { resolvedAt: null, firstDetectedAt: now } : {}) },
    });
  }
  const resolved = await db.stockAlert.updateMany({
    where: { resolvedAt: null, dedupeKey: { notIn: detected.map((d) => d.dedupeKey) } },
    data: { resolvedAt: now },
  });
  return { lowStock: detected.filter((d) => d.type === "LOW_STOCK").length, aging: detected.filter((d) => d.type === "AGING").length, opened, resolved: resolved.count };
}

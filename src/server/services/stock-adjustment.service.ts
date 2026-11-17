import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { StockAdjustmentReason, UnitStatus } from "@/generated/prisma/enums";
import { money } from "@/lib/money";
import { UNIT_TRANSITIONS } from "@/lib/stock-adjustments";
import type { AccessoryAdjustmentInput, StockCountInput, UnitAdjustmentInput } from "@/lib/validators/stock";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, requireRecordId, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";

/**
 * Stock adjustments (owner only, CLAUDE.md §8 "adjust stock"): every change to stock that is not a
 * sale, intake, transfer or return goes through here with a reason, and leaves an append-only
 * StockAdjustment row plus an audit row in the same transaction. A stock count compares what is on
 * the shelf with what the system expects and turns each difference into an adjustment.
 */

type Tx = Prisma.TransactionClient;

const sellable = (status: UnitStatus) => (status === "IN_STOCK" ? 1 : 0);

async function lockShelf(tx: Tx, branchId: string, productId: string): Promise<number> {
  // Create the row if this branch never stocked the product, then lock it so a sale waits.
  await tx.branchInventory.upsert({ where: { productId_branchId: { productId, branchId } }, create: { productId, branchId, quantity: 0 }, update: {} });
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT quantity FROM branch_inventory WHERE product_id = ${productId}::uuid AND branch_id = ${branchId}::uuid FOR UPDATE`;
  return rows[0]?.quantity ?? 0;
}

async function openBranch(branchId: string): Promise<{ id: string; code: string; name: string }> {
  requireRecordId(branchId, "That branch no longer exists.");
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true, name: true, isActive: true } });
  if (!branch?.isActive) throw new NotFoundError("That branch is not open.");
  return branch;
}

async function accessoryProduct(productId: string) {
  requireRecordId(productId, "That product no longer exists.");
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, name: true, trackingType: true, defaultCostPrice: true } });
  if (!product) throw new NotFoundError("That product no longer exists.");
  if (product.trackingType !== "NON_SERIALIZED") throw new ValidationError("Devices are adjusted one by one, by IMEI or serial.");
  return product;
}

/** Changes an accessory's shelf quantity at one branch: by an amount, or to a counted figure. */
export async function adjustAccessory(ctx: Ctx, input: AccessoryAdjustmentInput): Promise<{ quantityBefore: number; quantityAfter: number }> {
  assertCan(ctx, "stock.adjust");
  const [branch, product] = await Promise.all([openBranch(input.branchId), accessoryProduct(input.productId)]);
  return db.$transaction(async (tx) => {
    const before = await lockShelf(tx, branch.id, product.id);
    const after = input.mode === "set" ? input.quantity : before + input.quantity;
    if (after < 0) throw new ValidationError(`Only ${before} on the shelf at ${branch.name}; you can't remove ${-input.quantity}.`, { quantity: ["More than on the shelf"] });
    if (after === before) throw new ValidationError(`${branch.name} already has ${before}. Nothing to change.`, { quantity: ["No change"] });
    await tx.branchInventory.update({ where: { productId_branchId: { productId: product.id, branchId: branch.id } }, data: { quantity: after } });
    const row = await tx.stockAdjustment.create({
      data: {
        branchId: branch.id,
        productId: product.id,
        quantityChange: after - before,
        quantityBefore: before,
        quantityAfter: after,
        reason: input.reason,
        note: input.note || null,
        unitCost: product.defaultCostPrice,
        createdById: ctx.userId,
      },
    });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: branch.id,
      action: "stock.adjust",
      entityType: "StockAdjustment",
      entityId: row.id,
      before: { product: product.name, quantity: before },
      after: { quantity: after, reason: input.reason, note: input.note || null },
    });
    return { quantityBefore: before, quantityAfter: after };
  });
}

async function moveUnit(tx: Tx, ctx: Ctx, unit: { id: string; productId: string; branchId: string; status: UnitStatus; costPrice: Prisma.Decimal; label: string }, to: UnitStatus, reason: StockAdjustmentReason, note: string | null, stockCountId: string | null) {
  const allowed = UNIT_TRANSITIONS[unit.status]?.[to];
  if (!allowed) throw new ConflictError(`A device that is ${unit.status.toLowerCase().replace("_", " ")} can't be adjusted to ${to.toLowerCase().replace("_", " ")}.`);
  if (!allowed.includes(reason)) throw new ValidationError("That reason doesn't fit this change.", { reason: ["Pick another reason"] });
  // Conditional update: if the device was sold or shipped a moment ago, nothing changes.
  const moved = await tx.serializedUnit.updateMany({ where: { id: unit.id, status: unit.status, branchId: unit.branchId }, data: { status: to } });
  if (moved.count !== 1) throw new ConflictError(`${unit.label} changed while you were working (sold or moved). Refresh and try again.`);
  const row = await tx.stockAdjustment.create({
    data: {
      branchId: unit.branchId,
      productId: unit.productId,
      serializedUnitId: unit.id,
      quantityChange: sellable(to) - sellable(unit.status),
      fromStatus: unit.status,
      toStatus: to,
      reason,
      note,
      unitCost: unit.costPrice,
      stockCountId,
      createdById: ctx.userId,
    },
  });
  await writeAudit(tx, {
    userId: ctx.userId,
    branchId: unit.branchId,
    action: "stock.adjust",
    entityType: "SerializedUnit",
    entityId: unit.id,
    before: { status: unit.status },
    after: { status: to, reason, note, adjustmentId: row.id, stockCountId },
  });
}

const unitSelect = { id: true, productId: true, branchId: true, status: true, costPrice: true, imei: true, serialNumber: true, product: { select: { name: true } } } as const;
const unitLabel = (u: { imei: string | null; serialNumber: string | null; product: { name: string } }) => `${u.product.name} ${u.imei ?? u.serialNumber ?? ""}`.trim();

/** Changes one device's status: damaged, written off (lost, stolen), repaired, or found again. */
export async function adjustUnit(ctx: Ctx, input: UnitAdjustmentInput): Promise<{ status: UnitStatus }> {
  assertCan(ctx, "stock.adjust");
  requireRecordId(input.unitId, "That device no longer exists.");
  return db.$transaction(async (tx) => {
    const unit = await tx.serializedUnit.findUnique({ where: { id: input.unitId }, select: unitSelect });
    if (!unit) throw new NotFoundError("That device no longer exists.");
    await moveUnit(tx, ctx, { ...unit, label: unitLabel(unit) }, input.toStatus, input.reason, input.note || null, null);
    return { status: input.toStatus };
  });
}

// ─── Stock counts ────────────────────────────────────────────────────────────

export type CountSheet = {
  branch: { id: string; code: string; name: string };
  accessories: { productId: string; name: string; sku: string; expected: number }[];
  units: { id: string; label: string; identifier: string; productName: string }[];
};

/** What the system expects on the shelf at a branch right now: accessory quantities and in-stock devices. */
export async function getCountSheet(ctx: Ctx, branchId: string): Promise<CountSheet> {
  assertCan(ctx, "stock.adjust");
  const branch = await openBranch(branchId);
  const [products, shelves, units] = await Promise.all([
    db.product.findMany({ where: { trackingType: "NON_SERIALIZED" }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" } }),
    db.branchInventory.findMany({ where: { branchId }, select: { productId: true, quantity: true } }),
    db.serializedUnit.findMany({ where: { branchId, status: "IN_STOCK" }, select: unitSelect, orderBy: [{ product: { name: "asc" } }, { receivedAt: "asc" }] }),
  ]);
  const onShelf = new Map(shelves.map((s) => [s.productId, s.quantity]));
  return {
    branch: { id: branch.id, code: branch.code, name: branch.name },
    accessories: products.map((p) => ({ productId: p.id, name: p.name, sku: p.sku, expected: onShelf.get(p.id) ?? 0 })),
    units: units.map((u) => ({ id: u.id, label: unitLabel(u), identifier: u.imei ?? u.serialNumber ?? "", productName: u.product.name })),
  };
}

export type CountReview = {
  /** Lines whose stock changed after counting started (a sale, delivery or transfer): count them again. */
  moved: { name: string; atStart: number; now: number }[];
  accessories: { productId: string; name: string; expected: number; counted: number; difference: number; value: string }[];
  missing: { id: string; label: string; identifier: string; value: string }[];
  matched: number;
  /** Scanned codes that aren't in stock here, with where the system has them. */
  unexpected: { identifier: string; where: string }[];
  /** Net value of the differences at cost (negative = loss). */
  netValue: string;
};

function normaliseCode(code: string): string {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

/** Compares a count with the system. Read-only; `applyStockCount` re-checks everything under locks. */
export async function reviewStockCount(ctx: Ctx, input: StockCountInput): Promise<CountReview> {
  assertCan(ctx, "stock.adjust");
  const sheet = await getCountSheet(ctx, input.branchId);
  const costs = new Map(
    (await db.product.findMany({ where: { id: { in: input.accessories.map((a) => a.productId) } }, select: { id: true, defaultCostPrice: true } })).map((p) => [p.id, p.defaultCostPrice]),
  );
  const moved: CountReview["moved"] = [];
  const accessories = input.accessories.flatMap((line) => {
    const current = sheet.accessories.find((a) => a.productId === line.productId);
    if (!current) throw new ValidationError("One of the counted lines is not an accessory.");
    if (current.expected !== line.expected) moved.push({ name: current.name, atStart: line.expected, now: current.expected });
    const difference = line.counted - line.expected;
    if (difference === 0) return [];
    return [{ productId: line.productId, name: current.name, expected: line.expected, counted: line.counted, difference, value: money(costs.get(line.productId) ?? 0).times(difference).toFixed(2) }];
  });

  const scanned = new Set(input.scanned.map(normaliseCode).filter(Boolean));
  const unitCosts = new Map((await db.serializedUnit.findMany({ where: { id: { in: sheet.units.map((u) => u.id) } }, select: { id: true, costPrice: true } })).map((u) => [u.id, u.costPrice]));
  // Missing = listed when counting started, still in stock here now, and not scanned. A device sold or
  // moved during the count is no longer in stock; one that arrived during it was never on the sheet.
  const onSheet = new Set(input.sheetUnitIds);
  const missing = input.countDevices
    ? sheet.units.filter((u) => onSheet.has(u.id) && !scanned.has(normaliseCode(u.identifier))).map((u) => ({ id: u.id, label: u.label, identifier: u.identifier, value: money(unitCosts.get(u.id) ?? 0).negated().toFixed(2) }))
    : [];
  const known = new Set(sheet.units.map((u) => normaliseCode(u.identifier)));
  const strangers = [...scanned].filter((code) => !known.has(code));
  const found = strangers.length
    ? await db.serializedUnit.findMany({
        where: { OR: [{ imei: { in: strangers } }, { serialNumber: { in: strangers } }] },
        select: { imei: true, serialNumber: true, status: true, branch: { select: { name: true } } },
      })
    : [];
  const unexpected = strangers.map((code) => {
    const unit = found.find((u) => normaliseCode(u.imei ?? "") === code || normaliseCode(u.serialNumber ?? "") === code);
    return { identifier: code, where: unit ? `${unit.status.toLowerCase().replace("_", " ")} · ${unit.branch.name}` : "not in the system" };
  });

  const netValue = [...accessories.map((a) => money(a.value)), ...missing.map((m) => money(m.value))].reduce((a, b) => a.plus(b), money(0));
  const matched = sheet.units.filter((u) => scanned.has(normaliseCode(u.identifier))).length;
  return { moved, accessories, missing, matched, unexpected, netValue: netValue.toFixed(2) };
}

/**
 * Applies a count in one transaction: each differing accessory line is set to the counted figure and
 * each device not scanned is written off as lost. The count's expected figures must still match the
 * shelf (a sale during the count would otherwise be counted twice), so the count is refused if
 * anything moved; count again or adjust that line by hand.
 */
export async function applyStockCount(ctx: Ctx, input: StockCountInput): Promise<{ stockCountId: string; adjustments: number }> {
  assertCan(ctx, "stock.adjust");
  const review = await reviewStockCount(ctx, input);
  if (review.moved.length > 0) {
    throw new ConflictError(`Stock changed during the count: ${review.moved.map((m) => `${m.name} (${m.atStart} → ${m.now})`).join(", ")}. Count those lines again.`);
  }
  const branch = await openBranch(input.branchId);
  return db.$transaction(async (tx) => {
    const count = await tx.stockCount.create({
      data: { branchId: branch.id, note: input.note || null, linesCounted: input.accessories.length, unitsCounted: input.countDevices ? review.matched + review.missing.length : 0, createdById: ctx.userId },
    });
    let adjustments = 0;
    for (const line of review.accessories) {
      const now = await lockShelf(tx, branch.id, line.productId);
      if (now !== line.expected) throw new ConflictError(`${line.name} changed during the count (now ${now}, was ${line.expected}). Count that line again.`);
      await tx.branchInventory.update({ where: { productId_branchId: { productId: line.productId, branchId: branch.id } }, data: { quantity: line.counted } });
      const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { defaultCostPrice: true } });
      await tx.stockAdjustment.create({
        data: { branchId: branch.id, productId: line.productId, quantityChange: line.difference, quantityBefore: now, quantityAfter: line.counted, reason: "COUNT_CORRECTION", note: input.note || null, unitCost: product.defaultCostPrice, stockCountId: count.id, createdById: ctx.userId },
      });
      adjustments++;
    }
    for (const m of review.missing) {
      const unit = await tx.serializedUnit.findUniqueOrThrow({ where: { id: m.id }, select: unitSelect });
      if (unit.status !== "IN_STOCK" || unit.branchId !== branch.id) throw new ConflictError(`${m.label} was sold or moved during the count. Review the count again.`);
      await moveUnit(tx, ctx, { ...unit, label: m.label }, "WRITTEN_OFF", "COUNT_CORRECTION", `Not found in stock count${input.note ? `: ${input.note}` : ""}`, count.id);
      adjustments++;
    }
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: branch.id,
      action: "stock.count",
      entityType: "StockCount",
      entityId: count.id,
      after: { accessoryLinesChanged: review.accessories.length, devicesWrittenOff: review.missing.length, unexpectedScans: review.unexpected.length, netValue: review.netValue },
    });
    return { stockCountId: count.id, adjustments };
  });
}

// ─── History ────────────────────────────────────────────────────────────────

export type AdjustmentRow = {
  id: string;
  createdAt: string;
  branchName: string;
  productName: string;
  identifier: string | null;
  change: string;
  quantityChange: number;
  reason: StockAdjustmentReason;
  note: string | null;
  byName: string;
  value: string;
  fromCount: boolean;
};

const HISTORY_PAGE = 50;

export async function listAdjustments(ctx: Ctx, params: { branchId?: string | null; page?: number } = {}): Promise<{ rows: AdjustmentRow[]; total: number; page: number; pageSize: number }> {
  assertCan(ctx, "stock.adjust");
  const page = Math.max(1, params.page ?? 1);
  const where: Prisma.StockAdjustmentWhereInput = params.branchId ? { branchId: params.branchId } : {};
  const [rows, total] = await Promise.all([
    db.stockAdjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * HISTORY_PAGE,
      take: HISTORY_PAGE,
      include: { branch: { select: { name: true } }, product: { select: { name: true } }, serializedUnit: { select: { imei: true, serialNumber: true } }, createdBy: { select: { name: true } } },
    }),
    db.stockAdjustment.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      branchName: r.branch.name,
      productName: r.product.name,
      identifier: r.serializedUnit ? (r.serializedUnit.imei ?? r.serializedUnit.serialNumber) : null,
      change: r.serializedUnit ? `${STATUS_WORD[r.fromStatus ?? "IN_STOCK"]} → ${STATUS_WORD[r.toStatus ?? "IN_STOCK"]}` : `${r.quantityBefore} → ${r.quantityAfter}`,
      quantityChange: r.quantityChange,
      reason: r.reason,
      note: r.note,
      byName: r.createdBy.name,
      value: r.unitCost.times(r.quantityChange).toFixed(2),
      fromCount: r.stockCountId !== null,
    })),
    total,
    page,
    pageSize: HISTORY_PAGE,
  };
}

const STATUS_WORD: Record<UnitStatus, string> = {
  IN_STOCK: "In stock",
  IN_TRANSIT: "In transit",
  SOLD: "Sold",
  RETURNED: "Returned",
  DEFECTIVE: "Defective",
  TRADED_IN: "Traded in",
  WRITTEN_OFF: "Written off",
};

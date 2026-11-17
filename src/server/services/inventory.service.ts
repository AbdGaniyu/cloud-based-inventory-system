import "server-only";

import { z } from "zod";

import { STORE } from "@/config/store";
import { Prisma } from "@/generated/prisma/client";
import type { TrackingType, UnitCondition, UnitStatus } from "@/generated/prisma/enums";
import { calendarDateInStoreTz, daysBetween } from "@/lib/dates";
import { money, toDb } from "@/lib/money";
import { stripCostFields, type Visible } from "@/server/auth/field-access";
import { assertCan, can, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import type { AcceptTradeInInput } from "@/lib/validators/unit";
import { getSetting } from "@/server/services/settings.service";

const MS_PER_DAY = 86_400_000;

export async function agingThresholdDays(): Promise<number> {
  return getSetting("alerts.agingDays", z.number().int().positive(), STORE.agingAlertDays);
}

/** Branch ids the user is looking at: one branch, or every branch for "All branches". */
function scopeBranchFilter(ctx: Ctx): Prisma.Sql {
  return ctx.activeBranchId === null ? Prisma.sql`TRUE` : Prisma.sql`bi.branch_id = ${ctx.activeBranchId}::uuid`;
}

/**
 * Accessories at or below their reorder level, per branch. A reorder level of 0 means "don't alert".
 * Quantities only — safe for every role.
 */
export async function lowStockCountsByBranch(ctx: Ctx): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ branch_id: string; n: number }[]>`
    SELECT bi.branch_id, count(*)::int AS n
    FROM branch_inventory bi
    JOIN products p ON p.id = bi.product_id
    JOIN branches b ON b.id = bi.branch_id
    WHERE p.is_active AND b.is_active
      AND p.tracking_type = 'NON_SERIALIZED'
      AND COALESCE(bi.reorder_level, p.reorder_level) > 0
      AND bi.quantity <= COALESCE(bi.reorder_level, p.reorder_level)
      AND ${scopeBranchFilter(ctx)}
    GROUP BY bi.branch_id`;
  return new Map(rows.map((r) => [r.branch_id, r.n]));
}

/** Serialized units IN_STOCK for longer than the aging threshold, per branch. */
export async function agingCountsByBranch(ctx: Ctx, now: Date = new Date()): Promise<Map<string, number>> {
  const days = await agingThresholdDays();
  const groups = await db.serializedUnit.groupBy({
    by: ["branchId"],
    where: {
      status: "IN_STOCK",
      receivedAt: { lt: new Date(now.getTime() - days * MS_PER_DAY) },
      ...(ctx.activeBranchId ? { branchId: ctx.activeBranchId } : {}),
    },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.branchId, g._count._all]));
}

export type StockSearchResult = {
  units: { id: string; productName: string; identifier: string; branchCode: string; status: string }[];
  products: { id: string; name: string; sku: string; trackingType: string }[];
};

/**
 * Quick lookup for the command palette: units by IMEI/serial, products by name, SKU or barcode.
 * Non-owners only find units at their own branch.
 */
export async function searchStock(ctx: Ctx, query: string): Promise<StockSearchResult> {
  const q = query.trim();
  if (q.length < 2) return { units: [], products: [] };
  const [units, products] = await Promise.all([
    db.serializedUnit.findMany({
      where: {
        OR: [{ imei: { contains: q } }, { serialNumber: { contains: q, mode: "insensitive" } }],
        ...(ctx.role === "OWNER" ? {} : { branchId: ctx.branchId ?? "" }),
      },
      select: {
        id: true,
        imei: true,
        serialNumber: true,
        status: true,
        product: { select: { name: true } },
        branch: { select: { code: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: 6,
    }),
    db.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { barcode: q },
        ],
      },
      select: { id: true, name: true, sku: true, trackingType: true },
      orderBy: { name: "asc" },
      take: 6,
    }),
  ]);
  return {
    units: units.map((u) => ({
      id: u.id,
      productName: u.product.name,
      identifier: u.imei ?? u.serialNumber ?? "",
      branchCode: u.branch.code,
      status: u.status,
    })),
    products,
  };
}

// ─── Inventory views (step 3) ────────────────────────────────────────────────

export const PAGE_SIZE = 25;
const MAX_ACCESSORY_ROWS = 2000;

export type UnitFilters = {
  branchId?: string;
  condition?: UnitCondition;
  /** Defaults to IN_STOCK; "ALL" lists every status. */
  status?: UnitStatus | "ALL";
  productId?: string;
  q?: string;
  aging?: boolean;
  page?: number;
};

export type UnitRow = Visible<
  {
    id: string;
    productId: string;
    productName: string;
    category: string;
    imei: string | null;
    serialNumber: string | null;
    condition: UnitCondition;
    color: string | null;
    storage: string | null;
    ram: string | null;
    batteryHealth: number | null;
    branchCode: string;
    branchName: string;
    status: UnitStatus;
    sellingPrice: string;
    receivedAt: string;
    daysInStock: number;
    costPrice: string;
  },
  "costPrice"
>;

/** Which branch a list shows: non-owners only their own; owners the chosen or active branch. */
function listBranchId(ctx: Ctx, requested?: string): string | null {
  if (ctx.role !== "OWNER") return ctx.branchId;
  return requested ?? ctx.activeBranchId;
}

function daysSince(instant: Date, now: Date): number {
  return Math.max(0, daysBetween(calendarDateInStoreTz(instant), calendarDateInStoreTz(now)));
}

export async function listSerializedUnits(
  ctx: Ctx,
  filters: UnitFilters,
  now: Date = new Date(),
): Promise<{ rows: UnitRow[]; total: number; page: number; pageSize: number; agingDays: number }> {
  assertCan(ctx, "inventory.view");
  const agingDays = await agingThresholdDays();
  const branchId = listBranchId(ctx, filters.branchId);
  const page = Math.max(1, filters.page ?? 1);
  const q = filters.q?.trim();
  const status = filters.aging ? "IN_STOCK" : (filters.status ?? "IN_STOCK");

  const where: Prisma.SerializedUnitWhereInput = {
    ...(branchId ? { branchId } : {}),
    ...(status === "ALL" ? {} : { status }),
    ...(filters.condition ? { condition: filters.condition } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.aging ? { receivedAt: { lt: new Date(now.getTime() - agingDays * MS_PER_DAY) } } : {}),
    ...(q
      ? {
          OR: [
            { imei: { contains: q } },
            { serialNumber: { contains: q, mode: "insensitive" } },
            { product: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.serializedUnit.findMany({
      where,
      include: {
        product: { select: { name: true, category: true } },
        branch: { select: { code: true, name: true } },
      },
      orderBy: filters.aging ? [{ receivedAt: "asc" }] : [{ receivedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.serializedUnit.count({ where }),
  ]);

  return {
    rows: rows.map((u) =>
      stripCostFields(
        ctx,
        {
          id: u.id,
          productId: u.productId,
          productName: u.product.name,
          category: u.product.category,
          imei: u.imei,
          serialNumber: u.serialNumber,
          condition: u.condition,
          color: u.color,
          storage: u.storage,
          ram: u.ram,
          batteryHealth: u.batteryHealth,
          branchCode: u.branch.code,
          branchName: u.branch.name,
          status: u.status,
          sellingPrice: u.sellingPrice.toFixed(2),
          receivedAt: u.receivedAt.toISOString(),
          daysInStock: daysSince(u.receivedAt, now),
          costPrice: u.costPrice.toFixed(2),
        },
        ["costPrice"],
      ),
    ),
    total,
    page,
    pageSize: PAGE_SIZE,
    agingDays,
  };
}

export type UnitEvent = {
  at: string;
  kind: "received" | "traded_in" | "transfer_shipped" | "transfer_received" | "transfer_cancelled" | "sold" | "returned";
  title: string;
  meta: string;
  href?: string;
};

export type UnitDetail = { unit: UnitRow & { notes: string | null }; events: UnitEvent[] };

/** One unit with its history (received → transferred → sold → returned). */
export async function getUnitDetail(ctx: Ctx, unitId: string, now: Date = new Date()): Promise<UnitDetail> {
  assertCan(ctx, "inventory.view");
  const unit = await db.serializedUnit.findUnique({
    where: { id: unitId },
    include: {
      product: { select: { name: true, category: true } },
      branch: { select: { code: true, name: true } },
      purchaseOrder: {
        select: { id: true, number: true, receivedAt: true, branch: { select: { code: true } }, supplier: { select: { name: true } }, receivedBy: { select: { name: true } } },
      },
      transferItems: {
        select: {
          receivedQuantity: true,
          transfer: {
            select: {
              id: true,
              number: true,
              status: true,
              shippedAt: true,
              receivedAt: true,
              cancelledAt: true,
              fromBranch: { select: { code: true } },
              toBranch: { select: { code: true } },
            },
          },
        },
      },
      invoiceItems: { select: { invoice: { select: { id: true, number: true, createdAt: true, branch: { select: { code: true } } } } } },
      returnItems: { select: { disposition: true, return: { select: { number: true, createdAt: true, branch: { select: { code: true } } } } } },
      tradeIn: { select: { createdAt: true, invoice: { select: { number: true } }, branch: { select: { code: true } } } },
    },
  });
  // Staff only see units at their own branch; a miss looks the same as "not found".
  if (!unit || (ctx.role !== "OWNER" && unit.branchId !== ctx.branchId)) {
    throw new NotFoundError("That device isn't in stock at your branch.");
  }

  const seesSupplier = can(ctx, "intake.create");
  const events: UnitEvent[] = [];
  if (unit.purchaseOrder) {
    const po = unit.purchaseOrder;
    events.push({
      at: po.receivedAt.toISOString(),
      kind: "received",
      title: `Received on ${po.number}`,
      meta: [seesSupplier ? po.supplier.name : null, po.branch.code, po.receivedBy.name].filter(Boolean).join(" · "),
      href: seesSupplier ? `/inventory/intake/${po.id}` : undefined,
    });
  }
  if (unit.tradeIn) {
    events.push({
      at: unit.tradeIn.createdAt.toISOString(),
      kind: "traded_in",
      title: `Traded in on ${unit.tradeIn.invoice.number}`,
      meta: unit.tradeIn.branch.code,
    });
  }
  const seesTransfers = can(ctx, "transfer.view");
  for (const item of unit.transferItems) {
    const t = item.transfer;
    const transferHref = seesTransfers ? `/transfers/${t.id}` : undefined;
    if (t.shippedAt) {
      events.push({ at: t.shippedAt.toISOString(), kind: "transfer_shipped", title: `Shipped on ${t.number}`, meta: `${t.fromBranch.code} → ${t.toBranch.code}`, href: transferHref });
    }
    if (t.receivedAt) {
      events.push({ at: t.receivedAt.toISOString(), kind: "transfer_received", title: `Received at ${t.toBranch.code}`, meta: t.number, href: transferHref });
    }
    if (t.cancelledAt) {
      events.push({ at: t.cancelledAt.toISOString(), kind: "transfer_cancelled", title: `Transfer ${t.number} cancelled`, meta: `Back at ${t.fromBranch.code}` });
    }
  }
  for (const item of unit.invoiceItems) {
    events.push({ at: item.invoice.createdAt.toISOString(), kind: "sold", title: `Sold on ${item.invoice.number}`, meta: item.invoice.branch.code });
  }
  for (const item of unit.returnItems) {
    events.push({
      at: item.return.createdAt.toISOString(),
      kind: "returned",
      title: `Returned on ${item.return.number}`,
      meta: `${item.return.branch.code} · ${item.disposition === "DEFECTIVE" ? "marked defective" : "restocked"}`,
    });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  return {
    unit: {
      ...stripCostFields(
        ctx,
        {
          id: unit.id,
          productId: unit.productId,
          productName: unit.product.name,
          category: unit.product.category,
          imei: unit.imei,
          serialNumber: unit.serialNumber,
          condition: unit.condition,
          color: unit.color,
          storage: unit.storage,
          ram: unit.ram,
          batteryHealth: unit.batteryHealth,
          branchCode: unit.branch.code,
          branchName: unit.branch.name,
          status: unit.status,
          sellingPrice: unit.sellingPrice.toFixed(2),
          receivedAt: unit.receivedAt.toISOString(),
          daysInStock: daysSince(unit.receivedAt, now),
          costPrice: unit.costPrice.toFixed(2),
        },
        ["costPrice"],
      ),
      notes: unit.notes,
    },
    events,
  };
}

export type BranchColumn = { id: string; code: string; name: string; colorIndex: number };

export type AccessoryRow = {
  productId: string;
  name: string;
  brand: string;
  sku: string;
  sellingPrice: string;
  reorderLevel: number;
  /** Per branch id. Quantities only — visible to every role. */
  stock: Record<string, { quantity: number; inTransit: number; reorderLevel: number; low: boolean }>;
  total: number;
};

/** Accessory quantities at every branch, with low-stock flags (quantity ≤ reorder level > 0). */
export async function listAccessoryStock(
  ctx: Ctx,
  filters: { q?: string; lowOnly?: boolean; page?: number },
): Promise<{ branches: BranchColumn[]; rows: AccessoryRow[]; total: number; page: number; pageSize: number; scopeBranchId: string | null }> {
  assertCan(ctx, "stock.viewSisterBranches");
  const q = filters.q?.trim();
  const scopeBranchId = listBranchId(ctx);
  const [branchList, products] = await Promise.all([
    db.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.product.findMany({
      where: {
        isActive: true,
        trackingType: "NON_SERIALIZED",
        ...(q
          ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { barcode: q }] }
          : {}),
      },
      select: { id: true, name: true, brand: true, sku: true, defaultSellingPrice: true, reorderLevel: true, inventory: true },
      orderBy: { name: "asc" },
      take: MAX_ACCESSORY_ROWS,
    }),
  ]);
  const branches = branchList.map((b, colorIndex) => ({ ...b, colorIndex }));

  const rows: AccessoryRow[] = products.map((p) => {
    const stock: AccessoryRow["stock"] = {};
    for (const b of branches) {
      const inv = p.inventory.find((i) => i.branchId === b.id);
      const reorderLevel = inv?.reorderLevel ?? p.reorderLevel;
      const quantity = inv?.quantity ?? 0;
      stock[b.id] = { quantity, inTransit: inv?.reservedQuantity ?? 0, reorderLevel, low: reorderLevel > 0 && quantity <= reorderLevel };
    }
    return {
      productId: p.id,
      name: p.name,
      brand: p.brand,
      sku: p.sku,
      sellingPrice: p.defaultSellingPrice.toFixed(2),
      reorderLevel: p.reorderLevel,
      stock,
      total: Object.values(stock).reduce((n, s) => n + s.quantity, 0),
    };
  });

  const isLowInScope = (row: AccessoryRow) =>
    scopeBranchId ? Boolean(row.stock[scopeBranchId]?.low) : Object.values(row.stock).some((s) => s.low);
  const filtered = filters.lowOnly ? rows.filter(isLowInScope) : rows;
  const page = Math.max(1, filters.page ?? 1);
  return {
    branches,
    rows: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: filtered.length,
    page,
    pageSize: PAGE_SIZE,
    scopeBranchId,
  };
}

export type ProductRow = Visible<
  {
    id: string;
    name: string;
    brand: string;
    category: string;
    trackingType: TrackingType;
    sku: string;
    barcode: string | null;
    defaultSellingPrice: string;
    defaultCostPrice: string;
    warrantyMonths: number;
    reorderLevel: number;
    isActive: boolean;
    /** Units in stock (serialized) or quantity on hand (accessories) in the current scope. */
    inStock: number;
  },
  "defaultCostPrice"
>;

export async function listProducts(
  ctx: Ctx,
  filters: { q?: string; category?: string; trackingType?: TrackingType; page?: number },
): Promise<{ rows: ProductRow[]; total: number; page: number; pageSize: number; categories: string[] }> {
  assertCan(ctx, "inventory.view");
  const q = filters.q?.trim();
  const page = Math.max(1, filters.page ?? 1);
  const scopeBranchId = listBranchId(ctx);
  const where: Prisma.ProductWhereInput = {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.trackingType ? { trackingType: filters.trackingType } : {}),
    ...(q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { barcode: q }, { brand: { contains: q, mode: "insensitive" } }] }
      : {}),
  };
  const [products, total, categoryRows] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ isActive: "desc" }, { name: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.product.count({ where }),
    db.product.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  const ids = products.map((p) => p.id);
  const branchFilter = scopeBranchId ? { branchId: scopeBranchId } : {};
  const [unitCounts, quantities] = await Promise.all([
    db.serializedUnit.groupBy({ by: ["productId"], where: { productId: { in: ids }, status: "IN_STOCK", ...branchFilter }, _count: { _all: true } }),
    db.branchInventory.groupBy({ by: ["productId"], where: { productId: { in: ids }, ...branchFilter }, _sum: { quantity: true } }),
  ]);
  const unitsBy = new Map(unitCounts.map((g) => [g.productId, g._count._all]));
  const qtyBy = new Map(quantities.map((g) => [g.productId, g._sum.quantity ?? 0]));

  return {
    rows: products.map((p) =>
      stripCostFields(
        ctx,
        {
          id: p.id,
          name: p.name,
          brand: p.brand,
          category: p.category,
          trackingType: p.trackingType,
          sku: p.sku,
          barcode: p.barcode,
          defaultSellingPrice: p.defaultSellingPrice.toFixed(2),
          defaultCostPrice: p.defaultCostPrice.toFixed(2),
          warrantyMonths: p.warrantyMonths,
          reorderLevel: p.reorderLevel,
          isActive: p.isActive,
          inStock: p.trackingType === "SERIALIZED" ? (unitsBy.get(p.id) ?? 0) : (qtyBy.get(p.id) ?? 0),
        },
        ["defaultCostPrice"],
      ),
    ),
    total,
    page,
    pageSize: PAGE_SIZE,
    categories: categoryRows.map((c) => c.category),
  };
}

/** Serialized products, for the unit list's product filter. */
export async function listSerializedProductOptions(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  assertCan(ctx, "inventory.view");
  return db.product.findMany({ where: { trackingType: "SERIALIZED" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export type StockSummary = {
  devicesInStock: number;
  devicesInTransit: number;
  accessoriesOnHand: number;
  lowStockLines: number;
  agingUnits: number;
  agingDays: number;
  /** Owner: at cost. Manager: at selling price. Cashier: null (CLAUDE.md §7.8). */
  valuation: { basis: "cost" | "selling"; amount: string } | null;
};

export async function getStockSummary(ctx: Ctx, now: Date = new Date()): Promise<StockSummary> {
  assertCan(ctx, "inventory.view");
  const scopeBranchId = listBranchId(ctx);
  const scopedCtx: Ctx = { ...ctx, activeBranchId: scopeBranchId };
  const unitScope = scopeBranchId ? Prisma.sql`u.branch_id = ${scopeBranchId}::uuid` : Prisma.sql`TRUE`;
  const qtyScope = scopeBranchId ? Prisma.sql`bi.branch_id = ${scopeBranchId}::uuid` : Prisma.sql`TRUE`;
  const basis: "cost" | "selling" | null = can(ctx, "cost.view") ? "cost" : ctx.role === "BRANCH_MANAGER" ? "selling" : null;

  const [unitStats, qtyStats, lowStock, aging, agingDays] = await Promise.all([
    db.$queryRaw<{ in_stock: number; in_transit: number; at_cost: string | null; at_selling: string | null }[]>`
      SELECT count(*) FILTER (WHERE u.status = 'IN_STOCK')::int AS in_stock,
             count(*) FILTER (WHERE u.status = 'IN_TRANSIT')::int AS in_transit,
             sum(u.cost_price) FILTER (WHERE u.status IN ('IN_STOCK', 'IN_TRANSIT'))::text AS at_cost,
             sum(u.selling_price) FILTER (WHERE u.status IN ('IN_STOCK', 'IN_TRANSIT'))::text AS at_selling
      FROM serialized_units u WHERE ${unitScope}`,
    db.$queryRaw<{ on_hand: number; at_cost: string | null; at_selling: string | null }[]>`
      SELECT coalesce(sum(bi.quantity), 0)::int AS on_hand,
             sum((bi.quantity + bi.reserved_quantity) * p.default_cost_price)::text AS at_cost,
             sum((bi.quantity + bi.reserved_quantity) * p.default_selling_price)::text AS at_selling
      FROM branch_inventory bi JOIN products p ON p.id = bi.product_id
      WHERE ${qtyScope}`,
    lowStockCountsByBranch(scopedCtx),
    agingCountsByBranch(scopedCtx, now),
    agingThresholdDays(),
  ]);
  const units = unitStats[0];
  const qty = qtyStats[0];
  const sumOf = (a: string | null | undefined, b: string | null | undefined) =>
    toDb(money(a ?? "0").plus(money(b ?? "0")));
  const total = (map: Map<string, number>) => [...map.values()].reduce((n, v) => n + v, 0);

  return {
    devicesInStock: units?.in_stock ?? 0,
    devicesInTransit: units?.in_transit ?? 0,
    accessoriesOnHand: qty?.on_hand ?? 0,
    lowStockLines: total(lowStock),
    agingUnits: total(aging),
    agingDays,
    valuation:
      basis === null
        ? null
        : { basis, amount: basis === "cost" ? sumOf(units?.at_cost, qty?.at_cost) : sumOf(units?.at_selling, qty?.at_selling) },
  };
}

/**
 * Releases a traded-in device for sale once the owner has inspected and priced it
 * (trade-ins are booked at the credit given and can't be sold while TRADED_IN).
 */
export async function acceptTradeIn(ctx: Ctx, input: AcceptTradeInInput): Promise<void> {
  assertCan(ctx, "price.edit");
  const unit = await db.serializedUnit.findUnique({ where: { id: input.unitId }, select: { status: true, sellingPrice: true, condition: true, batteryHealth: true, branchId: true } });
  if (!unit) throw new NotFoundError("That device no longer exists.");
  if (unit.status !== "TRADED_IN") throw new ValidationError("Only traded-in devices waiting for inspection can be released this way.");
  await db.$transaction(async (tx) => {
    const released = await tx.serializedUnit.updateMany({
      where: { id: input.unitId, status: "TRADED_IN" },
      data: { status: "IN_STOCK", condition: input.condition, batteryHealth: input.batteryHealth, sellingPrice: toDb(input.sellingPrice) },
    });
    if (released.count !== 1) throw new ConflictError("Someone else just updated this device. Refresh to see it.");
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: unit.branchId,
      action: "unit.acceptTradeIn",
      entityType: "SerializedUnit",
      entityId: input.unitId,
      before: { status: unit.status, sellingPrice: unit.sellingPrice, condition: unit.condition, batteryHealth: unit.batteryHealth },
      after: { status: "IN_STOCK", sellingPrice: toDb(input.sellingPrice), condition: input.condition, batteryHealth: input.batteryHealth },
    });
  });
}

/** Traded-in devices waiting for the owner to inspect and price them. */
export async function countPendingTradeIns(ctx: Ctx): Promise<number> {
  return db.serializedUnit.count({ where: { status: "TRADED_IN", ...(ctx.activeBranchId ? { branchId: ctx.activeBranchId } : {}) } });
}

import "server-only";

import type { Prisma, UnitCondition } from "@/generated/prisma/client";
import { normalizeIdentifier } from "@/lib/identifiers";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ValidationError } from "@/server/errors";

/**
 * POS catalog (CLAUDE.md §7.4). Prices only — cost is never selected here (invariant 9).
 * Stock at other branches is view-only and shown as counts, never IMEIs.
 */

const UNIT_LIMIT = 40;
const ELSEWHERE_SCAN_LIMIT = 300;
const ELSEWHERE_GROUPS = 8;
const QUICK_PICKS = 4;

export type PosBranch = { id: string; name: string; code: string };

export type PosUnit = {
  kind: "unit";
  id: string;
  productId: string;
  name: string;
  category: string;
  condition: UnitCondition;
  spec: string;
  identifier: string;
  price: string;
};

export type PosElsewhere = {
  kind: "elsewhere";
  key: string;
  productId: string;
  name: string;
  condition: UnitCondition;
  spec: string;
  price: string;
  branchName: string;
  count: number;
};

export type PosAccessory = {
  kind: "accessory";
  productId: string;
  name: string;
  sku: string;
  category: string;
  price: string;
  available: number;
  elsewhere: { branchName: string; count: number }[];
};

export type PosCatalog = {
  units: PosUnit[];
  elsewhere: PosElsewhere[];
  accessories: PosAccessory[];
  /** Set when the query is exactly one sellable IMEI/serial (scanner) or accessory barcode/SKU. */
  exact: { kind: "unit"; id: string } | { kind: "accessory"; productId: string } | null;
};

/** Where the POS sells from: the user's branch, the owner's active branch, or (all-branches view) the first store. */
export async function resolvePosBranch(ctx: Ctx): Promise<PosBranch> {
  assertCan(ctx, "invoice.create");
  const preferred = ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
  const branch = preferred
    ? await db.branch.findFirst({ where: { id: preferred, isActive: true }, select: { id: true, name: true, code: true } })
    : await db.branch.findFirst({ where: { isActive: true, type: "STORE" }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
  if (!branch) throw new ValidationError("There is no active store branch to sell from.");
  return branch;
}

function assertSellingBranch(ctx: Ctx, branchId: string): void {
  assertCan(ctx, "invoice.create");
  if (ctx.role !== "OWNER" && ctx.branchId !== branchId) throw new ValidationError("You can only sell at your own branch.");
}

function unitSpec(u: { storage: string | null; ram: string | null; color: string | null; batteryHealth: number | null }): string {
  return [u.storage, u.ram && `${u.ram} RAM`, u.color, u.batteryHealth !== null && `Battery ${u.batteryHealth}%`].filter(Boolean).join(" · ");
}

export async function searchCatalog(
  ctx: Ctx,
  input: { branchId: string; q?: string; category?: string },
): Promise<PosCatalog> {
  assertSellingBranch(ctx, input.branchId);
  const q = input.q?.trim() ?? "";
  const productFilter: Prisma.ProductWhereInput = {
    isActive: true,
    ...(input.category ? { category: input.category } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { brand: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { barcode: q },
          ],
        }
      : {}),
  };
  const identifier = normalizeIdentifier(q);
  const unitMatch: Prisma.SerializedUnitWhereInput = q
    ? {
        OR: [
          { imei: { contains: identifier } },
          { serialNumber: { contains: identifier, mode: "insensitive" } },
          { product: productFilter },
        ],
        ...(input.category ? { product: { category: input.category } } : {}),
      }
    : { product: productFilter };

  const [units, elsewhereUnits, accessories] = await Promise.all([
    db.serializedUnit.findMany({
      where: { ...unitMatch, branchId: input.branchId, status: "IN_STOCK" },
      select: {
        id: true,
        imei: true,
        serialNumber: true,
        condition: true,
        storage: true,
        ram: true,
        color: true,
        batteryHealth: true,
        sellingPrice: true,
        product: { select: { id: true, name: true, category: true } },
      },
      orderBy: [{ product: { name: "asc" } }, { receivedAt: "asc" }],
      take: UNIT_LIMIT,
    }),
    q
      ? db.serializedUnit.findMany({
          where: { ...unitMatch, branchId: { not: input.branchId }, status: "IN_STOCK" },
          select: {
            condition: true,
            storage: true,
            color: true,
            sellingPrice: true,
            product: { select: { id: true, name: true } },
            branch: { select: { name: true } },
          },
          take: ELSEWHERE_SCAN_LIMIT,
        })
      : Promise.resolve([]),
    db.product.findMany({
      where: { ...productFilter, trackingType: "NON_SERIALIZED" },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        category: true,
        defaultSellingPrice: true,
        inventory: { select: { branchId: true, quantity: true, branch: { select: { name: true, isActive: true } } } },
      },
      orderBy: { name: "asc" },
      take: UNIT_LIMIT,
    }),
  ]);

  // Group other branches' units by model, condition and spec: counts only.
  const groups = new Map<string, PosElsewhere>();
  for (const u of elsewhereUnits) {
    const spec = [u.storage, u.color].filter(Boolean).join(" · ");
    const key = `${u.product.id}|${u.condition}|${spec}|${u.branch.name}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (u.sellingPrice.lt(existing.price)) existing.price = u.sellingPrice.toFixed(2);
    } else {
      groups.set(key, {
        kind: "elsewhere",
        key,
        productId: u.product.id,
        name: u.product.name,
        condition: u.condition,
        spec,
        price: u.sellingPrice.toFixed(2),
        branchName: u.branch.name,
        count: 1,
      });
    }
  }

  const accessoryRows: PosAccessory[] = accessories.map((p) => ({
    kind: "accessory",
    productId: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    price: p.defaultSellingPrice.toFixed(2),
    available: p.inventory.find((i) => i.branchId === input.branchId)?.quantity ?? 0,
    elsewhere: p.inventory
      .filter((i) => i.branchId !== input.branchId && i.quantity > 0 && i.branch.isActive)
      .map((i) => ({ branchName: i.branch.name, count: i.quantity })),
  }));

  const unitRows: PosUnit[] = units.map((u) => ({
    kind: "unit",
    id: u.id,
    productId: u.product.id,
    name: u.product.name,
    category: u.product.category,
    condition: u.condition,
    spec: unitSpec(u),
    identifier: u.imei ?? u.serialNumber ?? "",
    price: u.sellingPrice.toFixed(2),
  }));

  const exactUnit = q ? unitRows.find((u) => u.identifier === identifier) : undefined;
  const exactAccessory = q
    ? accessories.find((p) => (p.barcode === q || p.sku === q.toUpperCase()) && (accessoryRows.find((a) => a.productId === p.id)?.available ?? 0) > 0)
    : undefined;

  return {
    units: unitRows,
    elsewhere: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, ELSEWHERE_GROUPS),
    // Accessories with no stock anywhere add noise to the list.
    accessories: accessoryRows.filter((a) => a.available > 0 || a.elsewhere.length > 0),
    exact: exactUnit ? { kind: "unit", id: exactUnit.id } : exactAccessory ? { kind: "accessory", productId: exactAccessory.id } : null,
  };
}

/** Accessories with the most stock at the branch, for the quick-pick grid. */
export async function quickPickAccessories(ctx: Ctx, branchId: string): Promise<PosAccessory[]> {
  assertSellingBranch(ctx, branchId);
  const rows = await db.branchInventory.findMany({
    where: { branchId, quantity: { gt: 0 }, product: { isActive: true, trackingType: "NON_SERIALIZED" } },
    select: { quantity: true, product: { select: { id: true, name: true, sku: true, category: true, defaultSellingPrice: true } } },
    orderBy: { quantity: "desc" },
    take: QUICK_PICKS,
  });
  return rows.map((r) => ({
    kind: "accessory",
    productId: r.product.id,
    name: r.product.name,
    sku: r.product.sku,
    category: r.product.category,
    price: r.product.defaultSellingPrice.toFixed(2),
    available: r.quantity,
    elsewhere: [],
  }));
}

/** Product categories for the POS filter chips. */
export async function listSellableCategories(): Promise<string[]> {
  const rows = await db.product.findMany({ where: { isActive: true }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return rows.map((r) => r.category);
}

import "server-only";

import type { Prisma, TransferStatus, UnitCondition, UnitStatus } from "@/generated/prisma/client";
import { nextDocumentNumber } from "@/lib/invoice-number";
import type {
  CancelTransferInput,
  CreateTransferInput,
  ReceiveTransferInput,
  ShipTransferInput,
} from "@/lib/validators/transfer";
import { assertCan, can, type Ctx } from "@/server/auth/permissions";
import { resolveWriteBranchId } from "@/server/branch-context";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import { PAGE_SIZE } from "@/server/services/inventory.service";

/**
 * Inter-branch transfers (CLAUDE.md §7.3): DRAFT → IN_TRANSIT → RECEIVED, or CANCELLED.
 * Shipping locks units (IN_TRANSIT) and moves accessory quantity into the source's reserved
 * column (invariant 4); receiving moves both into the destination. Every transition is a
 * conditional update on the expected status, so concurrent clicks can't apply it twice.
 */

const TX_OPTIONS = { timeout: 20_000, maxWait: 5_000 };

const STATUS_WORDS: Record<TransferStatus, string> = {
  DRAFT: "a draft",
  IN_TRANSIT: "in transit",
  RECEIVED: "already received",
  CANCELLED: "cancelled",
};

function wrongState(status: TransferStatus, wanted: string): ValidationError {
  return new ValidationError(`This transfer is ${STATUS_WORDS[status]}, so it can't be ${wanted}.`);
}

async function loadTransfer(id: string) {
  const transfer = await db.stockTransfer.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!transfer) throw new NotFoundError("That transfer no longer exists.");
  return transfer;
}

/** Managers only see transfers that touch their branch. */
function assertCanSee(ctx: Ctx, transfer: { fromBranchId: string; toBranchId: string }): void {
  assertCan(ctx, "transfer.view");
  if (ctx.role === "OWNER") return;
  if (ctx.branchId !== transfer.fromBranchId && ctx.branchId !== transfer.toBranchId) {
    throw new ForbiddenError("That transfer belongs to other branches.");
  }
}

// ─── Create (draft) ──────────────────────────────────────────────────────────

export async function createTransfer(ctx: Ctx, input: CreateTransferInput): Promise<{ id: string; number: string }> {
  assertCan(ctx, "transfer.view");
  const fromBranchId = resolveWriteBranchId(ctx, input.fromBranchId);
  assertCan(ctx, "transfer.create", { fromBranchId });
  if (input.toBranchId === fromBranchId) throw new ValidationError("Choose a different destination branch.", { toBranchId: ["Must differ from the source"] });

  const unitIds = [...new Set(input.unitIds)];
  const [destination, units, products] = await Promise.all([
    db.branch.findFirst({ where: { id: input.toBranchId, isActive: true }, select: { id: true } }),
    db.serializedUnit.findMany({
      where: { id: { in: unitIds } },
      select: { id: true, productId: true, status: true, branchId: true, imei: true, serialNumber: true },
    }),
    db.product.findMany({
      where: { id: { in: input.accessories.map((a) => a.productId) } },
      select: { id: true, name: true, trackingType: true, inventory: { where: { branchId: fromBranchId }, select: { quantity: true } } },
    }),
  ]);
  if (!destination) throw new ValidationError("That destination branch is not available.");

  const notHere = units.filter((u) => u.status !== "IN_STOCK" || u.branchId !== fromBranchId);
  if (units.length !== unitIds.length || notHere.length) {
    const list = notHere.map((u) => u.imei ?? u.serialNumber).join(", ");
    throw new ValidationError(`Some devices aren't in stock at this branch${list ? `: ${list}` : ""}. Remove them and try again.`);
  }
  for (const line of input.accessories) {
    const product = products.find((p) => p.id === line.productId);
    if (!product || product.trackingType !== "NON_SERIALIZED") throw new ValidationError("An accessory on this transfer no longer exists.");
    const available = product.inventory[0]?.quantity ?? 0;
    if (line.quantity > available) throw new ValidationError(`Only ${available} × ${product.name} available to send.`);
  }

  return db.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, fromBranchId, "TRANSFER");
    const transfer = await tx.stockTransfer.create({
      data: {
        number,
        fromBranchId,
        toBranchId: input.toBranchId,
        status: "DRAFT",
        createdById: ctx.userId,
        driverName: input.driverName ?? null,
        notes: input.notes ?? null,
        items: {
          create: [
            ...units.map((u) => ({ productId: u.productId, serializedUnitId: u.id, quantity: 1 })),
            ...input.accessories.map((a) => ({ productId: a.productId, quantity: a.quantity })),
          ],
        },
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: fromBranchId,
      action: "transfer.create",
      entityType: "StockTransfer",
      entityId: transfer.id,
      after: { number, toBranchId: input.toBranchId, units: units.map((u) => u.imei ?? u.serialNumber), accessories: input.accessories },
    });
    return { id: transfer.id, number };
  }, TX_OPTIONS);
}

// ─── Ship ────────────────────────────────────────────────────────────────────

export async function shipTransfer(ctx: Ctx, input: ShipTransferInput): Promise<void> {
  const transfer = await loadTransfer(input.transferId);
  assertCanSee(ctx, transfer);
  assertCan(ctx, "transfer.ship", { fromBranchId: transfer.fromBranchId });
  if (transfer.status !== "DRAFT") throw wrongState(transfer.status, "shipped");

  const unitIds = transfer.items.flatMap((i) => (i.serializedUnitId ? [i.serializedUnitId] : []));
  const accessories = transfer.items.filter((i) => !i.serializedUnitId);
  const now = new Date();

  await db.$transaction(async (tx) => {
    const claimed = await tx.stockTransfer.updateMany({
      where: { id: transfer.id, status: "DRAFT" },
      data: {
        status: "IN_TRANSIT",
        shippedById: ctx.userId,
        shippedAt: now,
        approvedById: ctx.userId,
        approvedAt: now,
        ...(input.driverName ? { driverName: input.driverName } : {}),
      },
    });
    if (claimed.count !== 1) throw new ConflictError("Someone else just updated this transfer. Refresh to see its status.");

    if (unitIds.length) {
      const locked = await tx.serializedUnit.updateMany({
        where: { id: { in: unitIds }, branchId: transfer.fromBranchId, status: "IN_STOCK" },
        data: { status: "IN_TRANSIT" },
      });
      if (locked.count !== unitIds.length) {
        throw new ConflictError("A device on this transfer was sold or moved since the draft was made. Cancel the draft and create a new one.");
      }
    }
    for (const item of accessories) {
      const moved = await tx.branchInventory.updateMany({
        where: { productId: item.productId, branchId: transfer.fromBranchId, quantity: { gte: item.quantity } },
        data: { quantity: { decrement: item.quantity }, reservedQuantity: { increment: item.quantity } },
      });
      if (moved.count !== 1) throw new ConflictError("There isn't enough accessory stock left to ship this transfer. Cancel it and create a new one.");
    }
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: transfer.fromBranchId,
      action: "transfer.ship",
      entityType: "StockTransfer",
      entityId: transfer.id,
      before: { status: "DRAFT" },
      after: { status: "IN_TRANSIT", driverName: input.driverName ?? transfer.driverName },
    });
  }, TX_OPTIONS);
}

// ─── Receive ─────────────────────────────────────────────────────────────────

export async function receiveTransfer(ctx: Ctx, input: ReceiveTransferInput): Promise<{ hasDiscrepancy: boolean }> {
  const transfer = await loadTransfer(input.transferId);
  assertCanSee(ctx, transfer);
  assertCan(ctx, "transfer.receive", { toBranchId: transfer.toBranchId });
  if (transfer.status !== "IN_TRANSIT") throw wrongState(transfer.status, "received");

  const received = new Map(input.items.map((i) => [i.itemId, i]));
  let hasDiscrepancy = false;
  for (const item of transfer.items) {
    const line = received.get(item.id);
    if (!line) throw new ValidationError("Confirm every line on the manifest before receiving.");
    if (item.serializedUnitId && line.receivedQuantity !== 1) {
      throw new ValidationError("Every device must be scanned in. If a device is missing, don't receive — tell the owner, who can cancel the transfer.");
    }
    if (line.receivedQuantity > item.quantity) throw new ValidationError("You can't receive more than was shipped.");
    if (line.receivedQuantity < item.quantity) hasDiscrepancy = true;
  }

  const unitIds = transfer.items.flatMap((i) => (i.serializedUnitId ? [i.serializedUnitId] : []));
  const discrepancies: { productId: string; shipped: number; received: number; note?: string }[] = [];

  await db.$transaction(async (tx) => {
    const claimed = await tx.stockTransfer.updateMany({
      where: { id: transfer.id, status: "IN_TRANSIT" },
      data: { status: "RECEIVED", receivedById: ctx.userId, receivedAt: new Date(), hasDiscrepancy },
    });
    if (claimed.count !== 1) throw new ConflictError("Someone else just updated this transfer. Refresh to see its status.");

    if (unitIds.length) {
      const moved = await tx.serializedUnit.updateMany({
        where: { id: { in: unitIds }, branchId: transfer.fromBranchId, status: "IN_TRANSIT" },
        data: { status: "IN_STOCK", branchId: transfer.toBranchId },
      });
      if (moved.count !== unitIds.length) throw new ConflictError("A device on this transfer is no longer in transit. Refresh and check the manifest.");
    }

    for (const item of transfer.items) {
      const line = received.get(item.id);
      const receivedQuantity = line?.receivedQuantity ?? 0;
      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { receivedQuantity, discrepancyNote: line?.note ?? null },
      });
      if (item.serializedUnitId) continue;
      const released = await tx.branchInventory.updateMany({
        where: { productId: item.productId, branchId: transfer.fromBranchId, reservedQuantity: { gte: item.quantity } },
        data: { reservedQuantity: { decrement: item.quantity } },
      });
      if (released.count !== 1) throw new ConflictError("The source branch's in-transit stock doesn't match this transfer. Contact the owner.");
      if (receivedQuantity > 0) {
        await tx.branchInventory.upsert({
          where: { productId_branchId: { productId: item.productId, branchId: transfer.toBranchId } },
          create: { productId: item.productId, branchId: transfer.toBranchId, quantity: receivedQuantity },
          update: { quantity: { increment: receivedQuantity } },
        });
      }
      if (receivedQuantity < item.quantity) {
        discrepancies.push({ productId: item.productId, shipped: item.quantity, received: receivedQuantity, note: line?.note });
      }
    }

    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: transfer.toBranchId,
      action: "transfer.receive",
      entityType: "StockTransfer",
      entityId: transfer.id,
      before: { status: "IN_TRANSIT" },
      after: { status: "RECEIVED", hasDiscrepancy, discrepancies },
    });
  }, TX_OPTIONS);

  return { hasDiscrepancy };
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

export async function cancelTransfer(ctx: Ctx, input: CancelTransferInput): Promise<void> {
  const transfer = await loadTransfer(input.transferId);
  assertCanSee(ctx, transfer);
  assertCan(ctx, "transfer.cancel", { fromBranchId: transfer.fromBranchId });
  if (transfer.status !== "DRAFT" && transfer.status !== "IN_TRANSIT") throw wrongState(transfer.status, "cancelled");
  const wasInTransit = transfer.status === "IN_TRANSIT";
  const unitIds = transfer.items.flatMap((i) => (i.serializedUnitId ? [i.serializedUnitId] : []));

  await db.$transaction(async (tx) => {
    const claimed = await tx.stockTransfer.updateMany({
      where: { id: transfer.id, status: transfer.status },
      data: { status: "CANCELLED", cancelledById: ctx.userId, cancelledAt: new Date(), cancelReason: input.reason },
    });
    if (claimed.count !== 1) throw new ConflictError("Someone else just updated this transfer. Refresh to see its status.");

    if (wasInTransit) {
      if (unitIds.length) {
        const back = await tx.serializedUnit.updateMany({
          where: { id: { in: unitIds }, branchId: transfer.fromBranchId, status: "IN_TRANSIT" },
          data: { status: "IN_STOCK" },
        });
        if (back.count !== unitIds.length) throw new ConflictError("A device on this transfer is no longer in transit. Refresh and check the manifest.");
      }
      for (const item of transfer.items.filter((i) => !i.serializedUnitId)) {
        const back = await tx.branchInventory.updateMany({
          where: { productId: item.productId, branchId: transfer.fromBranchId, reservedQuantity: { gte: item.quantity } },
          data: { reservedQuantity: { decrement: item.quantity }, quantity: { increment: item.quantity } },
        });
        if (back.count !== 1) throw new ConflictError("The source branch's in-transit stock doesn't match this transfer. Contact the owner.");
      }
    }

    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: transfer.fromBranchId,
      action: "transfer.cancel",
      entityType: "StockTransfer",
      entityId: transfer.id,
      before: { status: transfer.status },
      after: { status: "CANCELLED", reason: input.reason, stockReturned: wasInTransit },
    });
  }, TX_OPTIONS);
}

// ─── Read ────────────────────────────────────────────────────────────────────

export type TransferDirection = "incoming" | "outgoing" | "all";

export type TransferListRow = {
  id: string;
  number: string;
  status: TransferStatus;
  from: { code: string; name: string };
  to: { code: string; name: string };
  devices: number;
  accessoryQuantity: number;
  hasDiscrepancy: boolean;
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
};

export async function listTransfers(
  ctx: Ctx,
  filters: { status?: TransferStatus; direction?: TransferDirection; page?: number },
): Promise<{ rows: TransferListRow[]; total: number; page: number; pageSize: number; counts: Record<TransferStatus | "ALL", number>; scopeBranchId: string | null }> {
  assertCan(ctx, "transfer.view");
  const scopeBranchId = ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
  const direction = filters.direction ?? "all";
  const scope: Prisma.StockTransferWhereInput = !scopeBranchId
    ? {}
    : direction === "incoming"
      ? { toBranchId: scopeBranchId }
      : direction === "outgoing"
        ? { fromBranchId: scopeBranchId }
        : { OR: [{ fromBranchId: scopeBranchId }, { toBranchId: scopeBranchId }] };
  const where: Prisma.StockTransferWhereInput = { ...scope, ...(filters.status ? { status: filters.status } : {}) };
  const page = Math.max(1, filters.page ?? 1);

  const [rows, total, grouped] = await Promise.all([
    db.stockTransfer.findMany({
      where,
      include: {
        fromBranch: { select: { code: true, name: true } },
        toBranch: { select: { code: true, name: true } },
        items: { select: { serializedUnitId: true, quantity: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.stockTransfer.count({ where }),
    db.stockTransfer.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
  ]);

  const counts: Record<TransferStatus | "ALL", number> = { ALL: 0, DRAFT: 0, IN_TRANSIT: 0, RECEIVED: 0, CANCELLED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }

  return {
    rows: rows.map((t) => ({
      id: t.id,
      number: t.number,
      status: t.status,
      from: t.fromBranch,
      to: t.toBranch,
      devices: t.items.filter((i) => i.serializedUnitId).length,
      accessoryQuantity: t.items.filter((i) => !i.serializedUnitId).reduce((n, i) => n + i.quantity, 0),
      hasDiscrepancy: t.hasDiscrepancy,
      createdAt: t.createdAt.toISOString(),
      shippedAt: t.shippedAt?.toISOString() ?? null,
      receivedAt: t.receivedAt?.toISOString() ?? null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    counts,
    scopeBranchId,
  };
}

type BranchInfo = { id: string; code: string; name: string; address: string; phone: string };

export type TransferItemView = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  serializedUnitId: string | null;
  identifier: string | null;
  condition: UnitCondition | null;
  unitStatus: UnitStatus | null;
  quantity: number;
  receivedQuantity: number | null;
  discrepancyNote: string | null;
};

export type TransferDetail = {
  id: string;
  number: string;
  status: TransferStatus;
  from: BranchInfo;
  to: BranchInfo;
  driverName: string | null;
  notes: string | null;
  cancelReason: string | null;
  hasDiscrepancy: boolean;
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  createdBy: string;
  shippedBy: string | null;
  receivedBy: string | null;
  cancelledBy: string | null;
  items: TransferItemView[];
  totals: { devices: number; accessoryQuantity: number; lines: number };
  can: { ship: boolean; receive: boolean; cancel: boolean };
};

const BRANCH_SELECT = { id: true, code: true, name: true, address: true, phone: true } as const;

export async function getTransfer(ctx: Ctx, id: string): Promise<TransferDetail> {
  assertCan(ctx, "transfer.view");
  const t = await db.stockTransfer.findUnique({
    where: { id },
    include: {
      fromBranch: { select: BRANCH_SELECT },
      toBranch: { select: BRANCH_SELECT },
      createdBy: { select: { name: true } },
      shippedBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
      cancelledBy: { select: { name: true } },
      items: {
        include: {
          product: { select: { name: true, sku: true } },
          serializedUnit: { select: { imei: true, serialNumber: true, condition: true, status: true } },
        },
        orderBy: [{ serializedUnitId: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      },
    },
  });
  if (!t) throw new NotFoundError("That transfer no longer exists.");
  assertCanSee(ctx, t);

  const items: TransferItemView[] = t.items.map((i) => ({
    id: i.id,
    productId: i.productId,
    productName: i.product.name,
    sku: i.product.sku,
    serializedUnitId: i.serializedUnitId,
    identifier: i.serializedUnit ? (i.serializedUnit.imei ?? i.serializedUnit.serialNumber) : null,
    condition: i.serializedUnit?.condition ?? null,
    unitStatus: i.serializedUnit?.status ?? null,
    quantity: i.quantity,
    receivedQuantity: i.receivedQuantity,
    discrepancyNote: i.discrepancyNote,
  }));

  return {
    id: t.id,
    number: t.number,
    status: t.status,
    from: t.fromBranch,
    to: t.toBranch,
    driverName: t.driverName,
    notes: t.notes,
    cancelReason: t.cancelReason,
    hasDiscrepancy: t.hasDiscrepancy,
    createdAt: t.createdAt.toISOString(),
    shippedAt: t.shippedAt?.toISOString() ?? null,
    receivedAt: t.receivedAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
    createdBy: t.createdBy.name,
    shippedBy: t.shippedBy?.name ?? null,
    receivedBy: t.receivedBy?.name ?? null,
    cancelledBy: t.cancelledBy?.name ?? null,
    items,
    totals: {
      devices: items.filter((i) => i.serializedUnitId).length,
      accessoryQuantity: items.filter((i) => !i.serializedUnitId).reduce((n, i) => n + i.quantity, 0),
      lines: items.length,
    },
    can: {
      ship: t.status === "DRAFT" && can(ctx, "transfer.ship", { fromBranchId: t.fromBranchId }),
      receive: t.status === "IN_TRANSIT" && can(ctx, "transfer.receive", { toBranchId: t.toBranchId }),
      cancel: (t.status === "DRAFT" || t.status === "IN_TRANSIT") && can(ctx, "transfer.cancel", { fromBranchId: t.fromBranchId }),
    },
  };
}

// ─── Picker (new transfer form) ──────────────────────────────────────────────

export type TransferableStock = {
  units: { id: string; productName: string; identifier: string; condition: UnitCondition; spec: string }[];
  accessories: { productId: string; name: string; sku: string; available: number }[];
};

/** Stock that can leave a branch: devices IN_STOCK there (search by IMEI/serial/name) and accessories on hand. */
export async function listTransferableStock(ctx: Ctx, fromBranchId: string, query?: string): Promise<TransferableStock> {
  assertCan(ctx, "transfer.create", { fromBranchId });
  const q = query?.trim();
  const [units, accessories] = await Promise.all([
    db.serializedUnit.findMany({
      where: {
        branchId: fromBranchId,
        status: "IN_STOCK",
        ...(q
          ? { OR: [{ imei: { contains: q } }, { serialNumber: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] }
          : {}),
      },
      select: { id: true, imei: true, serialNumber: true, condition: true, storage: true, color: true, product: { select: { name: true } } },
      orderBy: [{ product: { name: "asc" } }, { receivedAt: "asc" }],
      take: 50,
    }),
    db.branchInventory.findMany({
      where: { branchId: fromBranchId, quantity: { gt: 0 }, product: { isActive: true, trackingType: "NON_SERIALIZED" } },
      select: { quantity: true, product: { select: { id: true, name: true, sku: true } } },
      orderBy: { product: { name: "asc" } },
    }),
  ]);
  return {
    units: units.map((u) => ({
      id: u.id,
      productName: u.product.name,
      identifier: u.imei ?? u.serialNumber ?? "",
      condition: u.condition,
      spec: [u.storage, u.color].filter(Boolean).join(" · "),
    })),
    accessories: accessories.map((a) => ({ productId: a.product.id, name: a.product.name, sku: a.product.sku, available: a.quantity })),
  };
}

/** Exact IMEI/serial match for scanning into a transfer, with a reason when it can't go. */
export async function findUnitForTransfer(
  ctx: Ctx,
  fromBranchId: string,
  identifier: string,
): Promise<{ ok: true; unit: TransferableStock["units"][number] } | { ok: false; message: string }> {
  assertCan(ctx, "transfer.create", { fromBranchId });
  const value = identifier.trim().toUpperCase().replace(/\s+/g, "");
  const unit = await db.serializedUnit.findFirst({
    where: { OR: [{ imei: value }, { serialNumber: value }] },
    select: {
      id: true,
      imei: true,
      serialNumber: true,
      condition: true,
      status: true,
      branchId: true,
      storage: true,
      color: true,
      product: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });
  if (!unit) return { ok: false, message: `${value} isn't in stock anywhere.` };
  if (unit.branchId !== fromBranchId) {
    // Staff may not learn other branches' unit details; owners get the branch name.
    return { ok: false, message: ctx.role === "OWNER" ? `${value} is at ${unit.branch.name}, not the sending branch.` : `${value} isn't at your branch.` };
  }
  if (unit.status !== "IN_STOCK") return { ok: false, message: `${value} is ${unit.status.toLowerCase().replace("_", " ")} and can't be sent.` };
  return {
    ok: true,
    unit: {
      id: unit.id,
      productName: unit.product.name,
      identifier: unit.imei ?? unit.serialNumber ?? value,
      condition: unit.condition,
      spec: [unit.storage, unit.color].filter(Boolean).join(" · "),
    },
  };
}

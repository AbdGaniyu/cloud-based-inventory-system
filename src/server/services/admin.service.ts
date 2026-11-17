import "server-only";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type { BranchType, Role } from "@/generated/prisma/enums";
import { STORE } from "@/config/store";
import { normalizePhone } from "@/lib/phone";
import type { BusinessSettingsInput, CreateBranchInput, CreateUserInput, UpdateBranchInput, UpdateUserInput } from "@/lib/validators/settings";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import { cancelTransferWithin } from "@/server/services/transfer.service";
import { getSetting } from "@/server/services/settings.service";

/**
 * Settings → Business, Branches, Users (CLAUDE.md §8: owner only). Every change is audited with
 * its before and after values; password hashes never appear in audit rows or responses.
 */

const BCRYPT_COST = 12;

type Tx = Prisma.TransactionClient;

async function upsertSetting(tx: Tx, key: string, value: Prisma.InputJsonValue, userId: string): Promise<void> {
  await tx.setting.upsert({ where: { key }, create: { key, value, updatedById: userId }, update: { value, updatedById: userId } });
}

// ─── Business settings ─────────────────────────────────────────────────────

export type BusinessSettings = BusinessSettingsInput;

const DEFAULT_TERMS = "Covers manufacturing defects for the period shown. Excludes physical and liquid damage, unauthorised repairs and software issues.";

export async function getBusinessSettings(ctx: Ctx): Promise<BusinessSettings> {
  assertCan(ctx, "tax.manage");
  const str = z.string();
  const int = z.number().int();
  const [vatRatePercent, approvalThreshold, minDownPaymentPercent, paymentInstructions, returnWindowDays, agingDays, maxAttempts, warrantyTerms] = await Promise.all([
    getSetting("tax.vatRatePercent", str, STORE.defaultVatRatePercent),
    getSetting("installments.approvalThreshold", str, "1000000.00"),
    getSetting("installments.minDownPaymentPercent", str, "30"),
    getSetting("payments.instructions", str, "Pay at any branch or by bank transfer, quoting your invoice number."),
    getSetting("returns.windowDays", int, STORE.returnWindowDays),
    getSetting("alerts.agingDays", int, STORE.agingAlertDays),
    getSetting("notifications.maxAttempts", int, 3),
    getSetting("warranty.defaultTerms", str, DEFAULT_TERMS),
  ]);
  return { vatRatePercent, approvalThreshold, minDownPaymentPercent, paymentInstructions, returnWindowDays, agingDays, maxAttempts, warrantyTerms };
}

const BUSINESS_KEYS: Record<keyof BusinessSettings, string> = {
  vatRatePercent: "tax.vatRatePercent",
  approvalThreshold: "installments.approvalThreshold",
  minDownPaymentPercent: "installments.minDownPaymentPercent",
  paymentInstructions: "payments.instructions",
  returnWindowDays: "returns.windowDays",
  agingDays: "alerts.agingDays",
  maxAttempts: "notifications.maxAttempts",
  warrantyTerms: "warranty.defaultTerms",
};

/** Only changed values are written. VAT applies to new sales; issued invoices keep their snapshot. */
export async function updateBusinessSettings(ctx: Ctx, input: BusinessSettingsInput): Promise<BusinessSettings> {
  assertCan(ctx, "tax.manage");
  const before = await getBusinessSettings(ctx);
  const changed = (Object.keys(BUSINESS_KEYS) as (keyof BusinessSettings)[]).filter((k) => String(before[k]) !== String(input[k]));
  if (changed.length === 0) return before;
  await db.$transaction(async (tx) => {
    for (const k of changed) await upsertSetting(tx, BUSINESS_KEYS[k], input[k], ctx.userId);
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: null,
      action: "settings.update",
      entityType: "Setting",
      entityId: "business",
      before: Object.fromEntries(changed.map((k) => [BUSINESS_KEYS[k], before[k]])),
      after: Object.fromEntries(changed.map((k) => [BUSINESS_KEYS[k], input[k]])),
    });
  });
  return input;
}

// ─── Branches ──────────────────────────────────────────────────────────────

export type AdminBranch = {
  id: string;
  name: string;
  code: string;
  type: BranchType;
  address: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  staff: number;
  devicesInStock: number;
  invoices: number;
};

export async function listAdminBranches(ctx: Ctx): Promise<AdminBranch[]> {
  assertCan(ctx, "branch.manage");
  const branches = await db.branch.findMany({
    orderBy: [{ isActive: "desc" }, { type: "asc" }, { name: "asc" }],
    include: { _count: { select: { users: { where: { isActive: true } }, invoices: true, serializedUnits: { where: { status: "IN_STOCK" } } } } },
  });
  return branches.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    type: b.type,
    address: b.address,
    phone: b.phone,
    email: b.email,
    isActive: b.isActive,
    staff: b._count.users,
    devicesInStock: b._count.serializedUnits,
    invoices: b._count.invoices,
  }));
}

function branchPhone(raw: string): string {
  const phone = normalizePhone(raw);
  if (!phone) throw new ValidationError("Enter a valid phone number.", { phone: ["Enter a valid phone number"] });
  return phone;
}

export async function createBranch(ctx: Ctx, input: CreateBranchInput): Promise<{ id: string }> {
  assertCan(ctx, "branch.manage");
  if (await db.branch.findUnique({ where: { code: input.code }, select: { id: true } })) {
    throw new ValidationError(`Code ${input.code} is already used.`, { code: ["Already used"] });
  }
  const data = { name: input.name, code: input.code, type: input.type, address: input.address, phone: branchPhone(input.phone), email: input.email || null };
  return db.$transaction(async (tx) => {
    const branch = await tx.branch.create({ data, select: { id: true } });
    await writeAudit(tx, { userId: ctx.userId, branchId: branch.id, action: "branch.create", entityType: "Branch", entityId: branch.id, after: data });
    return branch;
  });
}

/** The code is fixed (it is in every document number). A branch with active staff or stock cannot be closed. */
export async function updateBranch(ctx: Ctx, input: UpdateBranchInput): Promise<void> {
  assertCan(ctx, "branch.manage");
  const before = await db.branch.findUnique({ where: { id: input.id } });
  if (!before) throw new NotFoundError("That branch no longer exists.");
  if (before.isActive && !input.isActive) {
    const [staff, units, accessories] = await Promise.all([
      db.user.count({ where: { branchId: input.id, isActive: true } }),
      db.serializedUnit.count({ where: { branchId: input.id, status: { in: ["IN_STOCK", "IN_TRANSIT"] } } }),
      db.branchInventory.aggregate({ where: { branchId: input.id }, _sum: { quantity: true } }),
    ]);
    if (staff > 0 || units > 0 || (accessories._sum.quantity ?? 0) > 0) {
      throw new ConflictError("Move this branch's staff and stock elsewhere before closing it.");
    }
  }
  const data = { name: input.name, type: input.type, address: input.address, phone: branchPhone(input.phone), email: input.email || null, isActive: input.isActive };
  await db.$transaction(async (tx) => {
    await tx.branch.update({ where: { id: input.id }, data });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: input.id,
      action: "branch.update",
      entityType: "Branch",
      entityId: input.id,
      before: { name: before.name, type: before.type, address: before.address, phone: before.phone, email: before.email, isActive: before.isActive },
      after: data,
    });
  });
}

// ─── Users ─────────────────────────────────────────────────────────────────

export type AdminUser = { id: string; name: string; email: string; role: Role; branchId: string | null; branchName: string | null; isActive: boolean; lastLoginAt: string | null };

export async function listAdminUsers(ctx: Ctx): Promise<AdminUser[]> {
  assertCan(ctx, "user.manage");
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true, lastLoginAt: true, branch: { select: { name: true } } },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });
  return users.map((u) => ({ ...u, branchName: u.branch?.name ?? null, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }));
}

/** Owners see every branch (no branch); managers and cashiers belong to one active branch. */
async function placement(role: Role, branchId: string | undefined): Promise<string | null> {
  if (role === "OWNER") return null;
  if (!branchId) throw new ValidationError("Choose the branch this person works at.", { branchId: ["Required"] });
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { isActive: true } });
  if (!branch?.isActive) throw new ValidationError("Choose an open branch.", { branchId: ["Not an open branch"] });
  return branchId;
}

export async function createUser(ctx: Ctx, input: CreateUserInput): Promise<{ id: string }> {
  assertCan(ctx, "user.manage");
  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw new ValidationError("Someone already signs in with that email.", { email: ["Already used"] });
  }
  const branchId = await placement(input.role, input.branchId);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: input.name, email: input.email, role: input.role, branchId, passwordHash }, select: { id: true } });
    await writeAudit(tx, { userId: ctx.userId, branchId, action: "user.create", entityType: "User", entityId: user.id, after: { name: input.name, email: input.email, role: input.role, branchId } });
    return user;
  });
}

export async function updateUser(ctx: Ctx, input: UpdateUserInput): Promise<void> {
  assertCan(ctx, "user.manage");
  const before = await db.user.findUnique({ where: { id: input.id }, select: { name: true, role: true, branchId: true, isActive: true } });
  if (!before) throw new NotFoundError("That user no longer exists.");
  if (input.id === ctx.userId && (input.role !== before.role || !input.isActive)) {
    throw new ValidationError("You cannot change your own role or switch yourself off. Ask another owner.");
  }
  if (before.role === "OWNER" && before.isActive && (input.role !== "OWNER" || !input.isActive)) {
    const owners = await db.user.count({ where: { role: "OWNER", isActive: true } });
    if (owners <= 1) throw new ConflictError("Keep at least one active owner.");
  }
  const branchId = await placement(input.role, input.branchId);
  const after = { name: input.name, role: input.role, branchId, isActive: input.isActive };
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.id }, data: after });
    await writeAudit(tx, { userId: ctx.userId, branchId, action: "user.update", entityType: "User", entityId: input.id, before, after });
  });
}

/** Sets a new password; the person signs in with it and should change it. The hash is never logged. */
export async function resetUserPassword(ctx: Ctx, input: { id: string; password: string }): Promise<void> {
  assertCan(ctx, "user.manage");
  const user = await db.user.findUnique({ where: { id: input.id }, select: { id: true, branchId: true, email: true } });
  if (!user) throw new NotFoundError("That user no longer exists.");
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.id }, data: { passwordHash } });
    // A locked-out person can sign in with the new password straight away.
    await tx.authThrottle.deleteMany({ where: { key: { in: [`login:email:${user.email}`, `approve:email:${user.email}`] } } });
    await writeAudit(tx, { userId: ctx.userId, branchId: user.branchId, action: "user.resetPassword", entityType: "User", entityId: input.id, after: { passwordChanged: true } });
  });
}

// ─── Closing a branch ──────────────────────────────────────────────────────

export type BranchClosurePreview = {
  branch: { id: string; code: string; name: string };
  targets: { id: string; code: string; name: string }[];
  devices: number;
  accessoryQuantity: number;
  staff: { id: string; name: string }[];
  openInvoices: { number: string; balance: string }[];
  openPurchaseOrders: { number: string; owed: string }[];
  transfersToCancel: { number: string; status: string }[];
};

const OPEN_INVOICE = { balance: { gt: 0 }, status: { notIn: ["VOID", "RETURNED"] } } satisfies Prisma.InvoiceWhereInput;
const LIVE_TRANSFER = { status: { in: ["DRAFT", "IN_TRANSIT"] } } satisfies Prisma.StockTransferWhereInput;

/** What closing a branch will move or cancel, for the confirmation dialog. */
export async function previewBranchClosure(ctx: Ctx, branchId: string): Promise<BranchClosurePreview> {
  assertCan(ctx, "branch.manage");
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true, name: true, isActive: true } });
  if (!branch?.isActive) throw new NotFoundError("That branch is not open.");
  const [targets, devices, accessories, staff, invoices, orders, transfers] = await Promise.all([
    db.branch.findMany({ where: { isActive: true, type: "STORE", id: { not: branchId } }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    db.serializedUnit.count({ where: { branchId, status: { not: "SOLD" } } }),
    db.branchInventory.aggregate({ where: { branchId }, _sum: { quantity: true, reservedQuantity: true } }),
    db.user.findMany({ where: { branchId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.invoice.findMany({ where: { branchId, ...OPEN_INVOICE }, select: { number: true, balance: true }, orderBy: { number: "asc" } }),
    db.purchaseOrder.findMany({ where: { branchId, status: { not: "PAID" } }, select: { number: true, totalCost: true, amountPaid: true }, orderBy: { number: "asc" } }),
    db.stockTransfer.findMany({ where: { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }], ...LIVE_TRANSFER }, select: { number: true, status: true }, orderBy: { number: "asc" } }),
  ]);
  return {
    branch: { id: branch.id, code: branch.code, name: branch.name },
    targets,
    devices,
    accessoryQuantity: (accessories._sum.quantity ?? 0) + (accessories._sum.reservedQuantity ?? 0),
    staff,
    openInvoices: invoices.map((i) => ({ number: i.number, balance: i.balance.toFixed(2) })),
    openPurchaseOrders: orders.map((o) => ({ number: o.number, owed: o.totalCost.minus(o.amountPaid).toFixed(2) })),
    transfersToCancel: transfers.map((t) => ({ number: t.number, status: t.status })),
  };
}

export type BranchClosureResult = {
  devicesMoved: number;
  accessoriesMoved: number;
  staffMoved: number;
  invoicesMoved: string[];
  purchaseOrdersMoved: string[];
  transfersCancelled: string[];
};

/**
 * Closes a branch and moves what it holds into another open store, in one transaction with one
 * audit row: live transfers in or out are cancelled (in-transit stock returns to its source),
 * unsold devices, accessory quantities and staff move, and open customer and supplier accounts move
 * so they can still be collected and paid. History (sales, payments, returns, received transfers)
 * stays with the branch where it happened, and document numbers never change.
 */
export async function closeBranchInto(ctx: Ctx, input: { branchId: string; targetBranchId: string }): Promise<BranchClosureResult> {
  assertCan(ctx, "branch.manage");
  if (input.branchId === input.targetBranchId) throw new ValidationError("Choose a different branch to move everything to.");
  const [source, target] = await Promise.all([
    db.branch.findUnique({ where: { id: input.branchId }, select: { id: true, code: true, name: true, isActive: true } }),
    db.branch.findUnique({ where: { id: input.targetBranchId }, select: { id: true, code: true, name: true, isActive: true, type: true } }),
  ]);
  if (!source?.isActive) throw new NotFoundError("That branch is not open.");
  if (!target?.isActive || target.type !== "STORE") throw new ValidationError("Move everything to an open store.");
  const reason = `${source.name} closed; stock moved to ${target.name}`;

  return db.$transaction(
    async (tx) => {
      const transfers = await tx.stockTransfer.findMany({ where: { OR: [{ fromBranchId: source.id }, { toBranchId: source.id }], ...LIVE_TRANSFER }, select: { id: true, number: true } });
      for (const t of transfers) await cancelTransferWithin(tx, t.id, ctx.userId, reason);

      const stuck = await tx.serializedUnit.count({ where: { branchId: source.id, status: "IN_TRANSIT" } });
      if (stuck > 0) throw new ConflictError(`${stuck} device(s) at ${source.name} are still marked in transit. Check the transfers list.`);
      const devices = await tx.serializedUnit.updateMany({ where: { branchId: source.id, status: { not: "SOLD" } }, data: { branchId: target.id } });

      const shelves = await tx.branchInventory.findMany({ where: { branchId: source.id, OR: [{ quantity: { gt: 0 } }, { reservedQuantity: { gt: 0 } }] } });
      let accessoriesMoved = 0;
      for (const row of shelves) {
        if (row.reservedQuantity > 0) throw new ConflictError(`${source.name} still has accessories reserved for a transfer. Check the transfers list.`);
        await tx.branchInventory.upsert({
          where: { productId_branchId: { productId: row.productId, branchId: target.id } },
          create: { productId: row.productId, branchId: target.id, quantity: row.quantity },
          update: { quantity: { increment: row.quantity } },
        });
        await tx.branchInventory.update({ where: { id: row.id }, data: { quantity: 0 } });
        accessoriesMoved += row.quantity;
      }

      const staff = await tx.user.updateMany({ where: { branchId: source.id }, data: { branchId: target.id } });
      const invoices = await tx.invoice.findMany({ where: { branchId: source.id, ...OPEN_INVOICE }, select: { id: true, number: true } });
      await tx.invoice.updateMany({ where: { id: { in: invoices.map((i) => i.id) } }, data: { branchId: target.id } });
      const orders = await tx.purchaseOrder.findMany({ where: { branchId: source.id, status: { not: "PAID" } }, select: { id: true, number: true } });
      await tx.purchaseOrder.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { branchId: target.id } });
      await tx.stockAlert.updateMany({ where: { branchId: source.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
      await tx.branch.update({ where: { id: source.id }, data: { isActive: false } });

      const result: BranchClosureResult = {
        devicesMoved: devices.count,
        accessoriesMoved,
        staffMoved: staff.count,
        invoicesMoved: invoices.map((i) => i.number),
        purchaseOrdersMoved: orders.map((o) => o.number),
        transfersCancelled: transfers.map((t) => t.number),
      };
      await writeAudit(tx, {
        userId: ctx.userId,
        branchId: source.id,
        action: "branch.close",
        entityType: "Branch",
        entityId: source.id,
        before: { code: source.code, isActive: true },
        after: { isActive: false, movedTo: target.code, ...result },
      });
      return result;
    },
    { timeout: 30_000 },
  );
}

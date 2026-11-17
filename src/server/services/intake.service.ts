import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PaymentTerms, PurchaseOrderStatus, TrackingType, UnitCondition } from "@/generated/prisma/enums";
import { type CalendarDate, fromDbDate, parseCalendarDate, storeInstant, toDbDate, todayInStoreTz } from "@/lib/dates";
import { checkIdentifier, findDuplicates } from "@/lib/identifiers";
import { nextDocumentNumber } from "@/lib/invoice-number";
import { type Money, money, toDb } from "@/lib/money";
import { type IntakeInput, intakeAmountPaid, intakeTerms, intakeTotalCost } from "@/lib/validators/intake";
import { stripCostFields, type Visible } from "@/server/auth/field-access";
import { assertCan, can, type Ctx } from "@/server/auth/permissions";
import { resolveWriteBranchId } from "@/server/branch-context";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";

const TX_OPTIONS = { timeout: 20_000, maxWait: 5_000 };

export type IdentifierStatus =
  | { status: "ok"; kind: "IMEI" | "SERIAL" }
  | { status: "invalid"; message: string }
  | { status: "duplicate"; message: string }
  | { status: "exists"; message: string };

/**
 * Validates a batch of scanned/pasted identifiers before save: format (IMEI check digit), repeats
 * inside the batch, and identifiers already recorded. Keys are the normalised values.
 */
export async function checkIdentifiers(ctx: Ctx, rawValues: readonly string[]): Promise<Record<string, IdentifierStatus>> {
  assertCan(ctx, "intake.create");
  const checks = rawValues.map(checkIdentifier);
  const duplicates = findDuplicates(checks.map((c) => c.value));
  const valid = checks.filter((c) => c.ok).map((c) => c.value);
  const existing = valid.length
    ? await db.serializedUnit.findMany({
        where: { OR: [{ imei: { in: valid } }, { serialNumber: { in: valid } }] },
        select: { imei: true, serialNumber: true },
      })
    : [];
  const taken = new Set(existing.flatMap((u) => [u.imei, u.serialNumber]).filter((v): v is string => Boolean(v)));

  const result: Record<string, IdentifierStatus> = {};
  for (const check of checks) {
    if (!check.ok) result[check.value] = { status: "invalid", message: check.reason };
    else if (duplicates.has(check.value)) result[check.value] = { status: "duplicate", message: "Listed more than once" };
    else if (taken.has(check.value)) result[check.value] = { status: "exists", message: "Already recorded in stock" };
    else result[check.value] = { status: "ok", kind: check.kind };
  }
  return result;
}

const ALREADY_RECORDED = "Already recorded in stock";

/** Throws a ValidationError naming identifiers that are already in the system. */
async function assertNotRecorded(values: string[]): Promise<void> {
  if (!values.length) return;
  const existing = await db.serializedUnit.findMany({
    where: { OR: [{ imei: { in: values } }, { serialNumber: { in: values } }] },
    select: { imei: true, serialNumber: true },
    take: 5,
  });
  if (existing.length) {
    const list = existing.map((u) => u.imei ?? u.serialNumber).join(", ");
    throw new ValidationError(`${ALREADY_RECORDED}: ${list}`);
  }
}

type ResolvedUnit = IntakeInput["serializedLines"][number]["units"][number] & {
  kind: "IMEI" | "SERIAL";
  value: string;
};

function assertProductsMatch(
  products: Map<string, { trackingType: TrackingType; isActive: boolean; name: string }>,
  ids: readonly string[],
  expected: TrackingType,
): void {
  for (const id of ids) {
    const product = products.get(id);
    if (!product || !product.isActive) throw new ValidationError("A product on this intake no longer exists.");
    if (product.trackingType !== expected) {
      throw new ValidationError(
        expected === "SERIALIZED"
          ? `${product.name} is tracked by quantity — add it as an accessory line.`
          : `${product.name} is tracked by IMEI/serial — add it as a device line.`,
      );
    }
  }
}

/**
 * Stock intake (CLAUDE.md §7.2): one purchase order into one branch. Creates the PO and its items,
 * the serialized units / accessory quantities, any payment made now, and the audit rows — all in
 * one transaction.
 */
export async function createIntake(
  ctx: Ctx,
  input: IntakeInput,
  options: { now?: Date } = {},
): Promise<{ id: string; number: string }> {
  assertCan(ctx, "intake.create");
  const branchId = resolveWriteBranchId(ctx, input.branchId);
  assertCan(ctx, "intake.create", { branchId });

  const now = options.now ?? new Date();
  const today = todayInStoreTz(now);
  const receivedOn: CalendarDate = parseCalendarDate(input.receivedOn);
  if (receivedOn > today) throw new ValidationError("The received date can't be in the future.", { receivedOn: ["Can't be in the future"] });

  if (input.payment.mode !== "CREDIT" && !can(ctx, "supplier.payout")) {
    throw new ForbiddenError("Only the owner can record a payment to a supplier. Save this intake on credit.");
  }

  // Identifiers: format, duplicates within the batch, and not already in the system.
  const units: (ResolvedUnit & { productId: string })[] = [];
  const problems: string[] = [];
  for (const line of input.serializedLines) {
    for (const unit of line.units) {
      const check = checkIdentifier(unit.identifier);
      if (!check.ok) problems.push(`${check.value || "(blank)"}: ${check.reason}`);
      else units.push({ ...unit, kind: check.kind, value: check.value, productId: line.productId });
    }
  }
  const repeated = findDuplicates(units.map((u) => u.value));
  for (const value of repeated) problems.push(`${value}: listed more than once`);
  if (problems.length) throw new ValidationError(`Fix these IMEIs/serials first — ${problems.slice(0, 5).join("; ")}`);
  // Friendly pre-check; the unique constraints still catch a race with another intake.
  await assertNotRecorded(units.map((u) => u.value));

  const [supplier, branch, products] = await Promise.all([
    db.supplier.findFirst({ where: { id: input.supplierId, isActive: true }, select: { id: true, name: true } }),
    db.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } }),
    db.product.findMany({
      where: { id: { in: [...input.serializedLines.map((l) => l.productId), ...input.accessoryLines.map((l) => l.productId)] } },
      select: { id: true, name: true, trackingType: true, isActive: true, defaultSellingPrice: true },
    }),
  ]);
  if (!supplier) throw new ValidationError("Choose a supplier.", { supplierId: ["Choose a supplier"] });
  if (!branch) throw new ValidationError("That branch is not available.");
  const productById = new Map(products.map((p) => [p.id, p]));
  assertProductsMatch(productById, input.serializedLines.map((l) => l.productId), "SERIALIZED");
  assertProductsMatch(productById, input.accessoryLines.map((l) => l.productId), "NON_SERIALIZED");

  const totalCost = intakeTotalCost(input);
  const amountPaid = intakeAmountPaid(input.payment, totalCost);
  if (input.payment.mode === "PARTIAL_DEPOSIT" && (amountPaid.lte(0) || amountPaid.gte(totalCost))) {
    throw new ValidationError("A partial deposit must be more than zero and less than the total cost.", {
      "payment.amountPaid": ["More than 0 and less than the total"],
    });
  }
  const { paymentTerms, dueDate } = intakeTerms(input.payment, receivedOn);
  const status: PurchaseOrderStatus = amountPaid.isZero() ? "UNPAID" : amountPaid.equals(totalCost) ? "PAID" : "PARTIALLY_PAID";
  // Same-day intake keeps the real time; back-dated intake is stamped midday Lagos.
  const receivedAt = receivedOn === today ? now : storeInstant(receivedOn, 12);
  const ownerPricing = can(ctx, "price.edit");

  try {
    return await db.$transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, branchId, "PURCHASE_ORDER");
      const po = await tx.purchaseOrder.create({
        data: {
          number,
          supplierId: supplier.id,
          branchId,
          paymentTerms,
          supplierReference: input.supplierReference ?? null,
          totalCost: toDb(totalCost),
          amountPaid: toDb(amountPaid),
          dueDate: dueDate ? toDbDate(dueDate) : null,
          status,
          receivedById: ctx.userId,
          receivedAt,
          notes: input.notes ?? null,
        },
        select: { id: true },
      });

      // Serialized units, grouped into PO items by (product, unit cost) so unitCost stays exact.
      const groups = new Map<string, { productId: string; cost: Money; units: ResolvedUnit[] }>();
      for (const unit of units) {
        const cost = money(unit.costPrice);
        const key = `${unit.productId}:${cost.toFixed(2)}`;
        const group = groups.get(key) ?? { productId: unit.productId, cost, units: [] };
        group.units.push(unit);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        const item = await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: po.id,
            productId: group.productId,
            quantity: group.units.length,
            unitCost: toDb(group.cost),
            unitSellingPrice: toDb(group.units[0].sellingPrice),
            lineTotal: toDb(group.cost.times(group.units.length)),
          },
          select: { id: true },
        });
        await tx.serializedUnit.createMany({
          data: group.units.map((u) => ({
            productId: group.productId,
            imei: u.kind === "IMEI" ? u.value : null,
            serialNumber: u.kind === "SERIAL" ? u.value : null,
            branchId,
            condition: u.condition as UnitCondition,
            color: u.color ?? null,
            storage: u.storage ?? null,
            ram: u.ram ?? null,
            batteryHealth: u.batteryHealth ?? null,
            costPrice: toDb(u.costPrice),
            sellingPrice: toDb(u.sellingPrice),
            status: "IN_STOCK",
            purchaseOrderId: po.id,
            purchaseOrderItemId: item.id,
            receivedAt,
          })),
        });
      }

      for (const line of input.accessoryLines) {
        const product = productById.get(line.productId);
        const sellingPrice = ownerPricing && line.unitSellingPrice ? line.unitSellingPrice : product?.defaultSellingPrice.toFixed(2) ?? "0";
        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: po.id,
            productId: line.productId,
            quantity: line.quantity,
            unitCost: toDb(line.unitCost),
            unitSellingPrice: toDb(sellingPrice),
            lineTotal: toDb(money(line.unitCost).times(line.quantity)),
          },
        });
        await tx.branchInventory.upsert({
          where: { productId_branchId: { productId: line.productId, branchId } },
          create: { productId: line.productId, branchId, quantity: line.quantity },
          update: { quantity: { increment: line.quantity } },
        });
        // The product keeps the latest purchase cost; only the owner changes selling prices.
        await tx.product.update({
          where: { id: line.productId },
          data: {
            defaultCostPrice: toDb(line.unitCost),
            ...(ownerPricing && line.unitSellingPrice ? { defaultSellingPrice: toDb(line.unitSellingPrice) } : {}),
          },
        });
      }

      if (amountPaid.gt(0) && input.payment.mode !== "CREDIT") {
        const payment = await tx.supplierPayment.create({
          data: {
            purchaseOrderId: po.id,
            supplierId: supplier.id,
            amount: toDb(amountPaid),
            method: input.payment.method,
            reference: input.payment.reference ?? null,
            paidById: ctx.userId,
            paidAt: receivedAt,
          },
          select: { id: true },
        });
        await writeAudit(tx, {
          userId: ctx.userId,
          branchId,
          action: "supplierPayment.create",
          entityType: "SupplierPayment",
          entityId: payment.id,
          after: { purchaseOrderNumber: number, amount: toDb(amountPaid), method: input.payment.method },
        });
      }

      await writeAudit(tx, {
        userId: ctx.userId,
        branchId,
        action: "purchaseOrder.receive",
        entityType: "PurchaseOrder",
        entityId: po.id,
        after: {
          number,
          supplier: supplier.name,
          paymentTerms,
          dueDate,
          totalCost: toDb(totalCost),
          amountPaid: toDb(amountPaid),
          units: units.map((u) => u.value),
          accessories: input.accessoryLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        },
      });

      return { id: po.id, number };
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ValidationError("One of these IMEIs/serials is already recorded in stock. Re-check the list and try again.");
    }
    throw error;
  }
}

export type IntakeSummary = Visible<
  {
    id: string;
    number: string;
    branch: { id: string; name: string; code: string };
    supplierName: string;
    supplierReference: string | null;
    receivedAt: string;
    receivedBy: string;
    paymentTerms: PaymentTerms;
    dueDate: CalendarDate | null;
    status: PurchaseOrderStatus;
    totalCost: string;
    amountPaid: string;
    lines: {
      productId: string;
      productName: string;
      sku: string;
      barcode: string | null;
      trackingType: TrackingType;
      quantity: number;
      unitSellingPrice: string;
      units: { id: string; identifier: string; condition: UnitCondition; sellingPrice: string }[];
    }[];
  },
  "totalCost" | "amountPaid"
>;

/** Intake confirmation / label data. Cost and payment totals are owner-only. */
export async function getIntake(ctx: Ctx, id: string): Promise<IntakeSummary> {
  assertCan(ctx, "intake.create");
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      supplier: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, barcode: true, trackingType: true } },
          serializedUnits: {
            select: { id: true, imei: true, serialNumber: true, condition: true, sellingPrice: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!po) throw new NotFoundError("That intake no longer exists.");
  assertCan(ctx, "intake.create", { branchId: po.branchId });

  // Merge items of the same product (serialized lines were split by cost).
  const lines = new Map<string, IntakeSummary["lines"][number]>();
  for (const item of po.items) {
    const line = lines.get(item.productId) ?? {
      productId: item.productId,
      productName: item.product.name,
      sku: item.product.sku,
      barcode: item.product.barcode,
      trackingType: item.product.trackingType,
      quantity: 0,
      unitSellingPrice: item.unitSellingPrice.toFixed(2),
      units: [],
    };
    line.quantity += item.quantity;
    line.units.push(
      ...item.serializedUnits.map((u) => ({
        id: u.id,
        identifier: u.imei ?? u.serialNumber ?? "",
        condition: u.condition,
        sellingPrice: u.sellingPrice.toFixed(2),
      })),
    );
    lines.set(item.productId, line);
  }

  return stripCostFields(
    ctx,
    {
      id: po.id,
      number: po.number,
      branch: po.branch,
      supplierName: po.supplier.name,
      supplierReference: po.supplierReference,
      receivedAt: po.receivedAt.toISOString(),
      receivedBy: po.receivedBy.name,
      paymentTerms: po.paymentTerms,
      dueDate: po.dueDate ? fromDbDate(po.dueDate) : null,
      status: po.status,
      totalCost: po.totalCost.toFixed(2),
      amountPaid: po.amountPaid.toFixed(2),
      lines: [...lines.values()],
    },
    ["totalCost", "amountPaid"],
  );
}

export function intakeUnitCount(summary: Pick<IntakeSummary, "lines">): number {
  return summary.lines.reduce((n, line) => n + (line.trackingType === "SERIALIZED" ? line.units.length : line.quantity), 0);
}


export type IntakeProductOption = Visible<
  {
    id: string;
    name: string;
    sku: string;
    trackingType: TrackingType;
    defaultSellingPrice: string;
    /** Prefills cost for the owner only. */
    defaultCostPrice: string;
  },
  "defaultCostPrice"
>;

export async function listIntakeProducts(ctx: Ctx): Promise<IntakeProductOption[]> {
  assertCan(ctx, "intake.create");
  const products = await db.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sku: true, trackingType: true, defaultSellingPrice: true, defaultCostPrice: true },
    orderBy: [{ trackingType: "asc" }, { name: "asc" }],
  });
  return products.map((p) =>
    stripCostFields(
      ctx,
      {
        id: p.id,
        name: p.name,
        sku: p.sku,
        trackingType: p.trackingType,
        defaultSellingPrice: p.defaultSellingPrice.toFixed(2),
        defaultCostPrice: p.defaultCostPrice.toFixed(2),
      },
      ["defaultCostPrice"],
    ),
  );
}

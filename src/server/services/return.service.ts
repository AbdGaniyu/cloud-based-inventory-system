import "server-only";

import { z } from "zod";

import type { InvoiceStatus, PaymentMethod, ReturnDisposition, UnitCondition } from "@/generated/prisma/enums";
import { STORE } from "@/config/store";
import { calendarDateInStoreTz, daysBetween } from "@/lib/dates";
import { nextDocumentNumber } from "@/lib/invoice-number";
import { money, sum, toDb, ZERO } from "@/lib/money";
import { lineCreditValues, returnCredit } from "@/lib/returns";
import type { ReturnInput } from "@/lib/validators/return";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { resolveWriteBranchId } from "@/server/branch-context";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import { recomputeInvoiceLedger } from "@/server/services/ledger.service";
import { getSetting } from "@/server/services/settings.service";

/**
 * Returns and swaps (CLAUDE.md §7.6). Goods come back at the receiving branch: devices to IN_STOCK
 * or DEFECTIVE there, accessories back on the shelf unless defective, warranty cards voided. The
 * credit first reduces what the customer still owes; the rest is refunded as a REFUND payment row.
 * A swap is a return followed by a new sale linked to it (see checkout's swapReturnId).
 */

export async function returnWindowDays(): Promise<number> {
  return getSetting("returns.windowDays", z.number().int().min(0).max(365), STORE.returnWindowDays);
}

export type ReturnableLine = {
  invoiceItemId: string;
  description: string;
  identifier: string | null;
  condition: UnitCondition | null;
  quantity: number;
  returnedQuantity: number;
  /** Credit for the whole line; the sheet previews partial returns with returnCredit(). */
  creditValue: string;
  serialized: boolean;
};

export type ReturnContext = {
  invoiceId: string;
  number: string;
  status: InvoiceStatus;
  customerName: string;
  soldAt: string;
  saleBranchName: string;
  balance: string;
  daysSinceSale: number;
  windowDays: number;
  /** Past the window and the user is not the owner. */
  blockedByWindow: boolean;
  lines: ReturnableLine[];
  hasTradeIn: boolean;
};

type InvoiceForReturn = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>;

function loadInvoice(id: string, client: Pick<typeof db, "invoice"> = db) {
  return client.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      branch: { select: { name: true } },
      items: {
        orderBy: { id: "asc" },
        include: {
          serializedUnit: { select: { id: true, imei: true, serialNumber: true, condition: true } },
          warrantyCard: { select: { id: true } },
          returnItems: { select: { quantity: true } },
        },
      },
      tradeIns: { select: { id: true } },
    },
  });
}

function returnableLines(invoice: InvoiceForReturn): ReturnableLine[] {
  const values = lineCreditValues({
    subtotal: invoice.subtotal,
    total: invoice.total,
    lines: invoice.items.map((i) => ({ invoiceItemId: i.id, lineTotal: i.lineTotal })),
  });
  return invoice.items.map((item) => ({
    invoiceItemId: item.id,
    description: item.description,
    identifier: item.serializedUnit?.imei ?? item.serializedUnit?.serialNumber ?? null,
    condition: item.serializedUnit?.condition ?? null,
    quantity: item.quantity,
    returnedQuantity: item.returnItems.reduce((n, r) => n + r.quantity, 0),
    creditValue: (values.get(item.id) ?? ZERO).toFixed(2),
    serialized: item.serializedUnitId !== null,
  }));
}

/** What the Return sheet needs. Prices only — no cost data. */
export async function getReturnContext(ctx: Ctx, invoiceId: string, now: Date = new Date()): Promise<ReturnContext> {
  assertCan(ctx, "return.create");
  const invoice = await loadInvoice(invoiceId);
  if (!invoice) throw new NotFoundError("That invoice no longer exists.");
  const [windowDays, daysSinceSale] = [await returnWindowDays(), daysBetween(calendarDateInStoreTz(invoice.createdAt), calendarDateInStoreTz(now))];
  return {
    invoiceId: invoice.id,
    number: invoice.number,
    status: invoice.status,
    customerName: invoice.customer.name,
    soldAt: invoice.createdAt.toISOString(),
    saleBranchName: invoice.branch.name,
    balance: invoice.balance.toFixed(2),
    daysSinceSale,
    windowDays,
    blockedByWindow: daysSinceSale > windowDays && ctx.role !== "OWNER",
    lines: returnableLines(invoice),
    hasTradeIn: invoice.tradeIns.length > 0,
  };
}

export type ReturnResult = {
  returnId: string;
  number: string;
  invoiceId: string;
  creditAmount: string;
  /** Credit that went against what the customer still owed. */
  appliedToBalance: string;
  refundAmount: string;
  refundMethod: PaymentMethod | null;
  invoiceStatus: InvoiceStatus;
  balance: string;
};

/**
 * Receives returned goods and settles the credit, in one transaction with its audit row. The
 * invoice row is locked first, so two returns of the same line cannot both succeed.
 */
export async function processReturn(ctx: Ctx, input: ReturnInput, options: { now?: Date } = {}): Promise<ReturnResult> {
  const now = options.now ?? new Date();
  const branchId = resolveWriteBranchId(ctx, input.branchId);
  assertCan(ctx, "return.create", { branchId });
  const windowDays = await returnWindowDays();

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("That invoice no longer exists.");
    const invoice = await loadInvoice(input.invoiceId, tx);
    if (!invoice) throw new NotFoundError("That invoice no longer exists.");
    if (invoice.status === "VOID") throw new ConflictError("This invoice is void.");
    if (invoice.status === "RETURNED") throw new ConflictError("Everything on this invoice has already been returned.");
    const days = daysBetween(calendarDateInStoreTz(invoice.createdAt), calendarDateInStoreTz(now));
    if (days > windowDays && ctx.role !== "OWNER") {
      throw new ForbiddenError(`This sale is ${days} days old. Only the owner can accept returns after ${windowDays} days.`);
    }

    const lines = returnableLines(invoice);
    const requested = new Map<string, ReturnInput["lines"][number]>();
    for (const line of input.lines) {
      if (requested.has(line.invoiceItemId)) throw new ValidationError("Each item can appear once in a return.");
      requested.set(line.invoiceItemId, line);
    }

    const returnItems: { invoiceItemId: string; serializedUnitId: string | null; quantity: number; amount: string; disposition: ReturnDisposition }[] = [];
    for (const [itemId, req] of requested) {
      const line = lines.find((l) => l.invoiceItemId === itemId);
      const item = invoice.items.find((i) => i.id === itemId);
      if (!line || !item) throw new ValidationError("That item is not on this invoice.");
      const left = line.quantity - line.returnedQuantity;
      if (req.quantity > left) {
        throw new ValidationError(left === 0 ? `${line.description} was already returned.` : `Only ${left} of ${line.description} can still be returned.`);
      }
      returnItems.push({
        invoiceItemId: itemId,
        serializedUnitId: item.serializedUnitId,
        quantity: req.quantity,
        amount: returnCredit(line.creditValue, line.quantity, line.returnedQuantity, req.quantity).toFixed(2),
        disposition: req.disposition,
      });
    }

    const credit = sum(returnItems.map((r) => r.amount));
    const appliedToBalance = credit.lt(invoice.balance) ? credit : money(invoice.balance);
    const refund = credit.minus(appliedToBalance);
    const number = await nextDocumentNumber(tx, branchId, "RETURN");

    const created = await tx.return.create({
      data: {
        number,
        invoiceId: invoice.id,
        branchId,
        customerId: invoice.customerId,
        reason: input.reason,
        creditAmount: toDb(credit),
        refundAmount: toDb(refund),
        processedById: ctx.userId,
        createdAt: now,
        items: { create: returnItems },
      },
    });

    // Goods back into the receiving branch.
    for (const item of returnItems) {
      if (item.serializedUnitId) {
        const moved = await tx.serializedUnit.updateMany({
          where: { id: item.serializedUnitId, status: "SOLD" },
          data: { status: item.disposition === "RESTOCK" ? "IN_STOCK" : "DEFECTIVE", branchId },
        });
        if (moved.count !== 1) throw new ConflictError("A returned device is no longer marked as sold. Refresh and try again.");
        await tx.warrantyCard.updateMany({
          where: { invoiceItemId: item.invoiceItemId, status: { not: "VOID" } },
          data: { status: "VOID", voidedAt: now, voidReason: `Returned on ${number}` },
        });
      } else if (item.disposition === "RESTOCK") {
        const productId = invoice.items.find((i) => i.id === item.invoiceItemId)?.productId;
        if (!productId) continue;
        await tx.branchInventory.upsert({
          where: { productId_branchId: { productId, branchId } },
          create: { productId, branchId, quantity: item.quantity },
          update: { quantity: { increment: item.quantity } },
        });
      }
    }

    if (refund.gt(0)) {
      await tx.customerPayment.create({
        data: {
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          branchId,
          amount: refund.negated().toFixed(2),
          method: input.refundMethod,
          reference: input.refundReference ?? null,
          kind: "REFUND",
          notes: `Refund for ${number}`,
          receivedById: ctx.userId,
          paidAt: now,
        },
      });
    }

    const fullyReturned = lines.every((l) => l.returnedQuantity + (requested.get(l.invoiceItemId)?.quantity ?? 0) >= l.quantity);
    const ledger = await recomputeInvoiceLedger(tx, invoice.id, now, { fullyReturned });

    await writeAudit(tx, {
      userId: ctx.userId,
      branchId,
      action: "return.create",
      entityType: "Return",
      entityId: created.id,
      before: { invoiceNumber: invoice.number, status: invoice.status, balance: invoice.balance.toFixed(2) },
      after: {
        number,
        reason: input.reason,
        items: returnItems,
        creditAmount: credit.toFixed(2),
        appliedToBalance: appliedToBalance.toFixed(2),
        refundAmount: refund.toFixed(2),
        refundMethod: refund.gt(0) ? input.refundMethod : null,
        lateReturnDays: days > windowDays ? days : null,
        ...ledger,
      },
    });

    return {
      returnId: created.id,
      number,
      invoiceId: invoice.id,
      creditAmount: credit.toFixed(2),
      appliedToBalance: appliedToBalance.toFixed(2),
      refundAmount: refund.toFixed(2),
      refundMethod: refund.gt(0) ? input.refundMethod : null,
      invoiceStatus: ledger.status,
      balance: ledger.balance,
    };
  });
}

export type ReturnSummary = {
  id: string;
  number: string;
  createdAt: string;
  branchName: string;
  processedByName: string;
  reason: string;
  creditAmount: string;
  refundAmount: string;
  items: { description: string; identifier: string | null; quantity: number; amount: string; disposition: ReturnDisposition }[];
  replacement: { invoiceId: string; number: string } | null;
};

/** Returns against an invoice, newest first (invoice detail). */
export async function listInvoiceReturns(ctx: Ctx, invoiceId: string): Promise<ReturnSummary[]> {
  assertCan(ctx, "invoice.view");
  const rows = await db.return.findMany({
    where: { invoiceId },
    include: {
      branch: { select: { name: true } },
      processedBy: { select: { name: true } },
      replacementInvoice: { select: { id: true, number: true } },
      items: { include: { invoiceItem: { select: { description: true } }, serializedUnit: { select: { imei: true, serialNumber: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    createdAt: r.createdAt.toISOString(),
    branchName: r.branch.name,
    processedByName: r.processedBy.name,
    reason: r.reason,
    creditAmount: r.creditAmount.toFixed(2),
    refundAmount: r.refundAmount.toFixed(2),
    items: r.items.map((i) => ({
      description: i.invoiceItem.description,
      identifier: i.serializedUnit?.imei ?? i.serializedUnit?.serialNumber ?? null,
      quantity: i.quantity,
      amount: i.amount.toFixed(2),
      disposition: i.disposition,
    })),
    replacement: r.replacementInvoice ? { invoiceId: r.replacementInvoice.id, number: r.replacementInvoice.number } : null,
  }));
}

export type SwapContext = {
  returnId: string;
  number: string;
  customer: { id: string; name: string; phoneE164: string; whatsappOptIn: boolean; smsOptIn: boolean };
  creditAmount: string;
  refundAmount: string;
  branchId: string;
};

/** POS ?swap=: the return a replacement sale will be linked to, if it can still take one. */
export async function getSwapContext(ctx: Ctx, returnId: string): Promise<SwapContext> {
  assertCan(ctx, "invoice.create");
  const r = await db.return.findUnique({ where: { id: returnId }, include: { customer: { select: { name: true, phoneE164: true, whatsappOptIn: true, smsOptIn: true } } } });
  if (!r) throw new NotFoundError("That return no longer exists.");
  if (r.replacementInvoiceId) throw new ConflictError(`${r.number} already has a replacement sale.`);
  if (ctx.role !== "OWNER" && ctx.branchId !== r.branchId) throw new ForbiddenError("Start the replacement sale at the branch that took the return.");
  return {
    returnId: r.id,
    number: r.number,
    customer: { id: r.customerId, ...r.customer },
    creditAmount: r.creditAmount.toFixed(2),
    refundAmount: r.refundAmount.toFixed(2),
    branchId: r.branchId,
  };
}

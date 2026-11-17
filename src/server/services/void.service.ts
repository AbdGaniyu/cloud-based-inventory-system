import "server-only";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { money, sum } from "@/lib/money";
import type { VoidInvoiceInput } from "@/lib/validators/void";
import { assertCan, can, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, requireRecordId } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";

/**
 * Voiding an invoice (CLAUDE.md §6.6, §8): for a sale that should never have happened (wrong item,
 * wrong customer, keyed twice). The invoice and its number stay, marked VOID with a reason; the
 * stock goes back on the shelf it left; every payment gets an offsetting reversal row so the money
 * handed back is on record; the plan, warranties and pending messages stop. Owners can void any
 * invoice; branch managers only their own branch's, on the day of the sale.
 *
 * Sales that already had a return, took a trade-in or came from a swap are refused: those involve
 * goods moving in both directions, which the Returns flow records properly.
 */

export type VoidPreview = {
  invoiceId: string;
  number: string;
  total: string;
  /** Money to hand back, per method (net of anything already reversed or refunded). */
  refunds: { method: PaymentMethod; amount: string }[];
  refundTotal: string;
  devices: number;
  accessories: number;
  hasPlan: boolean;
  warranties: number;
  /** Why this invoice cannot be voided, or null when it can. */
  blocker: string | null;
};

const loadForVoid = (invoiceId: string, client: Pick<typeof db, "invoice"> = db) =>
  client.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { select: { id: true, productId: true, serializedUnitId: true, quantity: true, warrantyCard: { select: { status: true } } } },
      payments: { select: { id: true, amount: true, method: true, kind: true, reversalOfId: true, reversedBy: { select: { id: true } } } },
      installmentPlan: { select: { id: true, status: true } },
      _count: { select: { returns: true, tradeIns: true } },
      swapFromReturn: { select: { id: true } },
    },
  });
type VoidableInvoice = NonNullable<Awaited<ReturnType<typeof loadForVoid>>>;

function blockerFor(invoice: VoidableInvoice): string | null {
  if (invoice.status === "VOID") return "This invoice is already void.";
  if (invoice.status === "RETURNED") return "Everything on this invoice was returned; there is nothing left to void.";
  if (invoice._count.returns > 0) return "Items on this invoice were already returned. Use Return items for the rest.";
  if (invoice._count.tradeIns > 0) return "This sale took a trade-in. Use Return items so the traded-in device is handled too.";
  if (invoice.swapFromReturn) return "This invoice is the replacement side of a swap. Use Return items instead.";
  return null;
}

/** Received payments not yet reversed, grouped by method: what has to go back to the customer. */
function refundsDue(invoice: VoidableInvoice) {
  const open = invoice.payments.filter((p) => p.kind !== "REFUND" && !p.reversalOfId && !p.reversedBy && money(p.amount).gt(0));
  const byMethod = new Map<PaymentMethod, ReturnType<typeof money>>();
  for (const p of open) byMethod.set(p.method, (byMethod.get(p.method) ?? money(0)).plus(money(p.amount)));
  return { open, byMethod: [...byMethod].map(([method, amount]) => ({ method, amount: amount.toFixed(2) })) };
}

export async function previewVoid(ctx: Ctx, invoiceId: string, options: { now?: Date } = {}): Promise<VoidPreview> {
  requireRecordId(invoiceId, "That invoice no longer exists.");
  const invoice = await loadForVoid(invoiceId);
  if (!invoice) throw new NotFoundError("That invoice no longer exists.");
  assertCan(ctx, "invoice.void", { branchId: invoice.branchId, createdAt: invoice.createdAt }, { now: options.now });
  const { byMethod } = refundsDue(invoice);
  return {
    invoiceId: invoice.id,
    number: invoice.number,
    total: invoice.total.toFixed(2),
    refunds: byMethod,
    refundTotal: sum(byMethod.map((r) => r.amount)).toFixed(2),
    devices: invoice.items.filter((i) => i.serializedUnitId).length,
    accessories: invoice.items.filter((i) => !i.serializedUnitId).reduce((n, i) => n + i.quantity, 0),
    hasPlan: invoice.installmentPlan !== null,
    warranties: invoice.items.filter((i) => i.warrantyCard && i.warrantyCard.status !== "VOID").length,
    blocker: blockerFor(invoice),
  };
}

/** Whether the void button should show for this invoice (the service re-checks everything). */
export function canVoid(ctx: Ctx, invoice: { branchId: string; createdAt: Date; status: string }, now: Date = new Date()): boolean {
  return invoice.status !== "VOID" && invoice.status !== "RETURNED" && can(ctx, "invoice.void", { branchId: invoice.branchId, createdAt: invoice.createdAt }, { now });
}

export type VoidResult = { number: string; refunds: { method: PaymentMethod; amount: string }[]; refundTotal: string };

export async function voidInvoice(ctx: Ctx, input: VoidInvoiceInput, options: { now?: Date } = {}): Promise<VoidResult> {
  const now = options.now ?? new Date();
  requireRecordId(input.invoiceId, "That invoice no longer exists.");
  return db.$transaction(async (tx) => {
    // Lock first: a payment or return arriving at the same moment waits, then sees VOID.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("That invoice no longer exists.");
    const invoice = await loadForVoid(input.invoiceId, tx);
    if (!invoice) throw new NotFoundError("That invoice no longer exists.");
    assertCan(ctx, "invoice.void", { branchId: invoice.branchId, createdAt: invoice.createdAt }, { now });
    const blocker = blockerFor(invoice);
    if (blocker) throw new ConflictError(blocker);

    // Goods back where they were sold.
    for (const item of invoice.items) {
      if (item.serializedUnitId) {
        const back = await tx.serializedUnit.updateMany({ where: { id: item.serializedUnitId, status: "SOLD" }, data: { status: "IN_STOCK", branchId: invoice.branchId } });
        if (back.count !== 1) throw new ConflictError("A device on this invoice is no longer marked as sold. Refresh and try again.");
      } else {
        await tx.branchInventory.upsert({
          where: { productId_branchId: { productId: item.productId, branchId: invoice.branchId } },
          create: { productId: item.productId, branchId: invoice.branchId, quantity: item.quantity },
          update: { quantity: { increment: item.quantity } },
        });
      }
    }

    // Every received payment is reversed with its own offsetting row (invariant 6).
    const { open, byMethod } = refundsDue(invoice);
    for (const p of open) {
      const original = await tx.customerPayment.findUniqueOrThrow({ where: { id: p.id } });
      await tx.customerPayment.create({
        data: {
          invoiceId: original.invoiceId,
          customerId: original.customerId,
          branchId: original.branchId,
          amount: original.amount.negated(),
          method: original.method,
          reference: original.reference,
          kind: original.kind,
          reversalOfId: original.id,
          notes: `Void: ${input.reason}`,
          receivedById: ctx.userId,
          paidAt: now,
        },
      });
    }

    const warranties = await tx.warrantyCard.updateMany({
      where: { invoiceItemId: { in: invoice.items.map((i) => i.id) }, status: { not: "VOID" } },
      data: { status: "VOID", voidedAt: now, voidReason: `Invoice ${invoice.number} voided` },
    });
    if (invoice.installmentPlan) {
      await tx.installmentPlan.update({ where: { id: invoice.installmentPlan.id }, data: { status: "CANCELLED", nextDueDate: null } });
    }
    // Receipts, reminders and retries still waiting for this invoice are dropped.
    await tx.notificationLog.updateMany({ where: { invoiceId: invoice.id, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "SKIPPED", error: "Invoice voided" } });

    // The ledger identity (balance = total − returned − adjusted − paid, a CHECK constraint) holds for
    // void invoices too; every balance total and report leaves VOID out, and screens show "Void".
    const amountPaid = sum(invoice.payments.map((p) => p.amount)).minus(sum(byMethod.map((r) => r.amount)));
    const balance = money(invoice.total).minus(invoice.returnedAmount).minus(invoice.adjustedAmount).minus(amountPaid);
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "VOID", voidedById: ctx.userId, voidedAt: now, voidReason: input.reason, amountPaid: amountPaid.toFixed(2), balance: balance.toFixed(2) },
    });
    const refundTotal = sum(byMethod.map((r) => r.amount)).toFixed(2);
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: invoice.branchId,
      action: "invoice.void",
      entityType: "Invoice",
      entityId: invoice.id,
      before: { number: invoice.number, status: invoice.status, total: invoice.total.toFixed(2), amountPaid: invoice.amountPaid.toFixed(2), balance: invoice.balance.toFixed(2) },
      after: { status: "VOID", reason: input.reason, refunds: byMethod, refundTotal, warrantiesVoided: warranties.count, planCancelled: Boolean(invoice.installmentPlan) },
    });
    return { number: invoice.number, refunds: byMethod, refundTotal };
  });
}

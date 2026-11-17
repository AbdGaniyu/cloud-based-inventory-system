import "server-only";

import { z } from "zod";

import type {
  CustomerPaymentKind,
  InstallmentFrequency,
  InvoicePaymentType,
  InvoiceStatus,
  PaymentMethod,
  ScheduleStatus,
  UnitCondition,
  WarrantyStatus,
} from "@/generated/prisma/enums";
import { type CalendarDate, fromDbDate, todayInStoreTz } from "@/lib/dates";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, requireRecordId } from "@/server/errors";
import { getSetting } from "@/server/services/settings.service";

/**
 * Data for printable documents (CLAUDE.md §7.7): A4 invoice, thermal receipt, warranty card and
 * the public warranty page. No cost data is ever selected here.
 */

export type DisplayInvoiceStatus = InvoiceStatus | "OVERDUE";
/** Instalment status to display: CANCELLED for unpaid rows of a void invoice. */
export type DisplayScheduleStatus = ScheduleStatus | "CANCELLED";

export type InvoiceDocument = {
  id: string;
  number: string;
  status: InvoiceStatus;
  /** Status to display: OVERDUE when an instalment is past due and unpaid. */
  displayStatus: DisplayInvoiceStatus;
  paymentType: InvoicePaymentType;
  createdAt: string;
  branch: { id: string; name: string; code: string; address: string; phone: string; email: string | null };
  customer: { id: string; name: string; phoneE164: string; email: string | null };
  cashierName: string;
  /** Set when the invoice was voided: it is kept for the record and shown as void everywhere. */
  voided: { at: string; byName: string; reason: string } | null;
  items: {
    id: string;
    description: string;
    condition: UnitCondition | null;
    identifier: string | null;
    quantity: number;
    unitPrice: string;
    discount: string;
    lineTotal: string;
    warrantyMonths: number;
    warranty: { id: string; publicId: string; expiresAt: CalendarDate; status: WarrantyStatus } | null;
  }[];
  subtotal: string;
  discount: string;
  tradeInCredit: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  returnedAmount: string;
  adjustedAmount: string;
  amountPaid: string;
  balance: string;
  payments: {
    id: string;
    paidAt: string;
    method: PaymentMethod;
    reference: string | null;
    amount: string;
    kind: CustomerPaymentKind;
    branchName: string;
    /** This row cancels an earlier payment (negative amount). */
    isReversal: boolean;
    /** An offsetting row has cancelled this payment. */
    reversed: boolean;
    notes: string | null;
  }[];
  plan: {
    downPayment: string;
    financedAmount: string;
    frequency: InstallmentFrequency;
    numberOfInstallments: number;
    nextDueDate: CalendarDate | null;
    schedule: { sequence: number; dueDate: CalendarDate; amountDue: string; amountPaid: string; amountWaived: string; status: DisplayScheduleStatus }[];
  } | null;
  tradeIn: { description: string; creditAmount: string } | null;
  voidReason: string | null;
  paymentInstructions: string;
};

const DEFAULT_PAYMENT_INSTRUCTIONS = "Pay at any branch or by bank transfer, quoting your invoice number.";

/** Loads an invoice for documents without a user context (signed links). Callers must authorise first. */
export async function loadInvoiceDocument(id: string, today: CalendarDate = todayInStoreTz()): Promise<InvoiceDocument> {
  requireRecordId(id, "That invoice no longer exists.");
  const [invoice, paymentInstructions] = await Promise.all([
    db.invoice.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, code: true, address: true, phone: true, email: true } },
        customer: { select: { id: true, name: true, phoneE164: true, email: true } },
        cashier: { select: { name: true } },
        voidedBy: { select: { name: true } },
        items: {
          include: {
            serializedUnit: { select: { imei: true, serialNumber: true } },
            warrantyCard: { select: { id: true, publicId: true, expiresAt: true, status: true } },
          },
          orderBy: { id: "asc" },
        },
        payments: { include: { branch: { select: { name: true } }, reversedBy: { select: { id: true } } }, orderBy: { paidAt: "asc" } },
        installmentPlan: { include: { schedule: { orderBy: { sequence: "asc" } } } },
        tradeIns: { select: { description: true, creditAmount: true } },
      },
    }),
    getSetting("payments.instructions", z.string(), DEFAULT_PAYMENT_INSTRUCTIONS),
  ]);
  if (!invoice) throw new NotFoundError("That invoice no longer exists.");

  const schedule =
    invoice.installmentPlan?.schedule.map((row) => {
      const dueDate = fromDbDate(row.dueDate);
      const unpaid = row.amountPaid.lt(row.amountDue);
      // The nightly job marks rows OVERDUE; documents shouldn't wait for it. A void invoice's unpaid rows are cancelled.
      const status: DisplayScheduleStatus =
        invoice.status === "VOID" && row.status !== "PAID"
          ? "CANCELLED"
          : unpaid && dueDate < today && (row.status === "PENDING" || row.status === "PARTIAL")
            ? "OVERDUE"
            : row.status;
      return { sequence: row.sequence, dueDate, amountDue: row.amountDue.toFixed(2), amountPaid: row.amountPaid.toFixed(2), amountWaived: row.amountWaived.toFixed(2), status };
    }) ?? [];
  const overdue = invoice.status !== "VOID" && invoice.status !== "PAID" && schedule.some((r) => r.status === "OVERDUE");

  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    displayStatus: overdue ? "OVERDUE" : invoice.status,
    paymentType: invoice.paymentType,
    createdAt: invoice.createdAt.toISOString(),
    branch: invoice.branch,
    customer: invoice.customer,
    cashierName: invoice.cashier.name,
    voided:
      invoice.status === "VOID" && invoice.voidedAt
        ? { at: invoice.voidedAt.toISOString(), byName: invoice.voidedBy?.name ?? "Unknown", reason: invoice.voidReason ?? "" }
        : null,
    items: invoice.items.map((item) => ({
      id: item.id,
      description: item.description,
      condition: item.condition,
      identifier: item.serializedUnit ? (item.serializedUnit.imei ?? item.serializedUnit.serialNumber) : null,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      discount: item.discount.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
      warrantyMonths: item.warrantyMonths,
      warranty: item.warrantyCard
        ? { id: item.warrantyCard.id, publicId: item.warrantyCard.publicId, expiresAt: fromDbDate(item.warrantyCard.expiresAt), status: item.warrantyCard.status }
        : null,
    })),
    subtotal: invoice.subtotal.toFixed(2),
    discount: invoice.discount.toFixed(2),
    tradeInCredit: invoice.tradeInCredit.toFixed(2),
    taxRate: invoice.taxRate.toFixed(2),
    taxAmount: invoice.taxAmount.toFixed(2),
    total: invoice.total.toFixed(2),
    returnedAmount: invoice.returnedAmount.toFixed(2),
    adjustedAmount: invoice.adjustedAmount.toFixed(2),
    amountPaid: invoice.amountPaid.toFixed(2),
    // The ledger keeps total − paid on a void invoice (a CHECK constraint); nobody owes it, so documents show zero.
    balance: invoice.status === "VOID" ? "0.00" : invoice.balance.toFixed(2),
    payments: invoice.payments.map((p) => ({
      id: p.id,
      paidAt: p.paidAt.toISOString(),
      method: p.method,
      reference: p.reference,
      amount: p.amount.toFixed(2),
      kind: p.kind,
      branchName: p.branch.name,
      isReversal: p.reversalOfId !== null,
      reversed: p.reversedBy !== null,
      notes: p.notes,
    })),
    plan: invoice.installmentPlan
      ? {
          downPayment: invoice.installmentPlan.downPayment.toFixed(2),
          financedAmount: invoice.installmentPlan.financedAmount.toFixed(2),
          frequency: invoice.installmentPlan.frequency,
          numberOfInstallments: invoice.installmentPlan.numberOfInstallments,
          nextDueDate: schedule.find((r) => r.status !== "PAID" && r.status !== "WAIVED" && r.status !== "CANCELLED")?.dueDate ?? null,
          schedule,
        }
      : null,
    tradeIn: invoice.tradeIns[0] ? { description: invoice.tradeIns[0].description, creditAmount: invoice.tradeIns[0].creditAmount.toFixed(2) } : null,
    voidReason: invoice.voidReason,
    paymentInstructions,
  };
}

/** Staff access: any role may view invoices of their own branch; owners see all. */
export async function getInvoiceDocument(ctx: Ctx, id: string): Promise<InvoiceDocument> {
  assertCan(ctx, "invoice.view");
  const doc = await loadInvoiceDocument(id);
  if (ctx.role !== "OWNER" && doc.branch.id !== ctx.branchId) throw new ForbiddenError("That invoice belongs to another branch.");
  return doc;
}

// ─── Warranty ────────────────────────────────────────────────────────────────

export type WarrantyDocument = {
  id: string;
  publicId: string;
  /** EXPIRED is derived from the expiry date as well as the stored status. */
  status: WarrantyStatus;
  startsAt: CalendarDate;
  expiresAt: CalendarDate;
  terms: string;
  deviceName: string;
  spec: string;
  condition: UnitCondition;
  imei: string | null;
  serialNumber: string | null;
  branch: { id: string; name: string; address: string; phone: string };
  invoiceId: string;
  invoiceNumber: string;
};

function effectiveStatus(status: WarrantyStatus, expiresAt: CalendarDate, today: CalendarDate): WarrantyStatus {
  if (status === "VOID") return "VOID";
  return expiresAt < today ? "EXPIRED" : status;
}

async function loadWarranty(where: { id: string } | { publicId: string }, today: CalendarDate): Promise<WarrantyDocument> {
  const card = await db.warrantyCard.findUnique({
    where,
    include: {
      serializedUnit: { select: { imei: true, serialNumber: true, condition: true, storage: true, color: true, product: { select: { name: true } } } },
      branch: { select: { id: true, name: true, address: true, phone: true } },
      invoiceItem: { select: { invoice: { select: { id: true, number: true } } } },
    },
  });
  if (!card) throw new NotFoundError("We couldn't find that warranty.");
  const expiresAt = fromDbDate(card.expiresAt);
  return {
    id: card.id,
    publicId: card.publicId,
    status: effectiveStatus(card.status, expiresAt, today),
    startsAt: fromDbDate(card.startsAt),
    expiresAt,
    terms: card.terms,
    deviceName: card.serializedUnit.product.name,
    spec: [card.serializedUnit.storage, card.serializedUnit.color].filter(Boolean).join(" · "),
    condition: card.serializedUnit.condition,
    imei: card.serializedUnit.imei,
    serialNumber: card.serializedUnit.serialNumber,
    branch: card.branch,
    invoiceId: card.invoiceItem.invoice.id,
    invoiceNumber: card.invoiceItem.invoice.number,
  };
}

/** Warranty certificate for signed links (no user). Callers must authorise first. */
export async function loadWarrantyDocument(id: string, today: CalendarDate = todayInStoreTz()): Promise<WarrantyDocument> {
  requireRecordId(id, "That warranty card no longer exists.");
  return loadWarranty({ id }, today);
}

export async function getWarrantyDocument(ctx: Ctx, id: string): Promise<WarrantyDocument> {
  assertCan(ctx, "invoice.view");
  const doc = await loadWarranty({ id }, todayInStoreTz());
  if (ctx.role !== "OWNER" && doc.branch.id !== ctx.branchId) throw new ForbiddenError("That warranty belongs to another branch.");
  return doc;
}

export type PublicWarranty = {
  publicId: string;
  status: WarrantyStatus;
  deviceName: string;
  spec: string;
  condition: UnitCondition;
  /** IMEI/serial with all but the last four characters hidden. */
  maskedIdentifier: string;
  branchName: string;
  purchasedOn: CalendarDate;
  expiresAt: CalendarDate;
};

export function maskIdentifier(value: string): string {
  const visible = value.slice(-4);
  return `${"•".repeat(Math.max(0, value.length - 4))}${visible}`;
}

/** Public verification page /w/[publicId]: device facts only — no customer name or phone (CLAUDE.md §7.7). */
export async function getPublicWarranty(publicId: string, today: CalendarDate = todayInStoreTz()): Promise<PublicWarranty | null> {
  if (!/^[0-9A-Za-z]{6,32}$/.test(publicId)) return null;
  try {
    const doc = await loadWarranty({ publicId }, today);
    return {
      publicId: doc.publicId,
      status: doc.status,
      deviceName: doc.deviceName,
      spec: doc.spec,
      condition: doc.condition,
      maskedIdentifier: maskIdentifier(doc.imei ?? doc.serialNumber ?? ""),
      branchName: doc.branch.name,
      purchasedOn: doc.startsAt,
      expiresAt: doc.expiresAt,
    };
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

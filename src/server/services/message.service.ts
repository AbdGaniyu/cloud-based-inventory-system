import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { MessageChannel, NotificationStatus } from "@/generated/prisma/enums";
import { type CalendarDate, todayInStoreTz } from "@/lib/dates";
import { money } from "@/lib/money";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { assertBranchAccess } from "@/server/branch-context";
import { db } from "@/server/db";
import { publicWarrantyUrl, refreshSignedUrl, signedDocumentUrl } from "@/server/documents/signed-url";
import { NotFoundError, ValidationError } from "@/server/errors";
import { type NotifyOptions, queueMessage, type QueuedMessage, type QueueRequest, storedVariables } from "@/server/notifications";
import { firstName, messageDate, messageMoney, type TemplateKey, type TemplateVariables, templateLabel } from "@/server/notifications/templates";
import { writeAudit } from "@/server/services/audit.service";
import { type InvoiceDocument, loadInvoiceDocument } from "@/server/services/document.service";

/** Which customer messages exist and when they are queued. Delivery itself lives in server/notifications. */

function receiptRequest(invoice: InvoiceDocument, triggeredById: string | null, now: Date): QueueRequest {
  const documentLink = signedDocumentUrl("invoice", invoice.id, { now });
  return {
    templateKey: "receipt",
    customerId: invoice.customer.id,
    invoiceId: invoice.id,
    dedupeKey: `receipt:${invoice.id}`,
    variables: {
      customer_name: firstName(invoice.customer.name),
      branch_name: invoice.branch.name,
      invoice_number: invoice.number,
      invoice_total: messageMoney(invoice.total),
      amount_paid: messageMoney(invoice.amountPaid),
      balance_remaining: messageMoney(invoice.balance),
      document_link: documentLink,
    },
    mediaUrl: documentLink,
    triggeredById,
  };
}

function warrantyRequests(invoice: InvoiceDocument, triggeredById: string | null, now: Date): QueueRequest[] {
  return invoice.items.flatMap((item) => {
    if (!item.warranty) return [];
    const documentLink = signedDocumentUrl("warranty", item.warranty.id, { now });
    return [
      {
        templateKey: "warranty_card" as const,
        customerId: invoice.customer.id,
        invoiceId: invoice.id,
        dedupeKey: `warranty_card:${item.warranty.id}`,
        variables: {
          customer_name: firstName(invoice.customer.name),
          device_name: item.description,
          serial_masked: item.identifier ? `ending ${item.identifier.slice(-4)}` : "",
          warranty_expiry: messageDate(item.warranty.expiresAt),
          warranty_link: publicWarrantyUrl(item.warranty.publicId),
          document_link: documentLink,
        },
        mediaUrl: documentLink,
        triggeredById,
      },
    ];
  });
}

/** Amount and date of the next unpaid instalment; for a non-instalment balance, the whole balance. */
function nextDue(invoice: InvoiceDocument, today: CalendarDate): { amount: string; date: CalendarDate } {
  const row = invoice.plan?.schedule.find((r) => r.status !== "PAID" && r.status !== "WAIVED");
  if (row) return { amount: money(row.amountDue).minus(row.amountPaid).toFixed(2), date: row.dueDate };
  return { amount: invoice.balance, date: today };
}

/** Variables shared by reminders and instalment templates, from the invoice as it stands now. */
export function balanceVariables(invoice: InvoiceDocument, today: CalendarDate = todayInStoreTz()): TemplateVariables {
  const due = nextDue(invoice, today);
  return {
    customer_name: firstName(invoice.customer.name),
    branch_name: invoice.branch.name,
    invoice_number: invoice.number,
    balance_remaining: messageMoney(invoice.balance),
    amount_due: messageMoney(due.amount),
    due_date: messageDate(due.date),
    payment_instructions: invoice.paymentInstructions,
  };
}

/**
 * Receipt and one warranty card per serialized device, queued after the checkout transaction has
 * committed. Idempotent: queuing the same invoice twice returns the existing rows.
 */
export async function queueCheckoutMessages(invoiceId: string, triggeredById: string | null, options: NotifyOptions = {}): Promise<QueuedMessage[]> {
  const now = options.now ?? new Date();
  const invoice = await loadInvoiceDocument(invoiceId, todayInStoreTz(now));
  const queued: QueuedMessage[] = [];
  for (const request of [receiptRequest(invoice, triggeredById, now), ...warrantyRequests(invoice, triggeredById, now)]) {
    const message = await queueMessage(request, options);
    if (message) queued.push(message);
  }
  return queued;
}

/**
 * "We have received …" for a repayment, queued after the payment transaction commits. The balance is
 * read from the invoice as it stands, so it reflects this payment.
 */
export async function queuePaymentConfirmation(paymentId: string, triggeredById: string | null, options: NotifyOptions = {}): Promise<QueuedMessage | null> {
  const payment = await db.customerPayment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { branch: { select: { name: true } }, customer: { select: { name: true } }, invoice: { select: { number: true, balance: true } } },
  });
  return queueMessage(
    {
      templateKey: "payment_confirmation",
      customerId: payment.customerId,
      invoiceId: payment.invoiceId,
      dedupeKey: `payment_confirmation:${payment.id}`,
      variables: {
        customer_name: firstName(payment.customer.name),
        amount_paid: messageMoney(payment.amount),
        invoice_number: payment.invoice.number,
        branch_name: payment.branch.name,
        balance_remaining: messageMoney(payment.invoice.balance),
      },
      triggeredById,
    },
    options,
  );
}

/** Two clicks within the same minute are one request, not two messages. */
const minuteStamp = (now: Date) => now.toISOString().slice(0, 16);

async function invoiceInScope(ctx: Ctx, invoiceId: string, now: Date): Promise<InvoiceDocument> {
  const invoice = await loadInvoiceDocument(invoiceId, todayInStoreTz(now));
  assertBranchAccess(ctx, invoice.branch.id);
  return invoice;
}

async function assertReachable(customerId: string): Promise<void> {
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { whatsappOptIn: true, smsOptIn: true } });
  if (!customer.whatsappOptIn && !customer.smsOptIn) {
    throw new ValidationError("This customer has opted out of WhatsApp and SMS. Update their message preferences first.");
  }
}

/** Queues a manual message with its audit row; the caller delivers it after responding. */
async function queueManual(ctx: Ctx, request: QueueRequest, audit: { action: string; branchId: string | null }, now: Date): Promise<QueuedMessage> {
  return db.$transaction(async (tx) => {
    const message = await queueMessage(request, { client: tx, now });
    if (!message) throw new ValidationError("This message template is switched off in Settings.");
    if (message.created) {
      await writeAudit(tx, {
        userId: ctx.userId,
        branchId: audit.branchId,
        action: audit.action,
        entityType: "NotificationLog",
        entityId: message.id,
        after: { templateKey: request.templateKey, invoiceId: request.invoiceId, channel: message.channel },
      });
    }
    return message;
  });
}

/** Staff "Send reminder" on an invoice with a balance (manual_reminder template). */
export async function sendInvoiceReminder(ctx: Ctx, invoiceId: string, options: NotifyOptions = {}): Promise<QueuedMessage> {
  assertCan(ctx, "message.send");
  const now = options.now ?? new Date();
  const invoice = await invoiceInScope(ctx, invoiceId, now);
  if (invoice.status === "VOID" || money(invoice.balance).lte(0)) throw new ValidationError("This invoice has nothing left to pay.");
  await assertReachable(invoice.customer.id);
  return queueManual(
    ctx,
    {
      templateKey: "manual_reminder",
      customerId: invoice.customer.id,
      invoiceId: invoice.id,
      dedupeKey: `manual_reminder:${invoice.id}:${minuteStamp(now)}`,
      variables: balanceVariables(invoice, todayInStoreTz(now)),
      triggeredById: ctx.userId,
    },
    { action: "message.reminder", branchId: invoice.branch.id },
    now,
  );
}

/**
 * Sends a logged message again as a new message, starting from WhatsApp per the customer's current
 * opt-ins. Document links are re-signed; receipts and warranty cards are rebuilt from current data.
 */
export async function resendMessage(ctx: Ctx, notificationId: string, options: NotifyOptions = {}): Promise<QueuedMessage> {
  assertCan(ctx, "message.send");
  const now = options.now ?? new Date();
  const found = await db.notificationLog.findUnique({ where: { id: notificationId } });
  if (!found) throw new NotFoundError("That message no longer exists.");
  const original = found.parentId ? await db.notificationLog.findUniqueOrThrow({ where: { id: found.parentId } }) : found;
  const invoice = original.invoiceId ? await invoiceInScope(ctx, original.invoiceId, now) : null;
  await assertReachable(original.customerId);

  const stored = storedVariables(original.variables);
  let request: QueueRequest;
  if (invoice && original.templateKey === "receipt") {
    request = receiptRequest(invoice, ctx.userId, now);
  } else if (invoice && original.templateKey === "warranty_card") {
    const cardId = original.dedupeKey.split(":")[1];
    const match = warrantyRequests(invoice, ctx.userId, now).find((r) => r.dedupeKey === `warranty_card:${cardId}`);
    if (!match) throw new NotFoundError("That warranty card is no longer on this invoice.");
    request = match;
  } else {
    const variables = { ...(invoice ? balanceVariables(invoice, todayInStoreTz(now)) : {}), ...stored };
    if (variables.document_link) variables.document_link = refreshSignedUrl(variables.document_link, { now });
    request = {
      templateKey: original.templateKey as TemplateKey,
      customerId: original.customerId,
      invoiceId: original.invoiceId,
      dedupeKey: "",
      variables,
      mediaUrl: original.mediaUrl ? refreshSignedUrl(original.mediaUrl, { now }) : null,
      triggeredById: ctx.userId,
    };
  }
  return queueManual(
    ctx,
    { ...request, dedupeKey: `resend:${original.id}:${minuteStamp(now)}`, triggeredById: ctx.userId },
    { action: "message.resend", branchId: invoice?.branch.id ?? null },
    now,
  );
}

export type MessageView = {
  id: string;
  templateKey: string;
  label: string;
  channel: MessageChannel;
  to: string;
  body: string;
  status: NotificationStatus;
  error: string | null;
  attempts: number;
  isFallback: boolean;
  triggeredByName: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
};

/** Messages about one invoice, newest first (invoice detail and the POS success panel). */
export async function listInvoiceMessages(ctx: Ctx, invoiceId: string): Promise<MessageView[]> {
  assertCan(ctx, "notification.view");
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, select: { branchId: true } });
  if (!invoice) throw new NotFoundError("That invoice no longer exists.");
  assertBranchAccess(ctx, invoice.branchId);
  return loadMessages({ invoiceId });
}

const MESSAGE_LIST_LIMIT = 100;

/**
 * Messages to one customer, newest first (customer profile). Non-owners see messages about their
 * own branch's invoices plus those tied to no invoice.
 */
export async function listCustomerMessages(ctx: Ctx, customerId: string): Promise<MessageView[]> {
  assertCan(ctx, "notification.view");
  return loadMessages({
    customerId,
    ...(ctx.role === "OWNER" ? {} : { OR: [{ invoiceId: null }, { invoice: { branchId: ctx.branchId ?? undefined } }] }),
  });
}

async function loadMessages(where: Prisma.NotificationLogWhereInput): Promise<MessageView[]> {
  const rows = await db.notificationLog.findMany({
    where,
    include: { triggeredBy: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_LIST_LIMIT,
  });
  return rows.map((r) => ({
    id: r.id,
    templateKey: r.templateKey,
    label: templateLabel(r.templateKey),
    channel: r.channel,
    to: r.to,
    body: r.body,
    status: r.status,
    error: r.error,
    attempts: r.attempts,
    isFallback: r.parentId !== null,
    triggeredByName: r.triggeredBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
  }));
}

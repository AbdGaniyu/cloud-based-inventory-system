import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type { EraseCustomerInput } from "@/lib/validators/privacy";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ConflictError, NotFoundError, requireRecordId } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import { getSetting } from "@/server/services/settings.service";

/**
 * Customer personal data under the Nigeria Data Protection Act 2023: recording that the privacy
 * notice was given, exporting what we hold (access request), erasing personal details (erasure
 * request) and removing old message texts after a retention period. Invoices, payments and their
 * audit trail stay: tax law requires keeping financial records, so they're kept against an
 * "Erased customer" with no name, number or contact details.
 */

export const ERASED_NAME = "Erased customer";
const REDACTED = "[removed]";

/** Records that the customer was told how their details are used (for customers added before this existed, or re-told). */
export async function recordPrivacyNotice(ctx: Ctx, customerId: string, now: Date = new Date()): Promise<void> {
  assertCan(ctx, "customer.create");
  requireRecordId(customerId, "That customer no longer exists.");
  await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { erasedAt: true } });
    if (!customer) throw new NotFoundError("That customer no longer exists.");
    if (customer.erasedAt) throw new ConflictError("This customer's details were erased.");
    await tx.customer.update({ where: { id: customerId }, data: { noticeGivenAt: now, noticeGivenById: ctx.userId } });
    await writeAudit(tx, { userId: ctx.userId, branchId: ctx.branchId, action: "customer.privacyNotice", entityType: "Customer", entityId: customerId, after: { noticeGivenAt: now.toISOString() } });
  });
}

/** Everything held on one customer, as plain JSON for an access request. */
export async function exportCustomerData(ctx: Ctx, customerId: string, now: Date = new Date()) {
  assertCan(ctx, "customer.privacy");
  requireRecordId(customerId, "That customer no longer exists.");
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      invoices: {
        orderBy: { createdAt: "asc" },
        include: {
          branch: { select: { name: true } },
          items: { select: { description: true, quantity: true, lineTotal: true, serializedUnit: { select: { imei: true, serialNumber: true } } } },
          installmentPlan: { include: { schedule: { orderBy: { sequence: "asc" }, select: { sequence: true, dueDate: true, amountDue: true, amountPaid: true, status: true } } } },
        },
      },
      payments: { orderBy: { paidAt: "asc" }, select: { paidAt: true, amount: true, method: true, reference: true, kind: true } },
      warrantyCards: { select: { publicId: true, startsAt: true, expiresAt: true, status: true } },
      tradeIns: { select: { createdAt: true, description: true, imei: true, serialNumber: true, creditAmount: true } },
      notifications: { orderBy: { createdAt: "asc" }, select: { createdAt: true, channel: true, templateKey: true, to: true, body: true, status: true } },
    },
  });
  if (!customer) throw new NotFoundError("That customer no longer exists.");
  await db.$transaction(async (tx) => {
    await writeAudit(tx, { userId: ctx.userId, branchId: ctx.branchId, action: "customer.export", entityType: "Customer", entityId: customerId });
  });
  return {
    exportedAt: now.toISOString(),
    customer: {
      name: customer.name,
      phone: customer.phoneE164,
      email: customer.email,
      address: customer.address,
      whatsappMessages: customer.whatsappOptIn,
      smsMessages: customer.smsOptIn,
      notes: customer.notes,
      createdAt: customer.createdAt.toISOString(),
      privacyNoticeGivenAt: customer.noticeGivenAt?.toISOString() ?? null,
      erasedAt: customer.erasedAt?.toISOString() ?? null,
    },
    invoices: customer.invoices.map((i) => ({
      number: i.number,
      date: i.createdAt.toISOString(),
      branch: i.branch.name,
      status: i.status,
      total: i.total.toFixed(2),
      balance: i.status === "VOID" ? "0.00" : i.balance.toFixed(2),
      items: i.items.map((it) => ({ description: it.description, quantity: it.quantity, amount: it.lineTotal.toFixed(2), imei: it.serializedUnit?.imei ?? null, serial: it.serializedUnit?.serialNumber ?? null })),
      instalmentPlan: i.installmentPlan
        ? {
            guarantorName: i.installmentPlan.guarantorName,
            guarantorPhone: i.installmentPlan.guarantorPhone,
            idVerificationNotes: i.installmentPlan.idVerificationNotes,
            schedule: i.installmentPlan.schedule.map((r) => ({ sequence: r.sequence, dueDate: r.dueDate.toISOString().slice(0, 10), amountDue: r.amountDue.toFixed(2), amountPaid: r.amountPaid.toFixed(2), status: r.status })),
          }
        : null,
    })),
    payments: customer.payments.map((p) => ({ date: p.paidAt.toISOString(), amount: p.amount.toFixed(2), method: p.method, reference: p.reference, kind: p.kind })),
    warranties: customer.warrantyCards.map((w) => ({ code: w.publicId, from: w.startsAt.toISOString().slice(0, 10), until: w.expiresAt.toISOString().slice(0, 10), status: w.status })),
    tradeIns: customer.tradeIns.map((t) => ({ date: t.createdAt.toISOString(), device: t.description, imei: t.imei, serial: t.serialNumber, credit: t.creditAmount.toFixed(2) })),
    messages: customer.notifications.map((n) => ({ date: n.createdAt.toISOString(), channel: n.channel, kind: n.templateKey, to: n.to, text: n.body, status: n.status })),
  };
}
export type CustomerExport = Awaited<ReturnType<typeof exportCustomerData>>;

/**
 * Erasure request: removes the name, phone, email, address, notes, guarantor details and message
 * texts, and stops all messages. Refused while the customer still owes money (the balance is a
 * live agreement we need their contact details for).
 */
export async function eraseCustomer(ctx: Ctx, input: EraseCustomerInput, now: Date = new Date()): Promise<void> {
  assertCan(ctx, "customer.privacy");
  requireRecordId(input.customerId, "That customer no longer exists.");
  await db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { erasedAt: true } });
    if (!customer) throw new NotFoundError("That customer no longer exists.");
    if (customer.erasedAt) throw new ConflictError("This customer's details were already erased.");
    const owing = await tx.invoice.count({ where: { customerId: input.customerId, status: { in: ["UNPAID", "PARTIALLY_PAID"] }, balance: { gt: 0 } } });
    if (owing > 0) throw new ConflictError("This customer still owes money. Settle or waive the balance first; until then we need their contact details.");
    await tx.customer.update({
      where: { id: input.customerId },
      data: {
        name: ERASED_NAME,
        // Unique and not a phone number: nothing can be sent to it and search won't find it.
        phoneE164: `erased-${input.customerId}`,
        email: null,
        address: null,
        notes: null,
        whatsappOptIn: false,
        smsOptIn: false,
        erasedAt: now,
        erasedById: ctx.userId,
      },
    });
    await tx.installmentPlan.updateMany({ where: { invoice: { customerId: input.customerId } }, data: { guarantorName: null, guarantorPhone: null, idVerificationNotes: null } });
    await tx.notificationLog.updateMany({ where: { customerId: input.customerId }, data: { to: REDACTED, body: REDACTED, variables: Prisma.DbNull, mediaUrl: null, redactedAt: now } });
    // The reason is recorded; the erased details are not (the audit row would otherwise keep them).
    await writeAudit(tx, { userId: ctx.userId, branchId: ctx.branchId, action: "customer.erase", entityType: "Customer", entityId: input.customerId, after: { reason: input.reason } });
  });
}

export const DEFAULT_MESSAGE_RETENTION_DAYS = 365;
const REDACT_BATCH = 500;

/** Removes the text and recipient of messages older than the retention period (run by the 15-minute job, in batches). */
export async function redactOldMessages(now: Date = new Date()): Promise<number> {
  const days = await getSetting("privacy.messageRetentionDays", z.coerce.number().int().min(30).max(3650), DEFAULT_MESSAGE_RETENTION_DAYS);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const ids = (await db.notificationLog.findMany({ where: { createdAt: { lt: cutoff }, redactedAt: null }, select: { id: true }, take: REDACT_BATCH })).map((r) => r.id);
  if (ids.length === 0) return 0;
  const { count } = await db.notificationLog.updateMany({ where: { id: { in: ids } }, data: { to: REDACTED, body: REDACTED, variables: Prisma.DbNull, mediaUrl: null, redactedAt: now } });
  return count;
}

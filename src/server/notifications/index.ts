import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type { MessageChannel, NotificationStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { type Providers, resolveProviders } from "@/server/notifications/providers";
import { type OutgoingMessage, ProviderError, type DeliveryUpdate } from "@/server/notifications/providers/types";
import { renderTemplate, type TemplateKey, type TemplateVariables, variablesInOrder } from "@/server/notifications/templates";
import { reportError } from "@/server/ops/errors";
import { getSetting } from "@/server/services/settings.service";

/**
 * NotificationService (CLAUDE.md §9). Flow: render template → write a QUEUED log row → try WhatsApp
 * (when opted in) → on failure or no opt-in, SMS with links instead of attachments → update the row.
 * Webhooks then move rows to DELIVERED or FAILED. Callers commit their sale or payment first and
 * queue afterwards: nothing here may roll back business data (invariant 11).
 */

export type NotifyOptions = { providers?: Providers; now?: Date };

type Client = Prisma.TransactionClient | typeof db;

export type QueueRequest = {
  templateKey: TemplateKey;
  customerId: string;
  invoiceId?: string | null;
  /** Unique per logical message: a second queue with the same key returns the first row (invariant 13). */
  dedupeKey: string;
  variables: TemplateVariables;
  /** Signed document link attached on WhatsApp. SMS carries links in the text instead. */
  mediaUrl?: string | null;
  triggeredById?: string | null;
};

export type QueuedMessage = { id: string; templateKey: string; channel: MessageChannel; status: NotificationStatus; created: boolean };

const DEFAULT_MAX_ATTEMPTS = 3;
const ERROR_MAX_LENGTH = 500;
export const OPTED_OUT_ERROR = "Customer has opted out of WhatsApp and SMS";

const variablesSchema = z.record(z.string(), z.string());

export function storedVariables(value: Prisma.JsonValue | null): TemplateVariables {
  const parsed = variablesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const summary = (row: { id: string; templateKey: string; channel: MessageChannel; status: NotificationStatus }, created: boolean): QueuedMessage => ({
  id: row.id,
  templateKey: row.templateKey,
  channel: row.channel,
  status: row.status,
  created,
});

const errorText = (error: unknown) =>
  (error instanceof ProviderError || error instanceof Error ? error.message : "Unknown provider error").slice(0, ERROR_MAX_LENGTH);

/**
 * Writes the log row for a message. Returns null when the template is missing or switched off.
 * A customer opted out of both channels gets a SKIPPED row so the skip is visible (invariant 12).
 */
export async function queueMessage(request: QueueRequest, options: NotifyOptions & { client?: Client } = {}): Promise<QueuedMessage | null> {
  const client = options.client ?? db;
  const existing = await client.notificationLog.findUnique({ where: { dedupeKey: request.dedupeKey } });
  if (existing) return summary(existing, false);

  const [template, customer] = await Promise.all([
    client.messageTemplate.findUnique({ where: { key: request.templateKey } }),
    client.customer.findUniqueOrThrow({ where: { id: request.customerId }, select: { phoneE164: true, whatsappOptIn: true, smsOptIn: true } }),
  ]);
  if (!template?.isActive) return null;

  const providers = options.providers ?? (await resolveProviders());
  const channel: MessageChannel | null = customer.whatsappOptIn ? "WHATSAPP" : customer.smsOptIn ? "SMS" : null;
  const smsBody = template.smsBody ?? template.body;
  const now = options.now ?? new Date();
  const data: Prisma.NotificationLogUncheckedCreateInput = {
    customerId: request.customerId,
    invoiceId: request.invoiceId ?? null,
    templateKey: request.templateKey,
    channel: channel ?? "WHATSAPP",
    provider: channel === "WHATSAPP" ? providers.whatsapp.name : channel === "SMS" ? providers.sms.name : "none",
    to: customer.phoneE164,
    body: renderTemplate(channel === "SMS" ? smsBody : template.body, request.variables),
    mediaUrl: channel === "WHATSAPP" ? (request.mediaUrl ?? null) : null,
    variables: request.variables,
    status: channel ? "QUEUED" : "SKIPPED",
    error: channel ? null : OPTED_OUT_ERROR,
    dedupeKey: request.dedupeKey,
    triggeredById: request.triggeredById ?? null,
    createdAt: now,
  };
  try {
    return summary(await client.notificationLog.create({ data }), true);
  } catch (error) {
    if (client !== db || !isUniqueViolation(error)) throw error;
    // Another request queued the same message first: that row wins.
    return summary(await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: request.dedupeKey } }), false);
  }
}

/**
 * Sends one queued (or failed, retryable) row. The attempt is claimed with a conditional update on
 * the attempt counter, so two workers can never send the same row twice. A failed WhatsApp send
 * falls back to SMS.
 */
export async function deliverMessage(id: string, options: NotifyOptions = {}): Promise<NotificationStatus | null> {
  const now = options.now ?? new Date();
  const row = await db.notificationLog.findUnique({ where: { id } });
  if (!row || (row.status !== "QUEUED" && row.status !== "FAILED")) return row?.status ?? null;
  const maxAttempts = await getSetting("notifications.maxAttempts", z.number().int().min(1).max(10), DEFAULT_MAX_ATTEMPTS);
  if (row.attempts >= maxAttempts) return row.status;

  const claimed = await db.notificationLog.updateMany({
    where: { id, attempts: row.attempts, status: row.status },
    data: { attempts: { increment: 1 }, lastAttemptAt: now, status: "QUEUED" },
  });
  if (claimed.count === 0) return null;

  const providers = options.providers ?? (await resolveProviders());
  const provider = row.channel === "WHATSAPP" ? providers.whatsapp : providers.sms;
  const template = await db.messageTemplate.findUnique({ where: { key: row.templateKey } });
  const variables = storedVariables(row.variables);
  const message: OutgoingMessage = { to: row.to, body: row.body };
  if (row.channel === "WHATSAPP") {
    if (row.mediaUrl) {
      message.mediaUrl = row.mediaUrl;
      message.mediaFilename = row.templateKey === "warranty_card" ? "warranty-card.pdf" : "invoice.pdf";
    }
    if (template?.whatsappTemplateName) {
      message.templateName = template.whatsappTemplateName;
      message.templateLanguage = template.whatsappTemplateLanguage;
      message.variables = variablesInOrder(template.body, variables);
    }
  }

  try {
    const { providerMessageId } = await provider.send(message);
    await db.notificationLog.updateMany({
      where: { id, status: "QUEUED" },
      data: { status: "SENT", provider: provider.name, providerMessageId, sentAt: new Date(), error: null, failedAt: null },
    });
    return "SENT";
  } catch (error) {
    await db.notificationLog.updateMany({
      where: { id, status: "QUEUED" },
      data: { status: "FAILED", provider: provider.name, error: errorText(error), failedAt: new Date() },
    });
    if (row.channel === "WHATSAPP") await fallBackToSms(id, options);
    return "FAILED";
  }
}

/** Queues and sends the SMS version of a failed WhatsApp message, once (dedupe key `{parent}:SMS`). */
async function fallBackToSms(parentId: string, options: NotifyOptions): Promise<void> {
  const parent = await db.notificationLog.findUniqueOrThrow({ where: { id: parentId }, include: { customer: { select: { smsOptIn: true } } } });
  if (!parent.customer.smsOptIn) return;
  const dedupeKey = `${parent.dedupeKey}:SMS`;
  if (await db.notificationLog.findUnique({ where: { dedupeKey }, select: { id: true } })) return;

  const template = await db.messageTemplate.findUnique({ where: { key: parent.templateKey } });
  const providers = options.providers ?? (await resolveProviders());
  const variables = storedVariables(parent.variables);
  let child: { id: string };
  try {
    child = await db.notificationLog.create({
      data: {
        customerId: parent.customerId,
        invoiceId: parent.invoiceId,
        templateKey: parent.templateKey,
        channel: "SMS",
        provider: providers.sms.name,
        to: parent.to,
        body: renderTemplate(template?.smsBody ?? template?.body ?? parent.body, variables),
        variables: parent.variables ?? Prisma.DbNull,
        status: "QUEUED",
        dedupeKey,
        parentId: parent.id,
        triggeredById: parent.triggeredById,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }
  await deliverMessage(child.id, options);
}

/** Sends several rows one after another; a failure on one never stops the rest. */
export async function deliverMessages(ids: string[], options: NotifyOptions = {}): Promise<void> {
  for (const id of ids) {
    try {
      await deliverMessage(id, options);
    } catch (error) {
      await reportError(error, { source: "message", route: `notification:${id}` });
    }
  }
}

/**
 * Applies provider status callbacks. Status only moves forward (QUEUED → SENT → DELIVERED, or to
 * FAILED before delivery), so late or repeated webhooks are harmless. A WhatsApp message that fails
 * after it was accepted still falls back to SMS.
 */
export async function applyDeliveryUpdates(providerName: string, updates: DeliveryUpdate[], options: NotifyOptions = {}): Promise<number> {
  let applied = 0;
  for (const update of updates) {
    const row = await db.notificationLog.findFirst({
      where: { provider: providerName, providerMessageId: update.providerMessageId },
      select: { id: true, channel: true },
    });
    if (!row) continue;
    const now = options.now ?? new Date();
    const result =
      update.status === "DELIVERED"
        ? await db.notificationLog.updateMany({ where: { id: row.id, status: { in: ["QUEUED", "SENT"] } }, data: { status: "DELIVERED", deliveredAt: now } })
        : update.status === "SENT"
          ? await db.notificationLog.updateMany({ where: { id: row.id, status: "QUEUED" }, data: { status: "SENT", sentAt: now } })
          : await db.notificationLog.updateMany({
              where: { id: row.id, status: { in: ["QUEUED", "SENT"] } },
              data: { status: "FAILED", error: (update.error ?? "Delivery failed").slice(0, ERROR_MAX_LENGTH), failedAt: now },
            });
    applied += result.count;
    if (result.count > 0 && update.status === "FAILED" && row.channel === "WHATSAPP") await fallBackToSms(row.id, options);
  }
  return applied;
}

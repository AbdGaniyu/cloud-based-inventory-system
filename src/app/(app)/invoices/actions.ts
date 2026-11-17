"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { deliverMessages } from "@/server/notifications";
import type { QueuedMessage } from "@/server/notifications";
import { listInvoiceMessages, type MessageView, resendMessage, sendInvoiceReminder } from "@/server/services/message.service";

function id(input: unknown): string {
  const parsed = z.guid().safeParse(input);
  if (!parsed.success) throw new ValidationError("That record could not be found.");
  return parsed.data;
}

function deliverAfterResponse(message: QueuedMessage) {
  if (message.created && message.status === "QUEUED") after(() => deliverMessages([message.id]));
}

export async function sendReminder(invoiceId: unknown): Promise<ActionResult<QueuedMessage>> {
  return runAction(async () => {
    const message = await sendInvoiceReminder(await requireActionSession(), id(invoiceId));
    deliverAfterResponse(message);
    revalidatePath("/invoices/[id]", "page");
    return message;
  });
}

export async function resendNotification(notificationId: unknown): Promise<ActionResult<QueuedMessage>> {
  return runAction(async () => {
    const message = await resendMessage(await requireActionSession(), id(notificationId));
    deliverAfterResponse(message);
    revalidatePath("/invoices/[id]", "page");
    return message;
  });
}

export async function invoiceMessages(invoiceId: unknown): Promise<ActionResult<MessageView[]>> {
  return runAction(async () => listInvoiceMessages(await requireActionSession(), id(invoiceId)));
}

"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { returnSchema } from "@/lib/validators/return";
import { voidInvoiceSchema } from "@/lib/validators/void";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import { deliverMessages, type QueuedMessage } from "@/server/notifications";
import { parseInput } from "@/server/parse-input";
import { listInvoiceMessages, type MessageView, resendMessage, sendInvoiceReminder } from "@/server/services/message.service";
import { getReturnContext, processReturn, type ReturnContext, type ReturnResult } from "@/server/services/return.service";
import { previewVoid, type VoidPreview, type VoidResult, voidInvoice } from "@/server/services/void.service";

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

export async function loadReturnContext(invoiceId: unknown): Promise<ActionResult<ReturnContext>> {
  return runAction(async () => getReturnContext(await requireActionSession(), id(invoiceId)));
}

export async function submitReturn(input: unknown): Promise<ActionResult<ReturnResult>> {
  return runAction(async () => {
    const result = await processReturn(await requireActionSession(), parseInput(returnSchema, input));
    revalidatePath("/invoices/[id]", "page");
    revalidatePath("/inventory");
    revalidatePath("/ledger/receivables");
    return result;
  });
}

export async function loadVoidPreview(invoiceId: unknown): Promise<ActionResult<VoidPreview>> {
  return runAction(async () => previewVoid(await requireActionSession(), id(invoiceId)));
}

export async function submitVoid(input: unknown): Promise<ActionResult<VoidResult>> {
  return runAction(async () => {
    const result = await voidInvoice(await requireActionSession(), parseInput(voidInvoiceSchema, input));
    revalidatePath("/invoices/[id]", "page");
    revalidatePath("/invoices");
    revalidatePath("/inventory");
    revalidatePath("/ledger/receivables");
    revalidatePath("/dashboard");
    return result;
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import type { NotificationStatus } from "@/generated/prisma/enums";
import {
  customerPreferencesSchema,
  planRemindersSchema,
  recordPaymentSchema,
  reversePaymentSchema,
  supplierPayoutSchema,
  waiveDebtSchema,
} from "@/lib/validators/payment";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { deliverMessages } from "@/server/notifications";
import { parseInput } from "@/server/parse-input";
import { updateCustomerPreferences } from "@/server/services/customer.service";
import {
  getPaymentContext,
  type LedgerSnapshot,
  type PaymentContext,
  type PaymentResult,
  recordCustomerPayment,
  reverseCustomerPayment,
  setPlanReminders,
  waiveDebt,
} from "@/server/services/ledger.service";
import { listCustomerMessages, type MessageView, queuePaymentConfirmation } from "@/server/services/message.service";
import { type PayoutResult, recordSupplierPayout } from "@/server/services/payables.service";

function refreshLedgerPages() {
  revalidatePath("/ledger/receivables");
  revalidatePath("/invoices", "layout");
  revalidatePath("/customers", "layout");
}

export async function loadPaymentContext(invoiceId: unknown): Promise<ActionResult<PaymentContext>> {
  return runAction(async () => getPaymentContext(await requireActionSession(), parseInput(z.guid(), invoiceId)));
}

export type RecordedPayment = PaymentResult & { confirmation: { channel: "WHATSAPP" | "SMS"; status: NotificationStatus } | null };

/** Records the payment, then queues the confirmation; a messaging problem never undoes the payment. */
export async function recordPayment(input: unknown): Promise<ActionResult<RecordedPayment>> {
  return runAction(async () => {
    const ctx = await requireActionSession();
    const result = await recordCustomerPayment(ctx, parseInput(recordPaymentSchema, input));
    refreshLedgerPages();
    let confirmation: RecordedPayment["confirmation"] = null;
    try {
      const queued = await queuePaymentConfirmation(result.paymentId, ctx.userId);
      if (queued) {
        confirmation = { channel: queued.channel, status: queued.status };
        if (queued.status === "QUEUED") after(() => deliverMessages([queued.id]));
      }
    } catch (error) {
      console.error(`Could not queue a confirmation for payment ${result.paymentId}`, error);
    }
    return { ...result, confirmation };
  });
}

export async function reversePayment(input: unknown): Promise<ActionResult<LedgerSnapshot>> {
  return runAction(async () => {
    const result = await reverseCustomerPayment(await requireActionSession(), parseInput(reversePaymentSchema, input));
    refreshLedgerPages();
    return result;
  });
}

export async function waiveBalance(input: unknown): Promise<ActionResult<LedgerSnapshot>> {
  return runAction(async () => {
    const result = await waiveDebt(await requireActionSession(), parseInput(waiveDebtSchema, input));
    refreshLedgerPages();
    return result;
  });
}

export async function toggleReminders(input: unknown): Promise<ActionResult<boolean>> {
  return runAction(async () => {
    const result = await setPlanReminders(await requireActionSession(), parseInput(planRemindersSchema, input));
    revalidatePath("/ledger/receivables");
    return result;
  });
}

export async function paySupplier(input: unknown): Promise<ActionResult<PayoutResult>> {
  return runAction(async () => {
    const result = await recordSupplierPayout(await requireActionSession(), parseInput(supplierPayoutSchema, input));
    revalidatePath("/ledger/payables");
    revalidatePath("/suppliers", "layout");
    return result;
  });
}

export async function saveCustomerPreferences(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await updateCustomerPreferences(await requireActionSession(), parseInput(customerPreferencesSchema, input));
    revalidatePath("/customers", "layout");
    return null;
  });
}

export async function customerMessages(customerId: unknown): Promise<ActionResult<MessageView[]>> {
  return runAction(async () => listCustomerMessages(await requireActionSession(), parseInput(z.guid(), customerId)));
}

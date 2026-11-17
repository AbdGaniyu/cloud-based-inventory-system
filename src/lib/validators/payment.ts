import { z } from "zod";

import { PaymentMethod } from "@/generated/prisma/enums";
import { moneyString, optionalText } from "@/lib/validators/common";

const positiveAmount = moneyString.refine((v) => Number(v) > 0, "Enter an amount above zero");

/** Staff recording a customer repayment against an invoice (any branch may collect). */
export const recordPaymentSchema = z.object({
  invoiceId: z.guid(),
  amount: positiveAmount,
  method: z.enum(PaymentMethod),
  reference: optionalText(80),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const reversePaymentSchema = z.object({
  paymentId: z.guid(),
  reason: z.string().trim().min(5, "Say why the payment is being reversed").max(300),
});
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;

/** Owner forgiving part or all of a customer's remaining balance. */
export const waiveDebtSchema = z.object({
  invoiceId: z.guid(),
  amount: positiveAmount,
  reason: z.string().trim().min(5, "Say why the debt is being waived").max(300),
});
export type WaiveDebtInput = z.infer<typeof waiveDebtSchema>;

export const planRemindersSchema = z.object({ invoiceId: z.guid(), enabled: z.boolean() });

/** Owner paying a supplier against one purchase order. */
export const supplierPayoutSchema = z.object({
  purchaseOrderId: z.guid(),
  amount: positiveAmount,
  method: z.enum(PaymentMethod),
  reference: optionalText(80),
  notes: optionalText(300),
});
export type SupplierPayoutInput = z.infer<typeof supplierPayoutSchema>;

export const customerPreferencesSchema = z.object({
  customerId: z.guid(),
  whatsappOptIn: z.boolean(),
  smsOptIn: z.boolean(),
  notes: optionalText(2000),
});
export type CustomerPreferencesInput = z.infer<typeof customerPreferencesSchema>;

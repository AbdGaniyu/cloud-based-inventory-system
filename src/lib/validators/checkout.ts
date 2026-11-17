import { z } from "zod";

import { InstallmentFrequency, PaymentMethod, UnitCondition } from "@/generated/prisma/enums";
import { calendarDateString, moneyString, optionalMoneyString, optionalText } from "@/lib/validators/common";

/** One schema for the POS screen and the checkout server action (CLAUDE.md §13). Prices are never sent: the server reads them. */

export const MAX_INSTALLMENTS = 24;

const paymentRow = z.object({
  method: z.enum(PaymentMethod),
  amount: moneyString,
  reference: optionalText(80),
});
export type PaymentRowInput = z.input<typeof paymentRow>;

export const cartLineSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unit"), unitId: z.guid(), discount: optionalMoneyString }),
  z.object({
    kind: z.literal("accessory"),
    productId: z.guid(),
    quantity: z.number().int().min(1, "At least 1").max(1000),
    discount: optionalMoneyString,
  }),
]);

export const tradeInSchema = z
  .object({
    description: z.string().trim().min(3, "Describe the device").max(160),
    identifier: optionalText(40),
    condition: z.enum(UnitCondition),
    creditAmount: moneyString,
    /** Book the device into stock as TRADED_IN so it can be inspected and resold. */
    addToStock: z.boolean(),
    productId: z.guid().optional(),
  })
  .refine((t) => !t.addToStock || (t.productId && t.identifier), {
    message: "Choose the model and scan its IMEI/serial to add it to stock",
    path: ["productId"],
  });
export type TradeInInput = z.infer<typeof tradeInSchema>;

export const checkoutSchema = z.object({
  /** Owners choose; everyone else sells at their own branch (enforced server-side). */
  branchId: z.guid().optional(),
  customerId: z.guid("Select a customer"),
  lines: z.array(cartLineSchema).min(1, "Add at least one item").max(100),
  discount: optionalMoneyString,
  tradeIn: tradeInSchema.optional(),
  /** Set when this sale replaces goods on a return (a swap). */
  swapReturnId: z.guid().optional(),
  payment: z.discriminatedUnion("type", [
    z.object({ type: z.literal("FULL"), payments: z.array(paymentRow).min(1, "Add a payment").max(6) }),
    z.object({
      type: z.literal("INSTALLMENT"),
      downPayments: z.array(paymentRow).max(6),
      numberOfInstallments: z.number().int().min(1).max(MAX_INSTALLMENTS),
      frequency: z.enum(InstallmentFrequency),
      firstDueDate: calendarDateString,
      guarantorName: optionalText(120),
      guarantorPhone: optionalText(30),
      idVerificationNotes: optionalText(500),
      /** A manager's or the owner's sign-in, when a cashier sells a plan that needs approval. */
      approver: z.object({ email: z.email().trim().toLowerCase(), password: z.string().min(1).max(200) }).optional(),
    }),
  ]),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CheckoutFormValues = z.input<typeof checkoutSchema>;

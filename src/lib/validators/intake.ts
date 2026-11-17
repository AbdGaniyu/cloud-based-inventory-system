import { z } from "zod";

import { PaymentMethod, type PaymentTerms, UnitCondition } from "@/generated/prisma/enums";
import { addDays, type CalendarDate } from "@/lib/dates";
import { type Money, money, sum } from "@/lib/money";
import { calendarDateString, moneyString, optionalMoneyString, optionalText } from "@/lib/validators/common";

/** One shared schema for the intake form (client) and the intake server action (CLAUDE.md §13). */

export const NET_DAYS = [7, 15, 30] as const;
export type NetDays = (typeof NET_DAYS)[number];
const netDays = z.union([z.literal(7), z.literal(15), z.literal(30)]);

export const intakeUnitSchema = z.object({
  identifier: z.string().trim().min(1, "Scan or type an IMEI or serial"),
  condition: z.enum(UnitCondition),
  color: optionalText(40),
  storage: optionalText(20),
  ram: optionalText(20),
  batteryHealth: z.number().int().min(0, "0–100").max(100, "0–100").nullable().optional(),
  costPrice: moneyString,
  sellingPrice: moneyString,
});

export const serializedLineSchema = z.object({
  productId: z.guid(),
  units: z.array(intakeUnitSchema).min(1, "Add at least one IMEI or serial").max(500, "500 units per line at most"),
});

export const accessoryLineSchema = z.object({
  productId: z.guid(),
  quantity: z.number().int().min(1, "At least 1").max(100_000),
  unitCost: moneyString,
  /** Owner only: updates the product's selling price. Ignored for managers. Blank = keep current price. */
  unitSellingPrice: optionalMoneyString,
});

export const intakePaymentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("PAID_IN_FULL"), method: z.enum(PaymentMethod), reference: optionalText(80) }),
  z.object({
    mode: z.literal("PARTIAL_DEPOSIT"),
    netDays,
    amountPaid: moneyString,
    method: z.enum(PaymentMethod),
    reference: optionalText(80),
  }),
  z.object({ mode: z.literal("CREDIT"), netDays }),
]);

export const intakeSchema = z
  .object({
    supplierId: z.guid("Choose a supplier"),
    /** Owners choose; managers always receive into their own branch (enforced server-side). */
    branchId: z.guid().optional(),
    supplierReference: optionalText(80),
    receivedOn: calendarDateString,
    notes: optionalText(500),
    payment: intakePaymentSchema,
    serializedLines: z.array(serializedLineSchema).max(50),
    accessoryLines: z.array(accessoryLineSchema).max(100),
  })
  .refine((v) => v.serializedLines.length + v.accessoryLines.length > 0, {
    message: "Add at least one item",
    path: ["serializedLines"],
  });

export type IntakeInput = z.infer<typeof intakeSchema>;
export type IntakeFormValues = z.input<typeof intakeSchema>;
export type IntakePayment = z.infer<typeof intakePaymentSchema>;

/** Total cost of everything on the intake. */
export function intakeTotalCost(input: {
  serializedLines: { units: { costPrice: string }[] }[];
  accessoryLines: { quantity: number; unitCost: string }[];
}): Money {
  return sum([
    ...input.serializedLines.flatMap((line) => line.units.map((u) => money(u.costPrice || "0"))),
    ...input.accessoryLines.map((line) => money(line.unitCost || "0").times(line.quantity || 0)),
  ]);
}

/** Stored payment terms and due date for an intake (dates are Lagos calendar dates). */
export function intakeTerms(
  payment: IntakePayment,
  receivedOn: CalendarDate,
): { paymentTerms: PaymentTerms; dueDate: CalendarDate | null } {
  switch (payment.mode) {
    case "PAID_IN_FULL":
      return { paymentTerms: "PAID_IN_FULL", dueDate: null };
    case "PARTIAL_DEPOSIT":
      return { paymentTerms: "PARTIAL_DEPOSIT", dueDate: addDays(receivedOn, payment.netDays) };
    case "CREDIT":
      return { paymentTerms: `NET_${payment.netDays}`, dueDate: addDays(receivedOn, payment.netDays) };
  }
}

/** Amount paid to the supplier at intake. */
export function intakeAmountPaid(payment: IntakePayment, totalCost: Money): Money {
  switch (payment.mode) {
    case "PAID_IN_FULL":
      return totalCost;
    case "PARTIAL_DEPOSIT":
      return money(payment.amountPaid);
    case "CREDIT":
      return money(0);
  }
}

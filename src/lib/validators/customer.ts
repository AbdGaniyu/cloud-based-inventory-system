import { z } from "zod";

import { normalizePhone } from "@/lib/phone";
import { optionalText } from "@/lib/validators/common";

/** Inline "new customer" at the POS: name and phone minimum (CLAUDE.md §7.4). */
export const quickCustomerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name").max(120),
  phone: z
    .string()
    .trim()
    .min(1, "Enter a phone number")
    .refine((value) => normalizePhone(value) !== null, "Enter a valid phone number, e.g. 0803 123 4567"),
  email: z
    .union([z.literal(""), z.email("Enter a valid email")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  whatsappOptIn: z.boolean(),
  smsOptIn: z.boolean(),
  notes: optionalText(500),
  /** NDPA: staff confirm the customer was told how their details are used (see /privacy). */
  noticeGiven: z.boolean().refine((v) => v, "Tell the customer how we use their details, then tick this"),
});

export type QuickCustomerInput = z.infer<typeof quickCustomerSchema>;
export type QuickCustomerFormValues = z.input<typeof quickCustomerSchema>;

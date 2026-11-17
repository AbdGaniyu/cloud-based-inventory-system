import { z } from "zod";

import { optionalText } from "@/lib/validators/common";

export const quickSupplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier's name").max(120),
  phone: optionalText(30),
  contactPerson: optionalText(80),
});

export type QuickSupplierInput = z.infer<typeof quickSupplierSchema>;
export type QuickSupplierFormValues = z.input<typeof quickSupplierSchema>;

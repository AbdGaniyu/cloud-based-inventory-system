import { z } from "zod";

export const voidInvoiceSchema = z.object({
  invoiceId: z.guid(),
  reason: z.string().trim().min(5, "Say why, in a few words (at least 5 characters)").max(300),
});
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

import { z } from "zod";

import { optionalText } from "@/lib/validators/common";

/** Methods staff can refund with. */
export const REFUND_METHODS = ["CASH", "BANK_TRANSFER", "POS_CARD"] as const;

export const returnSchema = z.object({
  invoiceId: z.guid(),
  /** Owner in "All branches" view picks the branch that physically received the goods. */
  branchId: z.guid().optional(),
  reason: z.string().trim().min(5, "Say why the goods came back").max(500),
  lines: z
    .array(
      z.object({
        invoiceItemId: z.guid(),
        quantity: z.number().int().min(1).max(10_000),
        disposition: z.enum(["RESTOCK", "DEFECTIVE"]),
      }),
    )
    .min(1, "Choose at least one item")
    .max(100),
  refundMethod: z.enum(REFUND_METHODS),
  refundReference: optionalText(80),
});
export type ReturnInput = z.infer<typeof returnSchema>;

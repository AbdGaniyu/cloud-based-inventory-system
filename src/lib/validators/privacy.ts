import { z } from "zod";

export const eraseCustomerSchema = z.object({
  customerId: z.guid(),
  reason: z.string().trim().min(5, "Say who asked and how (at least 5 characters)").max(300),
});
export type EraseCustomerInput = z.infer<typeof eraseCustomerSchema>;

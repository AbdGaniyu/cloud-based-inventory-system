import { z } from "zod";

import { moneyString } from "@/lib/validators/common";

const optionalMoney = z.preprocess((v) => (v === "" || v === null ? undefined : v), moneyString.optional());

export const submitCashUpSchema = z.object({
  /** Cash put in the drawer at the start (change float). */
  openingFloat: moneyString,
  /** Everything in the drawer now, float included. */
  countedCash: moneyString,
  /** POS terminal batch / settlement total, if checked. */
  countedCard: optionalMoney,
  /** Transfers confirmed on the bank app, if checked. */
  countedTransfer: optionalMoney,
  note: z.string().trim().max(500).optional(),
});
export type SubmitCashUpInput = z.infer<typeof submitCashUpSchema>;

export const reviewCashUpSchema = z.object({
  id: z.guid(),
  note: z.string().trim().max(500).optional(),
});
export type ReviewCashUpInput = z.infer<typeof reviewCashUpSchema>;

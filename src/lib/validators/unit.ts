import { z } from "zod";

import { UnitCondition } from "@/generated/prisma/enums";
import { moneyString } from "@/lib/validators/common";

/** Owner inspects a traded-in device and releases it for sale. */
export const acceptTradeInSchema = z.object({
  unitId: z.guid(),
  condition: z.enum(UnitCondition),
  batteryHealth: z.number().int().min(0).max(100).nullable(),
  sellingPrice: moneyString.refine((v) => Number(v) > 0, "Set a selling price"),
});

export type AcceptTradeInInput = z.infer<typeof acceptTradeInSchema>;

import { z } from "zod";

import { optionalText } from "@/lib/validators/common";

export const createTransferSchema = z
  .object({
    /** Owners choose; managers always ship from their own branch (enforced server-side). */
    fromBranchId: z.guid().optional(),
    toBranchId: z.guid("Choose the destination branch"),
    driverName: optionalText(80),
    notes: optionalText(500),
    unitIds: z.array(z.guid()).max(500, "500 devices per transfer at most"),
    accessories: z
      .array(z.object({ productId: z.guid(), quantity: z.number().int().min(1, "At least 1").max(100_000) }))
      .max(200),
  })
  .refine((v) => v.unitIds.length + v.accessories.length > 0, { message: "Add at least one item", path: ["unitIds"] });

export type CreateTransferInput = z.infer<typeof createTransferSchema>;

export const shipTransferSchema = z.object({ transferId: z.guid(), driverName: optionalText(80) });
export type ShipTransferInput = z.infer<typeof shipTransferSchema>;

export const receiveTransferSchema = z.object({
  transferId: z.guid(),
  items: z
    .array(z.object({ itemId: z.guid(), receivedQuantity: z.number().int().min(0), note: optionalText(200) }))
    .min(1),
});
export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;

export const cancelTransferSchema = z.object({
  transferId: z.guid(),
  reason: z.string().trim().min(3, "Say why the transfer is cancelled").max(300),
});
export type CancelTransferInput = z.infer<typeof cancelTransferSchema>;

import { z } from "zod";

const REASONS = ["DAMAGED", "LOST", "STOLEN", "FOUND", "REPAIRED", "COUNT_CORRECTION", "OTHER"] as const;
const note = z.string().trim().max(300).optional();

export const accessoryAdjustmentSchema = z
  .object({
    branchId: z.guid(),
    productId: z.guid(),
    /** "change": add or remove this many (negative removes); "set": the shelf now holds exactly this many. */
    mode: z.enum(["change", "set"]),
    quantity: z.coerce.number().int("Whole numbers only").min(-100000).max(100000),
    reason: z.enum(REASONS),
    note,
  })
  .refine((v) => v.mode === "change" || v.quantity >= 0, { path: ["quantity"], message: "A count can't be below zero" })
  .refine((v) => v.mode === "set" || v.quantity !== 0, { path: ["quantity"], message: "Enter how many to add or remove" })
  .refine((v) => v.reason !== "OTHER" || (v.note ?? "").length >= 3, { path: ["note"], message: "Say what happened" });
export type AccessoryAdjustmentInput = z.infer<typeof accessoryAdjustmentSchema>;

export const unitAdjustmentSchema = z
  .object({
    unitId: z.guid(),
    toStatus: z.enum(["IN_STOCK", "DEFECTIVE", "WRITTEN_OFF"]),
    reason: z.enum(REASONS),
    note,
  })
  .refine((v) => v.reason !== "OTHER" || (v.note ?? "").length >= 3, { path: ["note"], message: "Say what happened" });
export type UnitAdjustmentInput = z.infer<typeof unitAdjustmentSchema>;

export const stockCountSchema = z.object({
  branchId: z.guid(),
  /**
   * Only the lines that were actually counted; uncounted lines are left alone. `expected` is what the
   * count sheet showed when counting started, so a sale or delivery during the count is caught.
   */
  accessories: z
    .array(z.object({ productId: z.guid(), expected: z.coerce.number().int().min(0), counted: z.coerce.number().int().min(0).max(1000000) }))
    .max(5000),
  /** Every IMEI/serial scanned on the shelf. */
  scanned: z.array(z.string().max(64)).max(20000),
  /** The devices the count sheet listed when counting started (only these can be missing). */
  sheetUnitIds: z.array(z.guid()).max(20000),
  /** Whether devices were counted at all; when false, no device is treated as missing. */
  countDevices: z.boolean(),
  note,
});
export type StockCountInput = z.infer<typeof stockCountSchema>;

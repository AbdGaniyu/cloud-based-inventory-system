import type { StockAdjustmentReason, UnitStatus } from "@/generated/prisma/enums";

/** Shared by the adjustment service (enforcement) and the inventory screens (choices offered). */

export const REASON_LABELS: Record<StockAdjustmentReason, string> = {
  DAMAGED: "Damaged",
  LOST: "Lost",
  STOLEN: "Stolen",
  FOUND: "Found",
  REPAIRED: "Repaired",
  COUNT_CORRECTION: "Stock count correction",
  OTHER: "Other (explain in the note)",
};

/** Which device status changes an adjustment may make, and the reasons that fit each. */
export const UNIT_TRANSITIONS: Partial<Record<UnitStatus, Partial<Record<UnitStatus, StockAdjustmentReason[]>>>> = {
  IN_STOCK: { DEFECTIVE: ["DAMAGED", "OTHER"], WRITTEN_OFF: ["LOST", "STOLEN", "DAMAGED", "COUNT_CORRECTION", "OTHER"] },
  DEFECTIVE: { IN_STOCK: ["REPAIRED", "OTHER"], WRITTEN_OFF: ["DAMAGED", "LOST", "STOLEN", "OTHER"] },
  RETURNED: { IN_STOCK: ["REPAIRED", "OTHER"], DEFECTIVE: ["DAMAGED", "OTHER"], WRITTEN_OFF: ["DAMAGED", "LOST", "STOLEN", "OTHER"] },
  WRITTEN_OFF: { IN_STOCK: ["FOUND", "COUNT_CORRECTION", "OTHER"], DEFECTIVE: ["FOUND", "OTHER"] },
};

export function unitTransitions(from: UnitStatus): { to: UnitStatus; reasons: StockAdjustmentReason[] }[] {
  return Object.entries(UNIT_TRANSITIONS[from] ?? {}).map(([to, reasons]) => ({ to: to as UnitStatus, reasons: reasons ?? [] }));
}

/** Reasons offered for an accessory adjustment, by direction. */
export const ACCESSORY_REASONS = {
  remove: ["DAMAGED", "LOST", "STOLEN", "COUNT_CORRECTION", "OTHER"],
  add: ["FOUND", "REPAIRED", "COUNT_CORRECTION", "OTHER"],
} as const satisfies Record<string, readonly StockAdjustmentReason[]>;

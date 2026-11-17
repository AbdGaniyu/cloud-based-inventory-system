import { can, type Ctx } from "@/server/auth/permissions";

/**
 * Invariant 9: cost data never reaches a non-owner's browser. Services pass every row that
 * carries cost, margin or supplier-balance fields through stripCostFields before returning it;
 * hiding columns in the UI is not enough.
 */
export type Visible<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export function canSeeCost(ctx: Ctx): boolean {
  return can(ctx, "cost.view");
}

export function stripCostFields<T extends object, K extends keyof T>(ctx: Ctx, row: T, keys: readonly K[]): Visible<T, K> {
  if (canSeeCost(ctx)) return row;
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

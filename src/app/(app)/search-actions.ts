"use server";

import { z } from "zod";

import { type ActionResult, runAction } from "@/server/action-result";
import { assertCan } from "@/server/auth/permissions";
import { requireActionSession } from "@/server/auth/session";
import { searchStock, type StockSearchResult } from "@/server/services/inventory.service";

const querySchema = z.string().trim().max(100);

/** Command palette lookup. Invoice and phone search join when those screens land (steps 6 and 8). */
export async function paletteSearch(input: unknown): Promise<ActionResult<StockSearchResult>> {
  return runAction(async () => {
    const query = querySchema.parse(input);
    const ctx = await requireActionSession();
    assertCan(ctx, "inventory.view");
    return searchStock(ctx, query);
  });
}

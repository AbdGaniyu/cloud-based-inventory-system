import "server-only";

import type { z } from "zod";

import { db } from "@/server/db";

/** Reads a non-secret setting, falling back when it is missing or malformed. */
export async function getSetting<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key }, select: { value: true, isSecret: true } });
  if (!row || row.isSecret) return fallback;
  const parsed = schema.safeParse(row.value);
  return parsed.success ? parsed.data : fallback;
}

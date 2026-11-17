import type { z } from "zod";

import { ValidationError } from "@/server/errors";

/** Validates server action input with the shared Zod schema; issues become field errors. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
  throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the details and try again.", fieldErrors);
}

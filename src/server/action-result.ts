import { unstable_rethrow } from "next/navigation";

import { AppError } from "@/server/errors";

/** Shape every server action returns (CLAUDE.md §13). */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const UNEXPECTED_ERROR = "Something went wrong. Try again, and contact the owner if it keeps happening.";

/**
 * Runs an action body and converts domain errors to `{ ok: false }`. Next.js control-flow errors
 * (redirect, notFound) are re-thrown; unexpected errors are logged and hidden from the client.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    console.error(error);
    return { ok: false, error: UNEXPECTED_ERROR };
  }
}

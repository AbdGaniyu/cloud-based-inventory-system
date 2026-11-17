import "server-only";

import { db } from "@/server/db";
import { sendOpsAlert } from "@/server/ops/alerts";
import { logEvent } from "@/server/ops/log";

/**
 * Records an unexpected server error: a JSON log line, an ErrorEvent row (no cookies, headers or
 * query strings, which can carry signed links) and a rate-limited alert. Never throws.
 */
export type ErrorSource = "render" | "route" | "action" | "proxy" | "job" | "message";

const MESSAGE_MAX = 1000;
const STACK_MAX = 4000;

export async function reportError(error: unknown, where: { source: ErrorSource; route?: string | null }): Promise<void> {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : null;
  const route = where.route ? where.route.split("?")[0] : null;
  logEvent("error", err.message, { source: where.source, route, digest, stack: err.stack?.split("\n").slice(0, 6).join(" | ") });
  try {
    await db.errorEvent.create({
      data: { source: where.source, route, message: err.message.slice(0, MESSAGE_MAX), digest, stack: err.stack?.slice(0, STACK_MAX) ?? null },
    });
    await sendOpsAlert("server-error", "Unexpected server error", [`${where.source}${route ? ` ${route}` : ""}: ${err.message.slice(0, 200)}`]);
  } catch (storeError) {
    logEvent("error", "could not record error event", { error: storeError instanceof Error ? storeError.message : String(storeError) });
  }
}

import type { Instrumentation } from "next";

/**
 * Captures server errors Next.js handles itself (Server Component rendering, route handlers,
 * server actions that throw, the proxy) and records them like every other unexpected error.
 * Redirects and not-found are control flow, not errors, and are skipped.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";
  if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND") return;
  const { reportError } = await import("@/server/ops/errors");
  await reportError(error, { source: context.routeType, route: context.routePath || request.path });
};

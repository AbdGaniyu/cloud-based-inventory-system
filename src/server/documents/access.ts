import "server-only";

import type { Ctx } from "@/server/auth/permissions";
import { getSessionContext } from "@/server/auth/session";
import { clientIp } from "@/server/client-ip";
import { type DocumentKind, verifyDocumentSignature } from "@/server/documents/signed-url";
import { AppError } from "@/server/errors";
import { hitRateLimit } from "@/server/services/rate-limit.service";

/**
 * Who may open a document route: staff with a session (checked against the record by the caller's
 * service), or anyone holding an unexpired signed link for exactly this document.
 */
export type DocumentAccess = { via: "session"; ctx: Ctx } | { via: "signature" } | { via: "rate-limited"; retryAfterSeconds: number };

export async function resolveDocumentAccess(kind: DocumentKind, id: string, request: Request): Promise<DocumentAccess | null> {
  const params = new URL(request.url).searchParams;
  if (params.has("sig")) {
    // Public links are counted per IP (valid or not), so ids and signatures can't be ground through.
    const decision = await hitRateLimit("document", clientIp(request.headers));
    if (!decision.allowed) return { via: "rate-limited", retryAfterSeconds: decision.retryAfterSeconds };
    return verifyDocumentSignature(kind, id, { exp: params.get("exp"), sig: params.get("sig") }) ? { via: "signature" } : null;
  }
  const ctx = await getSessionContext();
  return ctx ? { via: "session", ctx } : null;
}

const STATUS_BY_CODE: Record<AppError["code"], number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  TOO_MANY_ATTEMPTS: 429,
};

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response("Too many requests. Wait a minute and try the link again.", { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
}

/** Domain errors → plain-text HTTP responses; anything else is re-thrown. */
export function documentErrorResponse(error: unknown): Response {
  if (error instanceof AppError) return new Response(error.message, { status: STATUS_BY_CODE[error.code] });
  throw error;
}

export function pdfResponse(pdf: Buffer, filename: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring links to document routes (CLAUDE.md §9: "Document links in messages are
 * signed, expiring URLs to the PDF routes"). Staff open documents with their session; customers
 * get these links in messages and QR codes.
 */
export type DocumentKind = "invoice" | "warranty";

/** How long a link in a message or on a receipt stays valid. */
export const DOCUMENT_LINK_TTL_DAYS = 180;
const SECONDS_PER_DAY = 86_400;

function secret(): string {
  const value = process.env.DOCUMENT_SIGNING_SECRET;
  if (!value) throw new Error("DOCUMENT_SIGNING_SECRET is not set");
  return value;
}

function signature(kind: DocumentKind, id: string, expiresAt: number): string {
  return createHmac("sha256", secret()).update(`${kind}:${id}:${expiresAt}`).digest("base64url");
}

/** Path with ?exp=&sig= for a document, valid for `ttlDays`. */
export function signedDocumentPath(kind: DocumentKind, id: string, options: { now?: Date; ttlDays?: number } = {}): string {
  const now = options.now ?? new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + (options.ttlDays ?? DOCUMENT_LINK_TTL_DAYS) * SECONDS_PER_DAY;
  return `/api/pdf/${kind}/${id}?exp=${expiresAt}&sig=${signature(kind, id, expiresAt)}`;
}

/** Absolute URL for messages and QR codes. */
export function signedDocumentUrl(kind: DocumentKind, id: string, options?: { now?: Date; ttlDays?: number }): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${signedDocumentPath(kind, id, options)}`;
}

/** True when the link is unexpired and its signature matches (constant-time compare). */
export function verifyDocumentSignature(
  kind: DocumentKind,
  id: string,
  params: { exp?: string | null; sig?: string | null },
  now: Date = new Date(),
): boolean {
  const expiresAt = Number(params.exp);
  if (!params.sig || !Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt < Math.floor(now.getTime() / 1000)) return false;
  const expected = Buffer.from(signature(kind, id, expiresAt));
  const given = Buffer.from(params.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const SIGNED_PATH = /\/api\/pdf\/(invoice|warranty)\/([0-9a-f-]{36})(?:\?|$)/;

/** Re-signs a document link from an older message so a resend never carries an expired URL; other URLs pass through. */
export function refreshSignedUrl(url: string, options?: { now?: Date }): string {
  const match = SIGNED_PATH.exec(url);
  if (!match) return url;
  return signedDocumentUrl(match[1] as DocumentKind, match[2], options);
}

/** Public warranty check page (no signature: it shows no personal data). */
export function publicWarrantyUrl(publicId: string): string {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/w/${publicId}`;
}

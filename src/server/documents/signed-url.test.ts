import { beforeAll, describe, expect, it } from "vitest";

import { signedDocumentPath, verifyDocumentSignature } from "@/server/documents/signed-url";

const NOW = new Date("2026-11-17T10:00:00Z");
const params = (path: string) => Object.fromEntries(new URL(path, "http://x").searchParams);

describe("signed document links", () => {
  beforeAll(() => {
    process.env.DOCUMENT_SIGNING_SECRET = "test-secret";
  });

  it("verifies a fresh link for the same document", () => {
    const path = signedDocumentPath("invoice", "inv-1", { now: NOW, ttlDays: 1 });
    expect(path).toMatch(/^\/api\/pdf\/invoice\/inv-1\?exp=\d+&sig=[\w-]+$/);
    expect(verifyDocumentSignature("invoice", "inv-1", params(path), NOW)).toBe(true);
  });

  it("rejects expired links, other documents, other kinds and tampering", () => {
    const p = params(signedDocumentPath("invoice", "inv-1", { now: NOW, ttlDays: 1 }));
    expect(verifyDocumentSignature("invoice", "inv-1", p, new Date("2026-11-19T10:00:00Z"))).toBe(false);
    expect(verifyDocumentSignature("invoice", "inv-2", p, NOW)).toBe(false);
    expect(verifyDocumentSignature("warranty", "inv-1", p, NOW)).toBe(false);
    expect(verifyDocumentSignature("invoice", "inv-1", { ...p, exp: String(Number(p.exp) + 999999) }, NOW)).toBe(false);
    expect(verifyDocumentSignature("invoice", "inv-1", { exp: p.exp, sig: null }, NOW)).toBe(false);
  });
});

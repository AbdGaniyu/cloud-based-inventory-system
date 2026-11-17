import { describe, expect, it } from "vitest";

import { safeCallbackPath } from "@/lib/safe-redirect";

describe("safeCallbackPath", () => {
  it("keeps same-origin paths with their query", () => {
    expect(safeCallbackPath("/invoices?status=OVERDUE")).toBe("/invoices?status=OVERDUE");
  });

  it.each([
    undefined,
    "",
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/login",
    "/login?callbackUrl=/x",
    "/api/auth/signout",
  ])("falls back to the dashboard for %s", (value) => {
    expect(safeCallbackPath(value)).toBe("/dashboard");
  });

  it("uses the first value of a repeated query param", () => {
    expect(safeCallbackPath(["/pos", "https://evil.example"])).toBe("/pos");
  });
});

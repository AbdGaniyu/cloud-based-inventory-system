import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, maskSecret } from "@/server/secrets";

describe("secret settings", () => {
  it("round-trips, uses a fresh IV each time, and rejects tampering", () => {
    const a = encryptSecret("EAAG-live-token-9876");
    const b = encryptSecret("EAAG-live-token-9876");
    expect(a.iv).not.toBe(b.iv);
    expect(JSON.stringify(a)).not.toContain("live-token");
    expect(decryptSecret(a)).toBe("EAAG-live-token-9876");
    const tampered = { ...a, data: Buffer.from("x").toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("shows only the last four characters", () => {
    expect(maskSecret("EAAG-live-token-9876")).toBe("••••9876");
    expect(maskSecret("abc")).toBe("••••");
  });
});

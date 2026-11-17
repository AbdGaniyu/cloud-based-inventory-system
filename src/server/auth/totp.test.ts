import { describe, expect, it } from "vitest";

import { base32Decode, base32Encode, generateTotpSecret, normalizeRecoveryCode, otpauthUri, totpAt, verifyTotp } from "@/server/auth/totp";

// RFC 6238 appendix B, SHA-1 key "12345678901234567890" (last 6 of the 8-digit values).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const at = (seconds: number) => new Date(seconds * 1000);

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(totpAt(RFC_SECRET, at(59))).toBe("287082");
    expect(totpAt(RFC_SECRET, at(1111111109))).toBe("081804");
    expect(totpAt(RFC_SECRET, at(1234567890))).toBe("005924");
    expect(totpAt(RFC_SECRET, at(2000000000))).toBe("279037");
  });

  it("round-trips base32 and makes 160-bit secrets", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Decode("gezd gnbv-gy==")).toEqual(Buffer.from("123456"));
  });

  it("accepts the previous, current and next step and returns which one matched", () => {
    const now = at(1111111109); // step 37037036
    expect(verifyTotp(RFC_SECRET, "081804", now)).toBe(37037036);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at(1111111109 - 30)), now)).toBe(37037035);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at(1111111109 + 30)), now)).toBe(37037037);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at(1111111109 - 90)), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, " 081 804 ", now)).toBe(37037036);
  });

  it("refuses a step at or before the last one used (no replay)", () => {
    const now = at(1111111109);
    expect(verifyTotp(RFC_SECRET, "081804", now, 37037036)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, at(1111111109 + 30)), now, 37037036)).toBe(37037037);
  });

  it("builds an authenticator URI and normalises recovery codes", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "owner@shop.ng", issuer: "Lee Plugs" });
    expect(uri).toBe("otpauth://totp/Lee%20Plugs:owner%40shop.ng?secret=JBSWY3DPEHPK3PXP&issuer=Lee%20Plugs&algorithm=SHA1&digits=6&period=30");
    expect(normalizeRecoveryCode(" AbCdE-12345 ")).toBe("abcde12345");
    expect(normalizeRecoveryCode("123456")).toBeNull();
  });
});

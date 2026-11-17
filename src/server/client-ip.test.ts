import { describe, expect, it } from "vitest";

import { clientIp } from "@/server/client-ip";

describe("clientIp", () => {
  const xff = (value: string) => ({ "x-forwarded-for": value });

  it("ignores entries the client wrote and takes the one the trusted proxy appended", () => {
    expect(clientIp(xff("1.2.3.4, 203.0.113.9"), {})).toBe("203.0.113.9");
    expect(clientIp(xff("1.2.3.4, 198.51.100.7, 203.0.113.9"), { TRUSTED_PROXY_COUNT: "2" })).toBe("198.51.100.7");
    expect(clientIp(xff("203.0.113.9"), { TRUSTED_PROXY_COUNT: "2" })).toBeNull();
    expect(clientIp(xff("203.0.113.9"), { TRUSTED_PROXY_COUNT: "0" })).toBeNull();
    expect(clientIp({}, {})).toBeNull();
  });

  it("uses a configured edge header, or the first entry on Vercel (which rewrites the header)", () => {
    expect(clientIp({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" }, { CLIENT_IP_HEADER: "CF-Connecting-IP" })).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), { VERCEL: "1" })).toBe("203.0.113.9");
  });

  it("rejects values that are not IP addresses", () => {
    expect(clientIp(xff("1.2.3.4, <script>"), {})).toBeNull();
    expect(clientIp(xff("2001:db8::1"), {})).toBe("2001:db8::1");
  });
});

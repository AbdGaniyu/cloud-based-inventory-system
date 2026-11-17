import { describe, expect, it } from "vitest";

import { smsSegments } from "@/lib/sms";

describe("smsSegments", () => {
  it("counts GSM-7 at 160 per single part and 153 per part after that", () => {
    expect(smsSegments("a".repeat(160))).toEqual({ encoding: "GSM-7", characters: 160, segments: 1 });
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
    expect(smsSegments("a".repeat(306)).segments).toBe(2);
    expect(smsSegments("a".repeat(307)).segments).toBe(3);
  });

  it("counts extension characters twice and switches to UCS-2 for anything else", () => {
    expect(smsSegments("€".repeat(80))).toEqual({ encoding: "GSM-7", characters: 160, segments: 1 });
    expect(smsSegments("Pay ₦5,000")).toEqual({ encoding: "UCS-2", characters: 10, segments: 1 });
    expect(smsSegments("₦".repeat(71)).segments).toBe(2);
  });
});

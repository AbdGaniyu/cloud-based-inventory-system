import { describe, expect, it } from "vitest";

import { formatMoneyCompact } from "@/lib/money";

describe("formatMoneyCompact", () => {
  it("abbreviates headline figures to one decimal", () => {
    expect(formatMoneyCompact("13300000")).toBe("₦13.3M");
    expect(formatMoneyCompact("950000")).toBe("₦950K");
    expect(formatMoneyCompact("0")).toBe("₦0");
    expect(formatMoneyCompact("-2500000")).toBe("−₦2.5M");
  });
});

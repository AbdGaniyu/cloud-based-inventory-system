import { describe, expect, it } from "vitest";

import { agingBucket } from "@/lib/aging";

describe("agingBucket", () => {
  it("puts each day boundary in the right bucket", () => {
    expect([null, -3, 0, 1, 7, 8, 14, 15, 30, 31, 400].map(agingBucket)).toEqual([
      "not_due",
      "not_due",
      "not_due",
      "d1_7",
      "d1_7",
      "d8_14",
      "d8_14",
      "d15_30",
      "d15_30",
      "d30_plus",
      "d30_plus",
    ]);
  });
});

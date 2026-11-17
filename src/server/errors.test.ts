import { describe, expect, it } from "vitest";

import { NotFoundError, requireRecordId } from "@/server/errors";

describe("requireRecordId", () => {
  it("passes UUIDs through and turns anything else from a URL into not-found", () => {
    const id = "0193a6f2-7c1e-7d3a-9b2f-4e5d6c7b8a90";
    expect(requireRecordId(id)).toBe(id);
    for (const bad of ["nope", "", "1 OR 1=1", `${id}x`, "../etc/passwd"]) {
      expect(() => requireRecordId(bad, "Gone.")).toThrow(NotFoundError);
    }
  });
});

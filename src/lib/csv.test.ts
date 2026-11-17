import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines, and neutralises formulas", () => {
    expect(toCsv(["Name", "Amount"], [["Okafor, Adaeze", 1250.5], ['Said "hi"', null], ["=HYPERLINK(1)", 0], ["-5", 3]])).toBe(
      'Name,Amount\r\n"Okafor, Adaeze",1250.5\r\n"Said ""hi""",\r\n\'=HYPERLINK(1),0\r\n\'-5,3\r\n',
    );
  });
});

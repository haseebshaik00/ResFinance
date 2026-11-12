import { describe, expect, it } from "vitest";

import { formatUsd, minorUnitsToUsdInput, usdToMinorUnits } from "./money";

describe("finance money helpers", () => {
  it("parses USD without binary floating point arithmetic", () => {
    expect(usdToMinorUnits("12.34")).toBe(1234);
    expect(usdToMinorUnits("12.3")).toBe(1230);
    expect(usdToMinorUnits("12")).toBe(1200);
  });

  it("rejects invalid or zero amounts", () => {
    expect(() => usdToMinorUnits("1.234")).toThrow();
    expect(() => usdToMinorUnits("-1")).toThrow();
    expect(() => usdToMinorUnits("0")).toThrow();
  });

  it("formats positive and negative integer cents", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(-25)).toBe("-$0.25");
  });

  it("formats non-negative integer cents for an editable USD field", () => {
    expect(minorUnitsToUsdInput(123456)).toBe("1234.56");
    expect(minorUnitsToUsdInput(0)).toBe("0.00");
  });
});

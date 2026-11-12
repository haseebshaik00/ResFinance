import { describe, expect, it, vi } from "vitest";

import { TrustedActivityReporter } from "./trusted-activity";

describe("TrustedActivityReporter", () => {
  it("reports only trusted, visible user activity and throttles repeats", () => {
    let now = 10_000;
    const report = vi.fn();
    const reporter = new TrustedActivityReporter(report, {
      clock: () => now,
      minimumIntervalMs: 1_000,
    });

    expect(reporter.observe({ isTrusted: false }, true)).toBe(false);
    expect(reporter.observe({ isTrusted: true }, false)).toBe(false);
    expect(reporter.observe({ isTrusted: true }, true)).toBe(true);
    expect(reporter.observe({ isTrusted: true }, true)).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);

    now += 1_000;
    expect(reporter.observe({ isTrusted: true }, true)).toBe(true);
    expect(report).toHaveBeenCalledTimes(2);
  });
});

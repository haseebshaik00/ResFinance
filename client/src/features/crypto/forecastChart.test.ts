import { describe, expect, it } from "vitest";

import {
  buildForecastPath,
  forecastEndDate,
  formatForecastReturn,
} from "./forecastChart";

describe("forecast chart helpers", () => {
  it("keeps all 15 calendar days visible on the chart time scale", () => {
    const endDate = forecastEndDate("2026-11-10T08:00:00Z", 15);
    const path = buildForecastPath({
      startDate: "2026-11-10",
      endDate,
      startValue: 73_661,
      endpointReturn: 0.181733,
    });

    expect(endDate).toBe("2026-11-25");
    expect(path).toHaveLength(16);
    expect(path[0]).toEqual({ time: "2026-11-10", value: 73_661 });
    expect(path.at(-1)?.time).toBe("2026-11-25");
    expect(path.at(-1)?.value).toBeCloseTo(87_047.63, 2);
  });

  it("renders a zero median return as an explicit no-change forecast", () => {
    const path = buildForecastPath({
      startDate: "2026-10-14",
      endDate: "2026-10-29",
      startValue: 104,
      endpointReturn: 0,
    });

    expect(path.every((point) => point.value === 104)).toBe(true);
    expect(formatForecastReturn(0)).toBe("0.00%");
  });
});

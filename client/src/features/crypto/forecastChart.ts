const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export type ForecastPathPoint = {
  time: string;
  value: number;
};

export function forecastEndDate(
  forecastStartUtc: string,
  horizonDays: number,
): string {
  const date = new Date(forecastStartUtc);
  date.setUTCDate(date.getUTCDate() + horizonDays);
  return date.toISOString().slice(0, 10);
}

export function buildForecastPath({
  startDate,
  endDate,
  startValue,
  endpointReturn,
}: {
  startDate: string;
  endDate: string;
  startValue: number;
  endpointReturn: number;
}): ForecastPathPoint[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const dayCount = Math.round((end - start) / DAY_MILLISECONDS);
  if (dayCount <= 0) {
    throw new Error("Forecast end date must be after its start date.");
  }

  return Array.from({ length: dayCount + 1 }, (_, index) => ({
    time: new Date(start + index * DAY_MILLISECONDS).toISOString().slice(0, 10),
    value: startValue * (1 + endpointReturn * (index / dayCount)),
  }));
}

export function formatForecastDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatForecastPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatForecastReturn(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
}

export function usdToMinorUnits(value: string): number {
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (match === null) {
    throw new Error(
      "Enter a positive USD amount with no more than two decimals.",
    );
  }
  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const minorUnits = whole * 100 + Number(fraction);
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) {
    throw new Error("Amount must be greater than $0.00.");
  }
  return minorUnits;
}

export function formatUsd(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new Error("USD cents must be a safe integer.");
  }
  const sign = minorUnits < 0 ? "-" : "";
  const absolute = Math.abs(minorUnits);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
  const cents = String(absolute % 100).padStart(2, "0");
  return `${sign}$${dollars}.${cents}`;
}

export function minorUnitsToUsdInput(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new Error("USD cents must be a non-negative safe integer.");
  }
  const dollars = Math.floor(minorUnits / 100);
  const cents = String(minorUnits % 100).padStart(2, "0");
  return `${dollars}.${cents}`;
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function currentDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

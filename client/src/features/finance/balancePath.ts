import type { FinanceOverview } from "../../lib/api/client";

export interface BalancePathPoint {
  day: number;
  label: string;
  date: string;
  balance: number;
}

/**
 * Day-by-day running balance for the reporting month from non-voided
 * ledger transactions (income adds, expense subtracts).
 */
export function buildMonthBalancePath(
  overview: FinanceOverview,
): BalancePathPoint[] {
  const month = overview.summary.month;
  const dayCount = daysInMonth(month);
  const netByDay = new Map<number, number>();

  for (const entry of overview.transactions) {
    if (entry.voided || !entry.occurred_on.startsWith(month)) {
      continue;
    }
    const day = Number(entry.occurred_on.slice(8, 10));
    if (!Number.isInteger(day) || day < 1 || day > dayCount) {
      continue;
    }
    const signed =
      entry.direction === "income"
        ? entry.amount.minor_units
        : -entry.amount.minor_units;
    netByDay.set(day, (netByDay.get(day) ?? 0) + signed);
  }

  if (netByDay.size === 0) {
    return [];
  }

  const points: BalancePathPoint[] = [];
  let running = 0;
  for (let day = 1; day <= dayCount; day += 1) {
    running += netByDay.get(day) ?? 0;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    points.push({
      day,
      label: String(day),
      date,
      balance: running,
    });
  }
  return points;
}

function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}

import type { FinanceOverview } from "../../lib/api/client";

export interface BalancePathPoint {
  day: number;
  label: string;
  date: string;
  /** Running net balance after this day. */
  balance: number;
  /** Cumulative recorded income through this day. */
  incomeToDate: number;
  /** Cumulative recorded expenses through this day. */
  expenseToDate: number;
  dayIncome: number;
  dayExpense: number;
  /** Balance marker on days with income (null otherwise). */
  incomeEvent: number | null;
  /** Balance marker on days with expense (null otherwise). */
  expenseEvent: number | null;
}

/**
 * Day-by-day ledger path for the reporting month: running balance,
 * cumulative income/expense, and event markers from non-voided transactions.
 */
export function buildMonthBalancePath(
  overview: FinanceOverview,
): BalancePathPoint[] {
  const month = overview.summary.month;
  const dayCount = daysInMonth(month);
  const incomeByDay = new Map<number, number>();
  const expenseByDay = new Map<number, number>();

  for (const entry of overview.transactions) {
    if (entry.voided || !entry.occurred_on.startsWith(month)) {
      continue;
    }
    const day = Number(entry.occurred_on.slice(8, 10));
    if (!Number.isInteger(day) || day < 1 || day > dayCount) {
      continue;
    }
    if (entry.direction === "income") {
      incomeByDay.set(
        day,
        (incomeByDay.get(day) ?? 0) + entry.amount.minor_units,
      );
    } else {
      expenseByDay.set(
        day,
        (expenseByDay.get(day) ?? 0) + entry.amount.minor_units,
      );
    }
  }

  if (incomeByDay.size === 0 && expenseByDay.size === 0) {
    return [];
  }

  const points: BalancePathPoint[] = [];
  let balance = 0;
  let incomeToDate = 0;
  let expenseToDate = 0;
  for (let day = 1; day <= dayCount; day += 1) {
    const dayIncome = incomeByDay.get(day) ?? 0;
    const dayExpense = expenseByDay.get(day) ?? 0;
    incomeToDate += dayIncome;
    expenseToDate += dayExpense;
    balance += dayIncome - dayExpense;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    points.push({
      day,
      label: String(day),
      date,
      balance,
      incomeToDate,
      expenseToDate,
      dayIncome,
      dayExpense,
      incomeEvent: dayIncome > 0 ? balance : null,
      expenseEvent: dayExpense > 0 ? balance : null,
    });
  }
  return points;
}

function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}

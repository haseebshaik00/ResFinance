import type { FinanceOverview } from "../../lib/api/client";

export type SavingsBreakdownKind = "total" | "increase" | "decrease";

export interface SavingsBreakdownStep {
  name: string;
  /** Invisible stack pedestal so the visible bar floats (waterfall). */
  base: number;
  /** Visible bar height (always >= 0). */
  amount: number;
  /** Signed change for this step (equals end for totals). */
  delta: number;
  /** Running value after this step. */
  end: number;
  kind: SavingsBreakdownKind;
  fill: string;
}

type MonthlySummary = FinanceOverview["summary"];

/**
 * Build waterfall steps for finance-savings-v1:
 * income → expenses → balance → recurring/obligations → available.
 */
export function buildSavingsBreakdownSteps(
  summary: MonthlySummary,
): SavingsBreakdownStep[] {
  const income = summary.income.minor_units;
  const expense = summary.expense.minor_units;
  const balance = summary.balance.minor_units;
  const recurringIn = summary.outstanding_recurring_income.minor_units;
  const recurringOut = summary.outstanding_recurring_expense.minor_units;
  const receivable = summary.receivable.minor_units;
  const payable = summary.payable.minor_units;
  const available = summary.savings.available.minor_units;

  if (
    income === 0 &&
    expense === 0 &&
    recurringIn === 0 &&
    recurringOut === 0 &&
    receivable === 0 &&
    payable === 0
  ) {
    return [];
  }

  const steps: SavingsBreakdownStep[] = [];
  let running = 0;

  const pushTotal = (name: string, value: number, fill: string) => {
    steps.push(totalStep(name, value, fill));
    running = value;
  };

  const pushDelta = (name: string, delta: number, fill: string) => {
    const start = running;
    const end = start + delta;
    steps.push({
      name,
      base: Math.min(start, end),
      amount: Math.abs(delta),
      delta,
      end,
      kind: delta >= 0 ? "increase" : "decrease",
      fill,
    });
    running = end;
  };

  pushTotal("Income", income, "var(--income)");
  if (expense !== 0) {
    pushDelta("Expenses", -expense, "var(--expense)");
  }
  pushTotal("Balance", balance, "#2bbbad");
  running = balance;
  if (recurringIn !== 0) {
    pushDelta("Recurring in", recurringIn, "var(--income)");
  }
  if (recurringOut !== 0) {
    pushDelta("Recurring out", -recurringOut, "var(--expense)");
  }
  if (receivable !== 0) {
    pushDelta("Receivable", receivable, "var(--income)");
  }
  if (payable !== 0) {
    pushDelta("Payable", -payable, "var(--expense)");
  }
  pushTotal("Available", available, "var(--warning)");

  return steps;
}

function totalStep(
  name: string,
  value: number,
  fill: string,
): SavingsBreakdownStep {
  const low = Math.min(0, value);
  const high = Math.max(0, value);
  return {
    name,
    base: low,
    amount: high - low,
    delta: value,
    end: value,
    kind: "total",
    fill,
  };
}

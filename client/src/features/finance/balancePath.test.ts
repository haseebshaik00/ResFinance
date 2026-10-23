import { describe, expect, it } from "vitest";

import type { FinanceOverview } from "../../lib/api/client";
import { buildMonthBalancePath } from "./balancePath";

function money(minorUnits: number) {
  return { currency: "USD" as const, minor_units: minorUnits };
}

function overview(
  transactions: FinanceOverview["transactions"],
): FinanceOverview {
  return {
    summary: {
      month: "2026-10",
      income: money(500_000),
      expense: money(90_000),
      balance: money(410_000),
      receivable: money(0),
      payable: money(0),
      outstanding_recurring_income: money(0),
      outstanding_recurring_expense: money(0),
      savings: {
        actual: money(410_000),
        projected: money(410_000),
        available: money(410_000),
        formula_version: "finance-savings-v1",
        calculation_id: "path_test",
        source_event_ids: [],
      },
      budget_statuses: [],
    },
    categories: [],
    transactions,
    budgets: [],
    recurring_entries: [],
    obligations: [],
    provenance: {
      as_of_utc: "2026-10-23T00:00:00Z",
      projection_version: 1,
      source_event_ids: [],
    },
  };
}

describe("buildMonthBalancePath", () => {
  it("returns an empty path when the month has no active transactions", () => {
    expect(
      buildMonthBalancePath(
        overview([
          {
            transaction_id: "voided",
            direction: "expense",
            category_id: "groceries",
            amount: money(50_000),
            occurred_on: "2026-10-05",
            description: "voided",
            recurring_entry_id: null,
            voided: true,
            source_event_id: "evt_void",
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("builds a day-by-day running balance across the month", () => {
    const path = buildMonthBalancePath(
      overview([
        {
          transaction_id: "paycheck",
          direction: "income",
          category_id: "salary",
          amount: money(500_000),
          occurred_on: "2026-10-01",
          description: "October salary",
          recurring_entry_id: null,
          voided: false,
          source_event_id: "evt_income",
        },
        {
          transaction_id: "groceries",
          direction: "expense",
          category_id: "groceries",
          amount: money(90_000),
          occurred_on: "2026-10-10",
          description: "October groceries",
          recurring_entry_id: null,
          voided: false,
          source_event_id: "evt_expense",
        },
      ]),
    );

    expect(path).toHaveLength(31);
    expect(path[0]).toMatchObject({
      day: 1,
      date: "2026-10-01",
      balance: 500_000,
    });
    expect(path[8]?.balance).toBe(500_000);
    expect(path[9]).toMatchObject({
      day: 10,
      balance: 410_000,
    });
    expect(path.at(-1)).toMatchObject({
      day: 31,
      balance: 410_000,
    });
  });
});

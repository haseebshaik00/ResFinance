import { describe, expect, it } from "vitest";

import type { FinanceOverview } from "../../lib/api/client";
import { buildSavingsBreakdownSteps } from "./savingsBreakdown";

function money(minorUnits: number) {
  return { currency: "USD" as const, minor_units: minorUnits };
}

function summary(
  overrides: Partial<FinanceOverview["summary"]> = {},
): FinanceOverview["summary"] {
  return {
    month: "2026-10",
    income: money(500_000),
    expense: money(90_000),
    balance: money(410_000),
    receivable: money(30_000),
    payable: money(20_000),
    outstanding_recurring_income: money(0),
    outstanding_recurring_expense: money(150_000),
    savings: {
      actual: money(410_000),
      projected: money(270_000),
      available: money(270_000),
      formula_version: "finance-savings-v1",
      calculation_id: "savings_test",
      source_event_ids: ["evt_income"],
    },
    budget_statuses: [],
    ...overrides,
  };
}

describe("buildSavingsBreakdownSteps", () => {
  it("returns an empty list when the month has no ledger activity", () => {
    expect(
      buildSavingsBreakdownSteps(
        summary({
          income: money(0),
          expense: money(0),
          balance: money(0),
          receivable: money(0),
          payable: money(0),
          outstanding_recurring_income: money(0),
          outstanding_recurring_expense: money(0),
          savings: {
            actual: money(0),
            projected: money(0),
            available: money(0),
            formula_version: "finance-savings-v1",
            calculation_id: "empty",
            source_event_ids: [],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("walks finance-savings-v1 from income to available savings", () => {
    const steps = buildSavingsBreakdownSteps(summary());
    expect(steps.map((step) => step.name)).toEqual([
      "Income",
      "Expenses",
      "Balance",
      "Recurring out",
      "Receivable",
      "Payable",
      "Available",
    ]);
    expect(steps.map((step) => step.end)).toEqual([
      500_000, 410_000, 410_000, 260_000, 290_000, 270_000, 270_000,
    ]);
    expect(steps.find((step) => step.name === "Expenses")?.delta).toBe(-90_000);
    expect(steps.find((step) => step.name === "Recurring out")?.kind).toBe(
      "decrease",
    );
    expect(steps.at(-1)).toMatchObject({
      name: "Available",
      kind: "total",
      end: 270_000,
    });
  });

  it("skips zero commitment steps and keeps income and available anchors", () => {
    const steps = buildSavingsBreakdownSteps(
      summary({
        receivable: money(0),
        payable: money(0),
        outstanding_recurring_expense: money(0),
        savings: {
          actual: money(410_000),
          projected: money(410_000),
          available: money(410_000),
          formula_version: "finance-savings-v1",
          calculation_id: "simple",
          source_event_ids: ["evt_income", "evt_expense"],
        },
      }),
    );
    expect(steps.map((step) => step.name)).toEqual([
      "Income",
      "Expenses",
      "Balance",
      "Available",
    ]);
  });
});

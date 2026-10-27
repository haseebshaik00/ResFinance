import { describe, expect, it } from "vitest";

import {
  filterExpenses,
  filterObligations,
  balanceColumns,
  groupTotals,
  needsAction,
  personalBalances,
  personBalances,
  topBalances,
  obligationCounts,
  pageItems,
  type ObligationLike,
} from "./activity";

const you = `0x${"a".repeat(40)}`;
const sam = `0x${"b".repeat(40)}`;
const priya = `0x${"c".repeat(40)}`;

function obligation(
  id: string,
  debtor: string,
  creditor: string,
  status: ObligationLike["status"],
  outstanding: number,
) {
  return {
    id,
    debtor_address: debtor,
    creditor_address: creditor,
    status,
    outstanding_amount: { minor_units: outstanding },
  };
}

const obligations = [
  obligation("pending-you", you, sam, "pending", 3000),
  obligation("open-you", you, priya, "open", 2000),
  obligation("partial-sam", sam, you, "partially_settled", 1500),
  obligation("settled-priya", priya, you, "settled", 0),
  obligation("rejected-sam", sam, you, "rejected", 4000),
];

describe("group activity", () => {
  it("needs your action only when you owe an unresolved obligation", () => {
    expect(needsAction(obligations[0]!, you)).toBe(true);
    expect(needsAction(obligations[1]!, you.toUpperCase())).toBe(true);
    expect(needsAction(obligations[2]!, you)).toBe(false);
    expect(needsAction(obligations[3]!, priya)).toBe(false);
  });

  it("filters obligations and counts every filter", () => {
    const ids = (filter: Parameters<typeof filterObligations>[1]) =>
      filterObligations(obligations, filter, you).map((item) => item.id);
    expect(ids("action")).toEqual(["pending-you", "open-you"]);
    expect(ids("open")).toEqual(["pending-you", "open-you", "partial-sam"]);
    expect(ids("settled")).toEqual(["settled-priya"]);
    expect(ids("all")).toHaveLength(5);
    expect(obligationCounts(obligations, you)).toEqual({
      action: 2,
      open: 3,
      settled: 1,
      all: 5,
    });
  });

  it("filters expenses paid by you", () => {
    const expenses = [
      { id: "dinner", payer_address: you.toUpperCase() },
      { id: "taxi", payer_address: sam },
    ];
    expect(
      filterExpenses(expenses, "mine", you).map((item) => item.id),
    ).toEqual(["dinner"]);
    expect(filterExpenses(expenses, "all", you)).toHaveLength(2);
  });

  it("pages items and reports how many remain", () => {
    const items = Array.from({ length: 14 }, (_, index) => index);
    expect(pageItems(items, 6)).toEqual({
      items: [0, 1, 2, 3, 4, 5],
      remaining: 8,
    });
    expect(pageItems(items, 12).remaining).toBe(2);
    expect(pageItems(items, 18)).toEqual({ items, remaining: 0 });
    expect(pageItems([], 6)).toEqual({ items: [], remaining: 0 });
  });

  it("sums outstanding balances with each other person", () => {
    expect(personBalances(obligations, you)).toEqual([
      { address: priya, oweMinorUnits: 2000, owedMinorUnits: 0 },
      { address: sam, oweMinorUnits: 0, owedMinorUnits: 1500 },
    ]);
    expect(personBalances([], you)).toEqual([]);
  });

  it("nets what you owe a person across groups into one balance", () => {
    const combined = [
      ...obligations,
      obligation("other-group-you-owe-sam", you, sam, "open", 500),
    ];
    expect(personalBalances(combined, you)).toEqual([
      { address: priya, oweMinorUnits: 2000, owedMinorUnits: 0 },
      { address: sam, oweMinorUnits: 0, owedMinorUnits: 1000 },
    ]);
  });

  it("ranks each direction and keeps the largest four on the card", () => {
    const columns = balanceColumns([
      { name: "Sam", oweMinorUnits: 2000, owedMinorUnits: 0 },
      { name: "Priya", oweMinorUnits: 500, owedMinorUnits: 4000 },
      { name: "Maya", oweMinorUnits: 0, owedMinorUnits: 1000 },
    ]);
    expect(columns.owed.map((row) => row.name)).toEqual(["Priya", "Maya"]);
    expect(columns.owe.map((row) => row.name)).toEqual(["Sam", "Priya"]);
    const many = Array.from({ length: 6 }, (_, index) => index);
    expect(topBalances(many).visible).toEqual([0, 1, 2, 3]);
    expect(topBalances(many).hidden).toEqual([4, 5]);
  });

  it("totals confirmed outstanding amounts in cents for each direction", () => {
    expect(groupTotals(obligations, you)).toEqual({
      oweMinorUnits: 2000,
      owedMinorUnits: 1500,
    });
    expect(groupTotals([], you)).toEqual({
      oweMinorUnits: 0,
      owedMinorUnits: 0,
    });
  });
});

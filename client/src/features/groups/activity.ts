export const ACTIVITY_PAGE_SIZE = 6;

export type ObligationFilter = "action" | "open" | "settled" | "all";
export type ExpenseFilter = "all" | "mine";

export interface ObligationLike {
  creditor_address: string;
  debtor_address: string;
  status:
    | "pending"
    | "open"
    | "partially_settled"
    | "settled"
    | "rejected"
    | "cancelled";
  outstanding_amount: { minor_units: number };
}

const UNRESOLVED = new Set(["pending", "open", "partially_settled"]);
const CONFIRMED_OUTSTANDING = new Set(["open", "partially_settled"]);

export function needsAction(
  obligation: ObligationLike,
  actorAddress: string,
): boolean {
  return (
    sameAddress(obligation.debtor_address, actorAddress) &&
    UNRESOLVED.has(obligation.status)
  );
}

export function filterObligations<T extends ObligationLike>(
  obligations: readonly T[],
  filter: ObligationFilter,
  actorAddress: string,
): T[] {
  switch (filter) {
    case "action":
      return obligations.filter((item) => needsAction(item, actorAddress));
    case "open":
      return obligations.filter((item) => UNRESOLVED.has(item.status));
    case "settled":
      return obligations.filter((item) => item.status === "settled");
    case "all":
      return [...obligations];
  }
}

export function obligationCounts(
  obligations: readonly ObligationLike[],
  actorAddress: string,
): Record<ObligationFilter, number> {
  return {
    action: filterObligations(obligations, "action", actorAddress).length,
    open: filterObligations(obligations, "open", actorAddress).length,
    settled: filterObligations(obligations, "settled", actorAddress).length,
    all: obligations.length,
  };
}

export function filterExpenses<T extends { payer_address: string }>(
  expenses: readonly T[],
  filter: ExpenseFilter,
  actorAddress: string,
): T[] {
  return filter === "mine"
    ? expenses.filter((item) => sameAddress(item.payer_address, actorAddress))
    : [...expenses];
}

export function pageItems<T>(
  items: readonly T[],
  visible: number,
): { items: T[]; remaining: number } {
  const shown = items.slice(0, Math.max(0, visible));
  return { items: shown, remaining: items.length - shown.length };
}

export interface PersonBalance {
  address: string;
  oweMinorUnits: number;
  owedMinorUnits: number;
}

export interface GroupNetworkLike {
  credit_balances: Record<string, { minor_units: number }>;
  members: readonly {
    actor_address: string;
    active: boolean;
  }[];
}

export interface GroupNetworkTotals {
  connectionCount: number;
  creditMinorUnits: number;
  oweMinorUnits: number;
  owedMinorUnits: number;
}

export function personBalances(
  obligations: readonly ObligationLike[],
  actorAddress: string,
): PersonBalance[] {
  const totals = new Map<string, PersonBalance>();
  for (const item of obligations) {
    if (!CONFIRMED_OUTSTANDING.has(item.status)) continue;
    const youOwe = sameAddress(item.debtor_address, actorAddress);
    const youAreOwed = sameAddress(item.creditor_address, actorAddress);
    if (!youOwe && !youAreOwed) continue;
    const other = youOwe ? item.creditor_address : item.debtor_address;
    const key = other.toLowerCase();
    const current = totals.get(key) ?? {
      address: other,
      oweMinorUnits: 0,
      owedMinorUnits: 0,
    };
    if (youOwe) current.oweMinorUnits += item.outstanding_amount.minor_units;
    else current.owedMinorUnits += item.outstanding_amount.minor_units;
    totals.set(key, current);
  }
  return [...totals.values()]
    .filter((item) => item.oweMinorUnits > 0 || item.owedMinorUnits > 0)
    .sort(byLargestBalance);
}

/** One net amount per person, combined across every group. */
export function personalBalances(
  obligations: readonly ObligationLike[],
  actorAddress: string,
): PersonBalance[] {
  return personBalances(obligations, actorAddress)
    .map((row) => {
      const net = row.owedMinorUnits - row.oweMinorUnits;
      return net >= 0
        ? { ...row, owedMinorUnits: net, oweMinorUnits: 0 }
        : { ...row, oweMinorUnits: -net, owedMinorUnits: 0 };
    })
    .filter((row) => row.oweMinorUnits > 0 || row.owedMinorUnits > 0)
    .sort(byLargestBalance);
}

/**
 * Summary values for the signed-in person's network across every group.
 * Balances are first netted by person, so the directional totals are the
 * effective amount owed or receivable rather than gross obligations.
 */
export function groupNetworkTotals(
  groups: readonly GroupNetworkLike[],
  obligations: readonly ObligationLike[],
  actorAddress: string,
): GroupNetworkTotals {
  const actor = actorAddress.toLowerCase();
  const connections = new Set<string>();
  let creditMinorUnits = 0;

  for (const group of groups) {
    const actorCredits = Object.entries(group.credit_balances).find(
      ([address]) => address.toLowerCase() === actor,
    )?.[1];
    creditMinorUnits += actorCredits?.minor_units ?? 0;

    for (const member of group.members) {
      if (member.active && member.actor_address.toLowerCase() !== actor)
        connections.add(member.actor_address.toLowerCase());
    }
  }

  return personalBalances(obligations, actorAddress).reduce<GroupNetworkTotals>(
    (totals, row) => ({
      ...totals,
      oweMinorUnits: totals.oweMinorUnits + row.oweMinorUnits,
      owedMinorUnits: totals.owedMinorUnits + row.owedMinorUnits,
    }),
    {
      connectionCount: connections.size,
      creditMinorUnits,
      oweMinorUnits: 0,
      owedMinorUnits: 0,
    },
  );
}

function byLargestBalance(left: PersonBalance, right: PersonBalance): number {
  const leftTotal = left.oweMinorUnits + left.owedMinorUnits;
  const rightTotal = right.oweMinorUnits + right.owedMinorUnits;
  return rightTotal - leftTotal || left.address.localeCompare(right.address);
}

export const VISIBLE_BALANCE_ROWS = 4;

export interface NamedBalance {
  name: string;
  oweMinorUnits: number;
  owedMinorUnits: number;
}

export interface BalanceAmount {
  name: string;
  minorUnits: number;
}

export function balanceColumns(rows: readonly NamedBalance[]): {
  owed: BalanceAmount[];
  owe: BalanceAmount[];
} {
  const rank = (amount: (row: NamedBalance) => number): BalanceAmount[] =>
    rows
      .map((row) => ({ name: row.name, minorUnits: amount(row) }))
      .filter((row) => row.minorUnits > 0)
      .sort(
        (left, right) =>
          right.minorUnits - left.minorUnits ||
          left.name.localeCompare(right.name),
      );
  return {
    owed: rank((row) => row.owedMinorUnits),
    owe: rank((row) => row.oweMinorUnits),
  };
}

export function topBalances<T>(
  items: readonly T[],
  limit = VISIBLE_BALANCE_ROWS,
): { visible: T[]; hidden: T[] } {
  return { visible: items.slice(0, limit), hidden: items.slice(limit) };
}

export function groupTotals(
  obligations: readonly ObligationLike[],
  actorAddress: string,
): { oweMinorUnits: number; owedMinorUnits: number } {
  let oweMinorUnits = 0;
  let owedMinorUnits = 0;
  for (const item of obligations) {
    if (!CONFIRMED_OUTSTANDING.has(item.status)) continue;
    if (sameAddress(item.debtor_address, actorAddress))
      oweMinorUnits += item.outstanding_amount.minor_units;
    else if (sameAddress(item.creditor_address, actorAddress))
      owedMinorUnits += item.outstanding_amount.minor_units;
  }
  return { oweMinorUnits, owedMinorUnits };
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

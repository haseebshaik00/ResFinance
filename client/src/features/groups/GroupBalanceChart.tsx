import { formatUsd } from "../finance/money";
import { Plus, X } from "lucide-react";
import { groupNetworkTotals, personalBalances } from "./activity";
import type { GroupOverview } from "./groupActions";
import {
  memberDisplayName,
  shortAddress,
  type GroupMemberLike,
} from "./members";

export function GroupBalanceChart({
  actorAddress,
  obligations,
  members,
  groups,
  overviews,
  loading,
  creating,
  createPanelId,
  onCreateToggle,
}: {
  actorAddress: string;
  obligations: GroupOverview["obligations"];
  members: readonly GroupMemberLike[];
  groups: readonly { group_id: string }[];
  overviews: readonly GroupOverview[];
  loading: boolean;
  creating: boolean;
  createPanelId: string;
  onCreateToggle: () => void;
}) {
  const balances = personalBalances(obligations, actorAddress).map((row) => {
    const youOwe = row.oweMinorUnits > 0;
    return {
      address: row.address,
      name:
        memberDisplayName(members, row.address) ?? shortAddress(row.address),
      direction: youOwe ? "owe" : "owed",
      minorUnits: youOwe ? row.oweMinorUnits : row.owedMinorUnits,
    };
  });
  const totals = groupNetworkTotals(overviews, obligations, actorAddress);
  const overviewIsComplete = overviews.length === groups.length;
  const largestBalance = balances[0]?.minorUnits ?? 1;

  return (
    <section
      className="panel group-network"
      aria-labelledby="group-balance-title"
      aria-busy={loading && !overviewIsComplete}
    >
      <div className="group-network-summary">
        <div className="group-network-heading">
          <p className="section-kicker">Across every group</p>
          <h2 id="group-balance-title">Your Groups Network!</h2>
        </div>
        <div className="group-network-metrics" aria-label="Network summary">
          <article className="network-metric network-metric-groups">
            <div className="network-metric-primary">
              <p>Group network</p>
              <strong>
                {groups.length} {pluralize(groups.length, "group")} ·{" "}
                {overviewIsComplete ? totals.connectionCount : "…"}{" "}
                {pluralize(totals.connectionCount, "connection")}
              </strong>
              <small>Active people across your shared groups</small>
            </div>
            <div className="network-metric-support network-metric-credits">
              <p>Funded credits</p>
              <strong>
                {overviewIsComplete ? formatUsd(totals.creditMinorUnits) : "…"}
              </strong>
              <small>Internal credits across your groups</small>
            </div>
          </article>
          <article className="network-metric network-metric-owe">
            <div className="network-metric-primary">
              <p>Effective payables</p>
              <strong>
                {overviewIsComplete ? formatUsd(totals.oweMinorUnits) : "…"}
              </strong>
              <small>Net amount due across your connections</small>
            </div>
            <div className="network-metric-support network-metric-owed">
              <p>Effective receivables</p>
              <strong>
                {overviewIsComplete ? formatUsd(totals.owedMinorUnits) : "…"}
              </strong>
              <small>Net amount due back to you</small>
            </div>
          </article>
        </div>
      </div>

      <section
        className="network-counterparties"
        aria-labelledby="net-balances-title"
      >
        <div className="group-network-heading">
          <p className="section-kicker">Individual people</p>
          <h2 id="net-balances-title">Net Balances</h2>
        </div>
        {!overviewIsComplete ? (
          <p className="empty-state">Loading your net balances…</p>
        ) : balances.length === 0 ? (
          <p className="empty-state">
            No outstanding balances yet. Approved obligations appear here.
          </p>
        ) : (
          <ul className="net-balance-list">
            {balances.map((balance) => (
              <li
                key={balance.address}
                className={`net-balance-row ${balance.direction}`}
                aria-label={`${balance.name}: you ${
                  balance.direction === "owe" ? "owe" : "are owed"
                } ${formatUsd(balance.minorUnits)}`}
              >
                <span className="net-balance-name">{balance.name}</span>
                <span className="net-balance-track" aria-hidden="true">
                  <span
                    className="net-balance-fill"
                    style={{
                      width: `${(balance.minorUnits / largestBalance) * 100}%`,
                    }}
                  />
                </span>
                <span className="net-balance-amount">
                  {balance.direction === "owe" ? "-" : "+"}
                  {formatUsd(balance.minorUnits)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="group-network-action">
          <button
            type="button"
            className="new-group-button"
            aria-expanded={creating}
            aria-controls={createPanelId}
            onClick={onCreateToggle}
          >
            {creating ? (
              <X aria-hidden="true" className="new-group-button-icon" />
            ) : (
              <Plus aria-hidden="true" className="new-group-button-icon" />
            )}
            <strong>{creating ? "Close" : "New Group"}</strong>
            <span>{creating ? "Hide form" : "Start a split"}</span>
          </button>
        </div>
      </section>
    </section>
  );
}

function pluralize(value: number, noun: string): string {
  return `${noun}${value === 1 ? "" : "s"}`;
}

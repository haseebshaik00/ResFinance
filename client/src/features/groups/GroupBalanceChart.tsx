import { useEffect, useId, useRef, useState } from "react";

import { formatUsd } from "../finance/money";
import {
  balanceColumns,
  personalBalances,
  topBalances,
  type BalanceAmount,
} from "./activity";
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
  loading,
}: {
  actorAddress: string;
  obligations: GroupOverview["obligations"];
  members: readonly GroupMemberLike[];
  loading: boolean;
}) {
  const rows = personalBalances(obligations, actorAddress).map((row) => ({
    name: memberDisplayName(members, row.address) ?? shortAddress(row.address),
    oweMinorUnits: row.oweMinorUnits,
    owedMinorUnits: row.owedMinorUnits,
  }));
  const columns = balanceColumns(rows);

  return (
    <section
      className="panel group-balance"
      aria-labelledby="group-balance-title"
    >
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Across every group</p>
          <h2 id="group-balance-title">Outstanding balances</h2>
        </div>
      </div>
      {rows.length === 0 ? (
        loading ? (
          <p className="empty-state">Loading balances…</p>
        ) : (
          <p className="empty-state">
            No outstanding balances yet. They appear here after an obligation is
            approved.
          </p>
        )
      ) : (
        <div className="balance-columns">
          <BalanceColumn
            title="You are owed"
            tone="owed"
            amounts={columns.owed}
          />
          <BalanceColumn title="You owe" tone="owe" amounts={columns.owe} />
        </div>
      )}
    </section>
  );
}

function BalanceColumn({
  title,
  tone,
  amounts,
}: {
  title: string;
  tone: "owed" | "owe";
  amounts: readonly BalanceAmount[];
}) {
  const { visible, hidden } = topBalances(amounts);
  const largest = visible[0]?.minorUnits ?? 1;
  const [open, setOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!overflowRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <section className="balance-column" aria-label={title}>
      <h3>
        <span className={`balance-swatch ${tone}`} />
        {title}
      </h3>
      {visible.length === 0 ? (
        <p className="balance-empty">Nothing here.</p>
      ) : (
        <ul>
          {visible.map((row) => (
            <li key={row.name}>
              <span className="balance-name">{row.name}</span>
              <span className="balance-track" aria-hidden="true">
                <span
                  className={`balance-fill ${tone}`}
                  style={{ width: `${(row.minorUnits / largest) * 100}%` }}
                />
              </span>
              <span className="balance-amount">
                {formatUsd(row.minorUnits)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hidden.length > 0 && (
        <div className="share-overflow" ref={overflowRef}>
          <button
            type="button"
            className="share-more"
            aria-expanded={open}
            aria-controls={popoverId}
            onClick={() => setOpen((current) => !current)}
          >
            {hidden.length} more
          </button>
          {open && (
            <div
              id={popoverId}
              className="share-popover balance-more"
              role="dialog"
              aria-label={`More people you ${tone === "owed" ? "are owed" : "owe"}`}
            >
              <ul>
                {hidden.map((row) => (
                  <li key={row.name}>
                    <span>{row.name}</span>
                    <span>{formatUsd(row.minorUnits)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

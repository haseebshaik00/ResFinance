import { useId, useRef, useState, type KeyboardEvent } from "react";

import {
  ACTIVITY_PAGE_SIZE,
  filterExpenses,
  filterObligations,
  obligationCounts,
  pageItems,
  type ExpenseFilter,
  type ObligationFilter,
} from "./activity";
import { ActionFeedback } from "./ActionFeedback";
import { ExpenseList, newestFirst } from "./ExpensesPanel";
import type { Dashboard, GroupOverview } from "./groupActions";
import { ObligationsList } from "./ObligationsList";
import { useGroupAction, type GroupAction } from "./useGroupAction";

type ActivityTab = "obligations" | "expenses" | "notifications";

const TABS: readonly { id: ActivityTab; label: string }[] = [
  { id: "obligations", label: "Obligations" },
  { id: "expenses", label: "Expenses" },
  { id: "notifications", label: "Notifications" },
];

const OBLIGATION_FILTERS: readonly { id: ObligationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "action", label: "Needs your action" },
  { id: "open", label: "Open" },
  { id: "settled", label: "Settled" },
];

const EXPENSE_FILTERS: readonly { id: ExpenseFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Paid by you" },
];

export function GroupActivityTabs({
  actorAddress,
  group,
  dashboard,
}: {
  actorAddress: string;
  group: GroupOverview;
  dashboard: Dashboard;
}) {
  const baseId = useId();
  const tabRefs = useRef<Record<ActivityTab, HTMLButtonElement | null>>({
    obligations: null,
    expenses: null,
    notifications: null,
  });
  const counts = obligationCounts(group.obligations, actorAddress);
  const obligationAction = useGroupAction();
  const [tab, setTab] = useState<ActivityTab>(() =>
    counts.action > 0 ? "obligations" : "expenses",
  );
  const tabCounts: Record<ActivityTab, number> = {
    obligations: group.obligations.length,
    expenses: group.expenses.length,
    notifications: group.notifications.length,
  };

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((item) => item.id === tab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[next]!.id;
    setTab(target);
    tabRefs.current[target]?.focus();
  }

  return (
    <section
      className="panel group-activity"
      aria-labelledby={`${baseId}-title`}
    >
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Contract state &amp; history</p>
          <h2 id={`${baseId}-title`}>Group activity</h2>
        </div>
      </div>
      <div
        className="activity-tabs"
        role="tablist"
        aria-label="Group activity"
        onKeyDown={moveFocus}
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[item.id] = element;
            }}
            id={`${baseId}-tab-${item.id}`}
            className="activity-tab"
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <span className="tab-count">{tabCounts[item.id]}</span>
            {item.id === "obligations" && counts.action > 0 && (
              <span className="tab-badge">{counts.action} TODO</span>
            )}
          </button>
        ))}
      </div>
      <div
        id={`${baseId}-panel`}
        className={`activity-panel ${tab}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${tab}`}
      >
        {tab === "obligations" && (
          <ObligationsTab
            actorAddress={actorAddress}
            group={group}
            dashboard={dashboard}
            counts={counts}
            action={obligationAction}
          />
        )}
        {tab === "expenses" && (
          <ExpensesTab actorAddress={actorAddress} group={group} />
        )}
        {tab === "notifications" && <NotificationsTab group={group} />}
      </div>
    </section>
  );
}

function ObligationsTab({
  actorAddress,
  group,
  dashboard,
  counts,
  action,
}: {
  actorAddress: string;
  group: GroupOverview;
  dashboard: Dashboard;
  counts: Record<ObligationFilter, number>;
  action: GroupAction;
}) {
  const [filter, setFilter] = useState<ObligationFilter>("all");
  const [visible, setVisible] = useState(ACTIVITY_PAGE_SIZE);
  const filtered = filterObligations(group.obligations, filter, actorAddress);
  const page = pageItems(filtered, visible);
  return (
    <>
      <FilterBar
        label="Filter obligations"
        filters={OBLIGATION_FILTERS}
        counts={counts}
        selected={filter}
        shown={page.items.length}
        total={filtered.length}
        onSelect={(next) => {
          setFilter(next);
          setVisible(ACTIVITY_PAGE_SIZE);
        }}
      />
      {group.obligations.length === 0 ? (
        <p className="empty-state">
          No obligations yet. Add a shared expense to create them.
        </p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">No obligations match this filter.</p>
      ) : (
        <ObligationsList
          actorAddress={actorAddress}
          group={group}
          dashboard={dashboard}
          obligations={page.items}
          action={action}
        />
      )}
      <ShowMore
        remaining={page.remaining}
        onShowMore={() => setVisible((current) => current + ACTIVITY_PAGE_SIZE)}
      />
      <ActionFeedback action={action} />
    </>
  );
}

function ExpensesTab({
  actorAddress,
  group,
}: {
  actorAddress: string;
  group: GroupOverview;
}) {
  const [filter, setFilter] = useState<ExpenseFilter>("all");
  const [visible, setVisible] = useState(ACTIVITY_PAGE_SIZE);
  const sorted = newestFirst(group.expenses);
  const filtered = filterExpenses(sorted, filter, actorAddress);
  const page = pageItems(filtered, visible);
  const counts: Record<ExpenseFilter, number> = {
    all: sorted.length,
    mine: filterExpenses(sorted, "mine", actorAddress).length,
  };
  return (
    <>
      <FilterBar
        label="Filter expenses"
        filters={EXPENSE_FILTERS}
        counts={counts}
        selected={filter}
        shown={page.items.length}
        total={filtered.length}
        onSelect={(next) => {
          setFilter(next);
          setVisible(ACTIVITY_PAGE_SIZE);
        }}
      />
      {sorted.length === 0 ? (
        <p className="empty-state">
          No expenses yet. Open Update the group to split one with the group.
        </p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">No expenses match this filter.</p>
      ) : (
        <ExpenseList
          actorAddress={actorAddress}
          members={group.members}
          expenses={page.items}
        />
      )}
      <ShowMore
        remaining={page.remaining}
        onShowMore={() => setVisible((current) => current + ACTIVITY_PAGE_SIZE)}
      />
    </>
  );
}

function NotificationsTab({ group }: { group: GroupOverview }) {
  const [visible, setVisible] = useState(ACTIVITY_PAGE_SIZE);
  const page = pageItems(group.notifications, visible);
  return group.notifications.length === 0 ? (
    <p className="empty-state">No new group notifications.</p>
  ) : (
    <>
      <ul className="notification-list">
        {page.items.map((notice) => (
          <li key={notice.notification_id}>
            <strong>{notice.kind.replaceAll("_", " ")}</strong>
            <span>{notice.message}</span>
          </li>
        ))}
      </ul>
      <ShowMore
        remaining={page.remaining}
        onShowMore={() => setVisible((current) => current + ACTIVITY_PAGE_SIZE)}
      />
    </>
  );
}

function FilterBar<T extends string>({
  label,
  filters,
  counts,
  selected,
  shown,
  total,
  onSelect,
}: {
  label: string;
  filters: readonly { id: T; label: string }[];
  counts: Record<T, number>;
  selected: T;
  shown: number;
  total: number;
  onSelect(filter: T): void;
}) {
  return (
    <div className="activity-toolbar">
      <div className="filter-chips" role="group" aria-label={label}>
        {filters.map((item) => (
          <button
            key={item.id}
            className="filter-chip"
            type="button"
            aria-pressed={selected === item.id}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
            <span className="chip-count">{counts[item.id]}</span>
          </button>
        ))}
      </div>
      {total > 0 && (
        <p className="activity-range" aria-live="polite">
          Showing {shown} of {total}
        </p>
      )}
    </div>
  );
}

function ShowMore({
  remaining,
  onShowMore,
}: {
  remaining: number;
  onShowMore(): void;
}) {
  if (remaining <= 0) return null;
  return (
    <button
      className="secondary-button show-more-button"
      type="button"
      onClick={onShowMore}
    >
      Show {Math.min(remaining, ACTIVITY_PAGE_SIZE)} more
    </button>
  );
}

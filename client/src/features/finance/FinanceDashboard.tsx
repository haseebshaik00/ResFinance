import { ArchiveX, CircleHelp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AlwaysVisibleScroll } from "../../components/AlwaysVisibleScroll";
import type { FinanceOverview } from "../../lib/api/client";
import {
  chartTickStyle,
  chartTooltipContentStyle,
  chartTooltipCursor,
  chartTooltipItemStyle,
  chartTooltipLabelStyle,
} from "../../lib/chartTooltip";
import { FinanceEntryForms } from "./FinanceEntryForms";
import { FinanceAnalytics } from "./FinanceAnalytics";
import { currentMonth, formatUsd } from "./money";
import { useFinanceDashboard } from "./useFinanceDashboard";
import { SmartSavingsInsights } from "../insights/InsightsDashboard";

interface FinanceDashboardProps {
  accessToken: string;
}

type RecordAction =
  | {
      kind: "void-transaction";
      recordId: string;
      label: string;
    }
  | {
      kind: "deactivate-recurring";
      recordId: string;
      label: string;
    }
  | {
      kind: "deactivate-budget";
      recordId: string;
      label: string;
    };

export function FinanceDashboard({ accessToken }: FinanceDashboardProps) {
  const [month, setMonth] = useState(currentMonth());
  const [showDashboardGuide, setShowDashboardGuide] = useState(false);
  const [recordAction, setRecordAction] = useState<RecordAction | null>(null);
  const dashboard = useFinanceDashboard(accessToken, month);

  if (dashboard.overview.isPending) {
    return (
      <section className="dashboard-state" aria-live="polite" aria-busy="true">
        <span className="loading-orb" aria-hidden="true" />
        <h2>Rebuilding your finance view…</h2>
        <p>Reading and reducing encrypted events from ResilientDB.</p>
      </section>
    );
  }

  if (dashboard.overview.isError) {
    return (
      <section className="dashboard-state error-state" role="alert">
        <p className="section-kicker">Finance unavailable</p>
        <h2>We couldn’t load your finance data.</h2>
        <p>{dashboard.overview.error.message}</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => void dashboard.overview.refetch()}
        >
          Try again
        </button>
      </section>
    );
  }

  const overview = dashboard.overview.data;
  const openRecordAction = (action: RecordAction) => {
    dashboard.voidTransaction.reset();
    dashboard.deactivateBudget.reset();
    dashboard.deactivateRecurring.reset();
    setRecordAction(action);
  };
  const confirmRecordAction = async (reason: string) => {
    if (recordAction === null) return;
    const idempotencyKey = `${recordAction.kind}-${crypto.randomUUID()}`;
    try {
      if (recordAction.kind === "void-transaction") {
        await dashboard.voidTransaction.mutateAsync({
          recordId: recordAction.recordId,
          idempotencyKey,
          body: {
            reason,
            expected_version: overview.provenance.projection_version,
          },
        });
      } else if (recordAction.kind === "deactivate-recurring") {
        await dashboard.deactivateRecurring.mutateAsync({
          recordId: recordAction.recordId,
          idempotencyKey,
          body: { expected_version: overview.provenance.projection_version },
        });
      } else {
        await dashboard.deactivateBudget.mutateAsync({
          recordId: recordAction.recordId,
          idempotencyKey,
          body: { expected_version: overview.provenance.projection_version },
        });
      }
      setRecordAction(null);
    } catch {
      // The mutation exposes its API error inside the confirmation dialog.
    }
  };
  const actionPending =
    dashboard.voidTransaction.isPending ||
    dashboard.deactivateBudget.isPending ||
    dashboard.deactivateRecurring.isPending;
  const actionError =
    dashboard.voidTransaction.error ??
    dashboard.deactivateBudget.error ??
    dashboard.deactivateRecurring.error;
  return (
    <div className="finance-dashboard">
      <section className="dashboard-header" aria-labelledby="finance-title">
        <div className="dashboard-hero-copy">
          <div className="dashboard-eyebrow-row">
            <p className="eyebrow">Personal Finance</p>
            <button
              className="dashboard-info-button"
              type="button"
              aria-label="How to use the Personal Finance dashboard"
              title="How to use the Personal Finance dashboard"
              onClick={() => setShowDashboardGuide(true)}
            >
              <CircleHelp size={20} aria-hidden="true" />
            </button>
          </div>
          <h1 id="finance-title">Your money, in one view!</h1>
          <p className="lede">
            Track cash flow, monthly limits, recurring commitments, and the
            exact savings amount that will feed future portfolio analysis.
          </p>
        </div>
        <label className="month-control">
          <span>Reporting month</span>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
      </section>

      <SummaryCards overview={overview} />
      <section
        className="finance-activity"
        aria-labelledby="finance-activity-title"
      >
        <div className="dashboard-section-heading finance-activity-heading">
          <div>
            <p className="section-kicker">Monthly money management</p>
            <h2 id="finance-activity-title">Your Financial Activity</h2>
            <p>
              Add records, then review cash flow, recent transactions, budgets,
              and commitments for the selected month.
            </p>
          </div>
        </div>
        <FinanceEntryForms
          dashboard={dashboard}
          overview={overview}
          month={month}
        />
        <div className="finance-overview-row">
          <CashFlowChart overview={overview} />
          <TransactionPanel overview={overview} onAction={openRecordAction} />
          <PlanningPanel overview={overview} onAction={openRecordAction} />
        </div>
      </section>
      <FinanceAnalytics
        overview={overview}
        historyMonths={dashboard.historyMonths}
        history={dashboard.history.map((item) => item.data)}
      />
      <SmartSavingsInsights
        accessToken={accessToken}
        month={month}
        financeOverview={overview}
      />
      {showDashboardGuide && (
        <DashboardGuideDialog onClose={() => setShowDashboardGuide(false)} />
      )}
      {recordAction === null ? null : (
        <RecordActionDialog
          action={recordAction}
          error={actionError}
          pending={actionPending}
          onCancel={() => setRecordAction(null)}
          onConfirm={confirmRecordAction}
        />
      )}
    </div>
  );
}

export function SummaryCards({ overview }: { overview: FinanceOverview }) {
  const summary = overview.summary;
  const cards = [
    ["Current balance", summary.balance.minor_units, "All Recorded Cash Flow"],
    ["Income", summary.income.minor_units, "Total Earned This Month"],
    ["Expenses", summary.expense.minor_units, "Total Spent This Month"],
    [
      "Available savings",
      summary.savings.available.minor_units,
      "After Recurring Entries & Obligations",
    ],
  ] as const;
  return (
    <section
      className="summary-grid finance-summary-grid"
      aria-label="Finance summary"
    >
      {cards.map(([label, amount, note]) => (
        <article className="metric-card" key={label}>
          <p>{label}</p>
          <strong>{formatUsd(amount)}</strong>
          <small>{note}</small>
        </article>
      ))}
    </section>
  );
}

const SAVINGS_BREAKDOWN = [
  { sign: "plus", label: "Recorded Income" },
  { sign: "minus", label: "Recorded Expenses" },
  { sign: "plus", label: "Unmatched Recurring Income" },
  { sign: "minus", label: "Unmatched Recurring Expenses" },
  { sign: "plus", label: "Confirmed Receivables" },
  { sign: "minus", label: "Confirmed Payables" },
] as const;

function CashFlowChart({ overview }: { overview: FinanceOverview }) {
  const { summary } = overview;
  const data = [
    {
      label: "Income",
      amount: summary.income.minor_units,
      color: "var(--income)",
    },
    {
      label: "Expenses",
      amount: summary.expense.minor_units,
      color: "var(--expense)",
    },
    {
      label: "Savings",
      amount: summary.savings.projected.minor_units,
      color: "var(--warning)",
    },
  ];
  return (
    <section
      className="panel chart-panel overview-panel"
      aria-labelledby="cash-flow-title"
    >
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Monthly shape</p>
          <h2 id="cash-flow-title">Cash flow</h2>
        </div>
      </div>
      <div
        className="chart-wrap"
        role="img"
        aria-label={`Income ${formatUsd(summary.income.minor_units)}, expenses ${formatUsd(summary.expense.minor_units)}, projected savings ${formatUsd(summary.savings.projected.minor_units)}`}
      >
        <ResponsiveContainer width="100%" height={140}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" interval={0} tick={chartTickStyle} />
            <YAxis
              width={64}
              tick={chartTickStyle}
              tickFormatter={(value: number) => formatUsd(value)}
            />
            <Tooltip
              cursor={chartTooltipCursor}
              contentStyle={chartTooltipContentStyle}
              labelStyle={chartTooltipLabelStyle}
              itemStyle={chartTooltipItemStyle}
              formatter={(value) => formatUsd(Number(value))}
              labelFormatter={(label) =>
                label === "Savings" ? "Projected savings" : String(label)
              }
            />
            <Bar dataKey="amount" radius={[8, 8, 2, 2]}>
              {data.map((item) => (
                <Cell key={item.label} fill={item.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div
        className="savings-breakdown"
        aria-label="Projected savings calculation"
      >
        <p className="savings-breakdown-title">
          Here Savings (Projected) is defined as:
        </p>
        <ul>
          {SAVINGS_BREAKDOWN.map((item) => (
            <li key={item.label} data-sign={item.sign}>
              <span className="savings-sign" aria-hidden="true">
                {item.sign === "plus" ? "+" : "−"}
              </span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PlanningPanel({
  overview,
  onAction,
}: {
  overview: FinanceOverview;
  onAction: (action: RecordAction) => void;
}) {
  const statuses = overview.summary.budget_statuses;
  const recurring = overview.recurring_entries.filter((item) => item.active);
  const openObligations = overview.obligations.filter((item) => !item.settled);
  return (
    <section
      className="panel overview-panel planning-panel"
      aria-labelledby="planning-title"
    >
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Guardrails &amp; looking ahead</p>
          <h2 id="planning-title">Budgets &amp; Commitments</h2>
        </div>
      </div>
      <div className="planning-scroll">
        <section className="planning-section" aria-labelledby="budget-title">
          <h3 id="budget-title">Budgets</h3>
          {statuses.length === 0 ? (
            <EmptyState text="No budgets for this month yet." />
          ) : (
            <ul className="budget-list">
              {statuses.map((budget, index) => (
                <li
                  key={budget.budget_id}
                  data-status={budget.status}
                  data-bar-color={
                    (["red", "yellow", "teal"] as const)[index % 3]
                  }
                >
                  <div className="budget-row">
                    <strong>{budget.category_name}</strong>
                    <div className="budget-actions">
                      <span>
                        {formatUsd(budget.spent.minor_units)} /{" "}
                        {formatUsd(budget.limit.minor_units)}
                      </span>
                      <RecordActionButton
                        accessibleLabel={`Remove budget ${budget.category_name}`}
                        onAction={() =>
                          onAction({
                            kind: "deactivate-budget",
                            recordId: budget.budget_id,
                            label: budget.category_name,
                          })
                        }
                      />
                    </div>
                  </div>
                  <progress
                    max={10_000}
                    value={Math.min(budget.utilization_basis_points, 10_000)}
                    aria-label={`${budget.category_name} budget utilization`}
                  />
                  <small>
                    {budget.status === "over_budget"
                      ? "Over budget"
                      : budget.status === "near_limit"
                        ? "Near the limit"
                        : `${formatUsd(budget.remaining.minor_units)} remaining`}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section
          className="planning-section"
          aria-labelledby="commitments-title"
        >
          <h3 id="commitments-title">Commitments</h3>
          {recurring.length === 0 && openObligations.length === 0 ? (
            <EmptyState text="No recurring entries or group obligations yet." />
          ) : (
            <CommitmentList
              recurring={recurring}
              obligations={openObligations}
              onAction={onAction}
            />
          )}
        </section>
      </div>
    </section>
  );
}

function TransactionPanel({
  overview,
  onAction,
}: {
  overview: FinanceOverview;
  onAction: (action: RecordAction) => void;
}) {
  const active = overview.transactions.filter((item) => !item.voided);
  const categories = new Map(
    overview.categories.map((item) => [item.category_id, item.name]),
  );
  return (
    <section
      className="panel overview-panel transactions-panel"
      aria-labelledby="transactions-title"
    >
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">Event ledger</p>
          <h2 id="transactions-title">Recent Transactions</h2>
        </div>
      </div>
      {active.length === 0 ? (
        <EmptyState text="No transactions yet. Add income or an expense above." />
      ) : (
        <AlwaysVisibleScroll>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Category</th>
                  <th scope="col">Amount</th>
                  <th scope="col" className="record-actions-heading">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.slice(0, 8).map((entry) => (
                  <tr key={entry.transaction_id}>
                    <td>{entry.occurred_on}</td>
                    <td>{entry.description}</td>
                    <td>{categories.get(entry.category_id) ?? "Unknown"}</td>
                    <td className={entry.direction}>
                      {entry.direction === "expense" ? "−" : "+"}
                      {formatUsd(entry.amount.minor_units)}
                    </td>
                    <td className="record-actions-cell">
                      <RecordActionButton
                        accessibleLabel={`Void transaction ${entry.description}`}
                        onAction={() =>
                          onAction({
                            kind: "void-transaction",
                            recordId: entry.transaction_id,
                            label: entry.description,
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AlwaysVisibleScroll>
      )}
    </section>
  );
}

function CommitmentList({
  recurring,
  obligations,
  onAction,
}: {
  recurring: FinanceOverview["recurring_entries"];
  obligations: FinanceOverview["obligations"];
  onAction: (action: RecordAction) => void;
}) {
  return (
    <ul className="commitment-list">
      {recurring.map((item) => (
        <li key={item.recurring_entry_id}>
          <span
            className={`direction-icon ${item.direction}`}
            aria-hidden="true"
          >
            {item.direction === "income" ? "+" : "−"}
          </span>
          <div>
            <strong>{item.description}</strong>
            <small>Monthly from {item.starts_on}</small>
          </div>
          <span>{formatUsd(item.amount.minor_units)}</span>
          <RecordActionButton
            accessibleLabel={`Deactivate recurring item ${item.description}`}
            onAction={() =>
              onAction({
                kind: "deactivate-recurring",
                recordId: item.recurring_entry_id,
                label: item.description,
              })
            }
          />
        </li>
      ))}
      {obligations.map((item) => (
        <li key={item.obligation_id}>
          <span
            className={`direction-icon ${item.direction}`}
            aria-hidden="true"
          >
            {item.direction === "receivable" ? "+" : "−"}
          </span>
          <div>
            <strong>
              {item.direction === "receivable" ? "Receivable" : "Payable"}
            </strong>
            <small>
              {item.due_on === null ? "No due date" : `Due ${item.due_on}`}
            </small>
          </div>
          <span>{formatUsd(item.amount.minor_units)}</span>
        </li>
      ))}
    </ul>
  );
}

function DashboardGuideDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="dashboard-guide-dialog"
      aria-labelledby="dashboard-guide-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dashboard-guide-heading">
        <div>
          <p className="section-kicker">Personal Finance guide</p>
          <h2 id="dashboard-guide-title">How to use this dashboard</h2>
        </div>
        <button
          type="button"
          aria-label="Close dashboard guide"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <ul className="dashboard-guide-points">
        <li>
          Record income and expenses, set monthly budgets, and add recurring
          commitments.
        </li>
        <li>
          Use the reporting month to review balances, trends, and
          evidence-linked insights for a specific month.
        </li>
      </ul>
      <div className="savings-conventions">
        <article>
          <strong>Actual savings</strong>
          <ul>
            <li>Recorded monthly income minus recorded monthly expenses.</li>
          </ul>
        </article>
        <article>
          <strong>Projected savings</strong>
          <ul>
            <li>
              Actual savings adjusted for unmatched recurring items and open
              receivables or payables due this month.
            </li>
          </ul>
        </article>
        <article>
          <strong>Available savings</strong>
          <ul>
            <li>
              Projected savings floored at zero; this is the default amount sent
              to future portfolio analysis.
            </li>
          </ul>
        </article>
      </div>
      <ul className="dashboard-guide-note">
        <li>Changes append auditable events.</li>
        <li>
          Smart Savings Insights explain verified records and cannot edit your
          finances, sign wallet actions, settle obligations, or trade.
        </li>
      </ul>
    </dialog>
  );
}

function RecordActionButton({
  accessibleLabel,
  onAction,
}: {
  accessibleLabel: string;
  onAction: () => void;
}) {
  return (
    <button
      className="record-action-button"
      type="button"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      onClick={onAction}
    >
      <ArchiveX size={18} color="#FF6B4A" aria-hidden="true" />
    </button>
  );
}

function RecordActionDialog({
  action,
  error,
  pending,
  onCancel,
  onConfirm,
}: {
  action: RecordAction;
  error: Error | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const voiding = action.kind === "void-transaction";
  const removingBudget = action.kind === "deactivate-budget";

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="record-action-dialog"
      aria-labelledby="record-action-title"
      onCancel={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onConfirm(reason.trim());
        }}
      >
        <p className="section-kicker">Confirm ledger change</p>
        <h2 id="record-action-title">
          {voiding
            ? "Void this transaction?"
            : removingBudget
              ? "Remove this budget?"
              : "Deactivate this recurring item?"}
        </h2>
        <p>
          {voiding
            ? `“${action.label}” will stop affecting your active financial calculations.`
            : removingBudget
              ? `The “${action.label}” budget will stop appearing in this month’s guardrails.`
              : `“${action.label}” will stop affecting projected savings calculations.`}
        </p>
        <p className="audit-note">
          The original record remains in the append-only audit trail. This
          action adds a new event and does not erase history.
        </p>
        {voiding ? (
          <label className="form-field">
            <span>Reason for voiding</span>
            <textarea
              autoFocus
              required
              maxLength={160}
              rows={3}
              value={reason}
              placeholder="For example: Duplicate transaction"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="destructive-button"
            type="submit"
            disabled={pending || (voiding && reason.trim().length === 0)}
          >
            {pending
              ? "Saving…"
              : voiding
                ? "Void Transaction"
                : removingBudget
                  ? "Remove Budget"
                  : "Deactivate Recurring Item"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

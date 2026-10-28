import { CircleHelp, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { JsonValue } from "../auth/reswallet";
import { formatUsd, usdToMinorUnits } from "../finance/money";
import { groupTotals } from "./activity";
import { ActionFeedback, errorMessage } from "./ActionFeedback";
import { GroupActivityTabs } from "./GroupActivityTabs";
import { GroupBalanceChart } from "./GroupBalanceChart";
import {
  isGroupWritePending,
  requestSignature,
  type Dashboard,
  type GroupOverview,
} from "./groupActions";
import { MembersMenu } from "./MembersMenu";
import { memberDisplayName, shortAddress } from "./members";
import {
  applyEqualSplit,
  buildShares,
  splitProgress,
  type SplitMode,
  type SplitRow,
} from "./split";
import { SplitEditor } from "./SplitEditor";
import { useGroupAction } from "./useGroupAction";
import { useGroupsDashboard } from "./useGroupsDashboard";

interface Props {
  accessToken: string;
  actorAddress: string;
}

export function GroupsDashboard({ accessToken, actorAddress }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showDashboardGuide, setShowDashboardGuide] = useState(false);
  const createPanelId = useId();
  const dashboard = useGroupsDashboard(accessToken, selectedGroupId);
  const groups = dashboard.groups.data;
  const hasGroups = groups !== undefined && groups.length > 0;
  const showCreate = creating || (groups !== undefined && groups.length === 0);

  useEffect(() => {
    if (selectedGroupId === null && groups !== undefined && groups.length > 0) {
      setSelectedGroupId(groups[0]!.group_id);
    }
  }, [groups, selectedGroupId]);

  return (
    <div className="groups-dashboard">
      <section className="dashboard-header" aria-labelledby="groups-title">
        <div className="dashboard-hero-copy">
          <div className="dashboard-eyebrow-row">
            <p className="eyebrow">Friends &amp; Groups</p>
            <button
              className="dashboard-info-button"
              type="button"
              aria-label="How to use the Friends & Groups dashboard"
              title="How to use the Friends & Groups dashboard"
              onClick={() => setShowDashboardGuide(true)}
            >
              <CircleHelp size={20} aria-hidden="true" />
            </button>
          </div>
          <h1 id="groups-title">Shared expenses, signed by all!</h1>
          <p className="lede">
            Split expenses, track balances, and settle securely via ResContract
            smart contracts, with every transaction verified and recorded for
            transparency.
          </p>
        </div>
        <WalletChip address={actorAddress} />
      </section>

      {showDashboardGuide && (
        <GroupsDashboardGuideDialog
          onClose={() => setShowDashboardGuide(false)}
        />
      )}

      {dashboard.groups.isLoading && (
        <DashboardState text="Loading your groups…" />
      )}
      {dashboard.groups.isError && (
        <DashboardState text={errorMessage(dashboard.groups.error)} error />
      )}

      {hasGroups && (
        <GroupBalanceChart
          actorAddress={actorAddress}
          obligations={dashboard.overviews.flatMap(
            (query) => query.data?.obligations ?? [],
          )}
          members={dashboard.overviews.flatMap(
            (query) => query.data?.members ?? [],
          )}
          groups={groups}
          overviews={dashboard.overviews.flatMap((query) =>
            query.data === undefined ? [] : [query.data],
          )}
          loading={dashboard.overviews.some((query) => query.isLoading)}
          creating={creating}
          createPanelId={createPanelId}
          onCreateToggle={() => setCreating((current) => !current)}
        />
      )}

      {hasGroups && (
        <div className="group-bar">
          <nav className="group-switcher" aria-label="Your groups">
            {groups.map((group) => (
              <button
                key={group.group_id}
                type="button"
                className="group-chip"
                aria-current={
                  group.group_id === selectedGroupId ? "true" : undefined
                }
                onClick={() => setSelectedGroupId(group.group_id)}
              >
                <strong>{group.name}</strong>
                <span>
                  {group.member_count} members · {group.open_obligation_count}{" "}
                  open
                </span>
              </button>
            ))}
          </nav>
        </div>
      )}

      {showCreate && (
        <CreateGroupPanel
          id={createPanelId}
          pending={dashboard.create.isPending}
          onCreate={async (name, displayName) => {
            const groupId = `group-${crypto.randomUUID()}`;
            await dashboard.create.mutateAsync({
              idempotencyKey: `create-${groupId}`,
              body: {
                group_id: groupId,
                name,
                owner_display_name: displayName,
                expected_version: 0,
              },
            });
            setSelectedGroupId(groupId);
            setCreating(false);
          }}
        />
      )}

      {groups !== undefined && groups.length === 0 && (
        <p className="empty-state">
          No groups yet. Create one above, then add friends by wallet address to
          start splitting expenses.
        </p>
      )}

      {selectedGroupId !== null && dashboard.overview.isLoading && (
        <DashboardState text="Refreshing the group data…" />
      )}
      {dashboard.overview.isError && (
        <DashboardState text={errorMessage(dashboard.overview.error)} error />
      )}
      {dashboard.overview.data !== undefined && (
        <GroupWorkspace
          key={dashboard.overview.data.group_id}
          actorAddress={actorAddress}
          group={dashboard.overview.data}
          dashboard={dashboard}
        />
      )}
    </div>
  );
}

function WalletChip({ address }: { address: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  const statusLabel =
    copyStatus === "copied"
      ? "Copied"
      : copyStatus === "failed"
        ? "Copy failed"
        : "Click to copy";

  return (
    <button
      type="button"
      className="wallet-chip"
      aria-label={`Wallet ${address}. ${statusLabel}`}
      onClick={() => void copyAddress()}
    >
      <svg
        className="wallet-chip-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 7V6a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v8a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V7" />
        <path d="M16 14h.01" />
      </svg>
      <span className="wallet-chip-label">Wallet {shortAddress(address)}</span>
      <span className="wallet-chip-tooltip" role="tooltip">
        <code>{address}</code>
        <span className="wallet-chip-hint">{statusLabel}</span>
      </span>
    </button>
  );
}

function GroupsDashboardGuideDialog({ onClose }: { onClose: () => void }) {
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
      aria-labelledby="groups-dashboard-guide-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dashboard-guide-heading">
        <div>
          <p className="section-kicker">Friends &amp; Groups guide</p>
          <h2 id="groups-dashboard-guide-title">How to use this dashboard?</h2>
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
          Use the group row to switch workspaces, or choose New group to start
          one. The Members control shows each participant and wallet address.
        </li>
        <li>
          Open Update the group to add a member, fund internal settlement
          credits, or record an expense. Select the participants, then split the
          total equally or enter exact amounts.
        </li>
        <li>
          Review Obligations for shares that need your approval or settlement.
          Expenses preserves the split history, while Notifications records
          actions that need attention.
        </li>
        <li>
          ResWallet asks for an explicit signature when an action affects the
          contract. ResContract remains authoritative, and Personal Finance
          changes only after a confirmed receipt.
        </li>
      </ul>
      <div className="savings-conventions groups-guide-concepts">
        <article>
          <strong>Split an expense</strong>
          <p>
            Choose who participated. Equal and exact splits must reconcile to
            the expense total in USD cents.
          </p>
        </article>
        <article>
          <strong>Approve and settle</strong>
          <p>
            Participants approve their own shares, then use funded internal
            credits for partial or full settlement.
          </p>
        </article>
        <article>
          <strong>Know the boundary</strong>
          <p>
            Credits are non-redeemable and have no cash value. This dashboard
            does not transfer fiat or cryptocurrency.
          </p>
        </article>
      </div>
    </dialog>
  );
}

function GroupWorkspace({
  actorAddress,
  group,
  dashboard,
}: {
  actorAddress: string;
  group: GroupOverview;
  dashboard: Dashboard;
}) {
  const [updateOpen, setUpdateOpen] = useState(group.expenses.length === 0);
  const totals = groupTotals(group.obligations, actorAddress);
  return (
    <section className="group-workspace" aria-labelledby="group-name">
      <div className="dashboard-section-heading group-heading">
        <div>
          <p className="section-kicker">Active group</p>
          <h2 id="group-name">{group.name}</h2>
          <p>{group.credit_disclaimer}</p>
        </div>
      </div>

      <section
        className="summary-grid group-summary-grid"
        aria-label="Group summary"
      >
        <article className="metric-card">
          <p>Members</p>
          <div className="metric-value">
            <MembersMenu
              actorAddress={actorAddress}
              ownerAddress={group.owner_address}
              members={group.members}
            />
          </div>
          <small>Open the list to copy wallet addresses</small>
        </article>
        <article className="metric-card">
          <p>Your credits</p>
          <strong>
            {formatUsd(group.credit_balances[actorAddress]?.minor_units ?? 0)}
          </strong>
          <small>Internal, non-redeemable settlement credits</small>
        </article>
        <article className="metric-card">
          <p>You owe</p>
          <strong>{formatUsd(totals.oweMinorUnits)}</strong>
          <small>Approved obligations still outstanding</small>
        </article>
        <article className="metric-card">
          <p>You are owed</p>
          <strong>{formatUsd(totals.owedMinorUnits)}</strong>
          <small>Approved obligations others still owe you</small>
        </article>
      </section>

      <details
        className="entry-accordion group-update"
        open={updateOpen}
        onToggle={(event) => setUpdateOpen(event.currentTarget.open)}
      >
        <summary>
          <span>Update the group</span>
          <small>
            Every change is approved in ResWallet and confirmed by ResContract.
          </small>
        </summary>
        <div className="group-entry-grid">
          {group.owner_address === actorAddress && (
            <AddMemberPanel group={group} dashboard={dashboard} />
          )}
          <FundCreditsPanel
            actorAddress={actorAddress}
            group={group}
            dashboard={dashboard}
          />
          <CreateExpensePanel
            actorAddress={actorAddress}
            group={group}
            dashboard={dashboard}
          />
        </div>
      </details>

      <GroupActivityTabs
        actorAddress={actorAddress}
        group={group}
        dashboard={dashboard}
      />

      <footer className="provenance-footer">
        <strong>Data Freshness and Provenance</strong>
        <span>Projection v{group.provenance.projection_version}</span>
        <span>
          {group.provenance.source_event_ids.length} encrypted source events
        </span>
        <span>{formatTimestamp(group.provenance.as_of_utc)}</span>
      </footer>
    </section>
  );
}

function CreateGroupPanel({
  id,
  pending,
  onCreate,
}: {
  id: string;
  pending: boolean;
  onCreate(name: string, displayName: string): Promise<void>;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const action = useGroupAction();
  return (
    <section id={id} className="panel create-group-panel">
      <div className="section-heading compact">
        <div>
          <p className="section-kicker">New group</p>
          <h2>Create a shared ledger</h2>
        </div>
      </div>
      <form
        className="group-form create-group-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await onCreate(name, displayName);
            setName("");
            setDisplayName("");
          });
        }}
      >
        <label className="form-field">
          <span>Group name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label className="form-field">
          <span>Your display name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>
        <button className="primary-button" disabled={pending || action.busy}>
          {pending ? "Creating…" : "Create group"}
        </button>
      </form>
      <ActionFeedback action={action} />
    </section>
  );
}

function AddMemberPanel({
  group,
  dashboard,
}: {
  group: GroupOverview;
  dashboard: Dashboard;
}) {
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const action = useGroupAction();
  return (
    <section className="entry-form-card member-form">
      <h3>Add member</h3>
      <form
        className="group-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const id = crypto.randomUUID();
            await dashboard.member.mutateAsync({
              groupId: group.group_id,
              idempotencyKey: `member-${id}`,
              body: {
                member_address: address,
                display_name: name,
                expected_version: group.provenance.projection_version,
              },
            });
            setAddress("");
            setName("");
          });
        }}
      >
        <label className="form-field">
          <span>Wallet address</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            pattern="0x[0-9a-fA-F]{40}"
            placeholder="0x…"
            required
          />
        </label>
        <label className="form-field">
          <span>Display name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <button
          className="primary-button form-action"
          disabled={isGroupWritePending(dashboard) || action.busy}
        >
          Add member
        </button>
        <ActionFeedback action={action} />
      </form>
    </section>
  );
}

function FundCreditsPanel({
  actorAddress,
  group,
  dashboard,
}: {
  actorAddress: string;
  group: GroupOverview;
  dashboard: Dashboard;
}) {
  const [amount, setAmount] = useState("");
  const action = useGroupAction();
  return (
    <section className="entry-form-card credits-form">
      <h3>Fund internal credits</h3>
      <form
        className="group-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async ({ sign }) => {
            const amountMinorUnits = usdToMinorUnits(amount);
            const parameters = {
              group_id: group.group_id,
              amount_minor_units: amountMinorUnits,
              expected_version: group.provenance.projection_version,
            };
            const intent = await sign(
              requestSignature("credits.fund", group.group_id, parameters),
            );
            await dashboard.credits.mutateAsync({
              groupId: group.group_id,
              idempotencyKey: `credits-${intent.intent_id}`,
              body: {
                amount: { currency: "USD", minor_units: amountMinorUnits },
                expected_version: group.provenance.projection_version,
                intent,
              },
            });
            setAmount("");
          });
        }}
      >
        <p className="form-hint">
          Non-redeemable ledger credits only; no fiat or crypto moves. Funding
          wallet:{" "}
          <span className="funding-wallet">{shortAddress(actorAddress)}</span>
        </p>
        <label className="form-field">
          <span>Credit amount (USD units)</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="60.00"
            required
          />
        </label>
        <button
          className="primary-button form-action"
          disabled={isGroupWritePending(dashboard) || action.busy}
        >
          Approve funding in ResWallet
        </button>
        <ActionFeedback action={action} />
      </form>
    </section>
  );
}

function CreateExpensePanel({
  actorAddress,
  group,
  dashboard,
}: {
  actorAddress: string;
  group: GroupOverview;
  dashboard: Dashboard;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dueOn, setDueOn] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [shareAmounts, setShareAmounts] = useState<Record<string, string>>({});
  const action = useGroupAction();
  const activeMembers = group.members.filter((member) => member.active);
  const enteredRows: SplitRow[] = activeMembers.map((member) => ({
    address: member.actor_address,
    name: member.display_name,
    included: excluded[member.actor_address] !== true,
    amount: shareAmounts[member.actor_address] ?? "",
  }));
  const rows =
    splitMode === "equal"
      ? applyEqualSplit(amount, enteredRows, actorAddress)
      : enteredRows;
  const payerName =
    memberDisplayName(group.members, actorAddress) ??
    shortAddress(actorAddress);
  return (
    <section className="entry-form-card expense-form">
      <h3>Add an expense</h3>
      <form
        className="group-form expense-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async ({ sign }) => {
            const expenseId = `expense-${crypto.randomUUID()}`;
            const { amountMinorUnits, shares } = buildShares(
              amount,
              rows,
              actorAddress,
            );
            const parameters: Record<string, JsonValue> = {
              group_id: group.group_id,
              expense_id: expenseId,
              payer_address: actorAddress,
              description,
              amount_minor_units: amountMinorUnits,
              occurred_on: occurredOn,
              due_on: dueOn || null,
              shares: Object.fromEntries(
                Object.entries(shares).sort(([left], [right]) =>
                  left.localeCompare(right),
                ),
              ),
              expected_version: group.provenance.projection_version,
            };
            const intent = await sign(
              requestSignature("split.approve", expenseId, parameters),
            );
            await dashboard.expense.mutateAsync({
              groupId: group.group_id,
              idempotencyKey: `expense-${intent.intent_id}`,
              body: {
                expense_id: expenseId,
                payer_address: actorAddress,
                description,
                amount: { currency: "USD", minor_units: amountMinorUnits },
                occurred_on: occurredOn,
                due_on: dueOn || null,
                shares: Object.fromEntries(
                  Object.entries(shares).map(([address, minor_units]) => [
                    address,
                    { currency: "USD" as const, minor_units },
                  ]),
                ),
                expected_version: group.provenance.projection_version,
                intent,
              },
            });
            setDescription("");
            setAmount("");
            setSplitMode("equal");
            setExcluded({});
            setShareAmounts({});
          });
        }}
      >
        <label className="form-field">
          <span>Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </label>
        <label className="form-field">
          <span>Total amount</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </label>
        <label className="form-field">
          <span>Expense date</span>
          <input
            type="date"
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
            required
          />
        </label>
        <label className="form-field">
          <span>Due date</span>
          <input
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </label>
        <SplitEditor
          mode={splitMode}
          onModeChange={(next) => {
            if (next === "exact" && splitMode === "equal") {
              setShareAmounts(
                Object.fromEntries(
                  rows
                    .filter((row) => row.included && row.amount !== "")
                    .map((row) => [row.address, row.amount]),
                ),
              );
            }
            setSplitMode(next);
          }}
          rows={rows}
          members={group.members}
          payerAddress={actorAddress}
          payerName={payerName}
          progress={splitProgress(amount, rows)}
          onToggle={(address, included) =>
            setExcluded((current) => ({ ...current, [address]: !included }))
          }
          onAmountChange={(address, value) =>
            setShareAmounts((current) => ({ ...current, [address]: value }))
          }
        />
        <div className="expense-submit wide-field">
          <button
            className="primary-button form-action"
            disabled={isGroupWritePending(dashboard) || action.busy}
          >
            Approve split in ResWallet
          </button>
          <ActionFeedback action={action} />
        </div>
      </form>
    </section>
  );
}

function DashboardState({
  text,
  error = false,
}: {
  text: string;
  error?: boolean;
}) {
  return (
    <section
      className={`dashboard-state ${error ? "error-state" : ""}`}
      aria-live="polite"
    >
      <span className="loading-orb" aria-hidden="true" />
      <h2>{text}</h2>
    </section>
  );
}

function formatTimestamp(value: string | null): string {
  return value === null
    ? "No events yet"
    : `Updated ${new Date(value).toLocaleString()}`;
}

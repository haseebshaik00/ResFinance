# ResFinance Local Demo Runbook

This guide is for presenting the complete ResFinance product on one local
machine. It covers browser and wallet preparation, recommended demo data, the
presentation sequence, the main talking points, and demo-safe recovery steps.

Install dependencies, run repository checks, and start or stop the local stack
from the [`Local Operator Guide`](local-operator-guide.md). After the stack is
healthy, continue with the demo steps below.

The demo is local and research-only. It does not demonstrate cloud deployment,
production readiness, exchange custody, trading, fiat transfers, native crypto
transfers, commercial use, or independent Byzantine fault tolerance.

## Demo goal

The audience should leave with a clear understanding of one connected journey:

```text
ResWallet identity
  → Personal Finance
  → Shared expense and contractual settlement
  → Updated Finance context
  → Promoted BTC/ETH/SOL analysis
  → Non-mutating scenario
  → Evidence-bound Smart Insights
```

Recommended presentation time: 15–20 minutes.

## What the demo proves

- Wallet identity and approvals are controlled by the ResWallet browser
  extension; private keys and seeds never enter the application or backend.
- Finance records are append-only, encrypted before persistence, stored in
  ResilientDB, and reduced into a rebuildable monthly view.
- ResContract is authoritative for shared obligations, internal-credit
  funding, settlements, and receipts.
- Confirmed group activity flows back into Personal Finance.
- The Crypto Intelligence dashboard accepts exactly BTC, ETH, and SOL, uses
  Finance savings as its default capital, and reconciles allocations to exact
  USD cents.
- A forecast is visible only when an immutable promotion event and its dataset,
  run, model, and snapshot provenance all validate.
- **Analyze Another Amount** changes only the on-screen scenario and never
  mutates Finance.
- Smart Insights is read-only and can answer only from wallet-authorized facts.
- Restart preserves application state and allows projections to rebuild.

## Important current-demo limitation

The accepted Milestone 7 snapshot is valid through
`2026-10-17T00:00:00Z`, which is October 16 at 5:00 PM Pacific. After expiry,
the Crypto Intelligence dashboard intentionally fails closed and stops
producing a recommendation.

For a demo after that time, do not backdate the computer, weaken freshness
checks, insert a synthetic forecast, or edit the attestation. A refresh-only
current-inference workflow should be completed before presenting the live
recommendation again. Demonstrating the safe stale-forecast gate is still a
valid fallback.

## 1. Prepare the machine

Use the repository root for lifecycle commands:

```bash
cd /path/to/ResFinance
```

Confirm Docker Desktop is running and that the expected Node installation is
available:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
docker version
node --version
```

The validated versions are Python 3.13, Node 22, and the pinned local Docker
images described in the [`Local Operator Guide`](local-operator-guide.md).

For first-time dependency setup and repository checks, follow **Install once**
and **Local verification** in the
[`Local Operator Guide`](local-operator-guide.md). Skip those steps when the
environment is already installed and verified.

## 2. Start the complete local stack

The recommended demo uses deterministic, evidence-validated Smart Insights.
This avoids optional local-model latency and is the same mode used by the final
real-browser acceptance.

Start and check the stack with **Preflight and start** and **Lifecycle** in the
[`Local Operator Guide`](local-operator-guide.md) (no-model / evidence-template
mode). Every required preflight check should report `PASS`.

Expected result after `status`:

- four healthy ResilientDB replicas;
- four healthy ResContract replicas;
- healthy ResilientDB and ResContract proxies;
- healthy FastAPI service;
- running local client; and
- healthy API access through `http://127.0.0.1:5173`.

Open the application:

```text
http://127.0.0.1:5173
```

Do not use `localhost`, the API port, or a different origin for the application
page. ResWallet intentionally responds only to the approved application origin.

## 3. Prepare two browser profiles and wallets

Use two persistent Chromium or Chrome profiles:

- `ResFinance Owner`
- `ResFinance Member`

In each profile:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select:

   ```text
   /Users/haseebrahman/Desktop/Projects/ResFinance/reswallet/dist
   ```

5. Pin ResWallet to the browser toolbar.
6. Open the ResWallet popup.
7. Enter a demo-only password and choose **Create ResWallet**.
8. Confirm the wallet is unlocked and has an address.

Record only the Member wallet's public address for the group demonstration.
Never export, copy, display, or place a seed or private key in demo notes.

In both profiles:

1. Open `http://127.0.0.1:5173/finance`.
2. Choose **Connect Wallet**.
3. Review the ResWallet toolbar approval popup while the ResFinance page remains
   visible behind it.
4. Choose **Approve & Login**.
5. Confirm the application displays **Session active**.

Keep the two application windows side by side so the audience can see that the
owner and member are separate wallet identities.

## 4. Prepare the recommended demo data

Use the Owner profile for Finance setup.

### Categories

Under **Category**, create:

| Name    | Type    |
| ------- | ------- |
| Salary  | Income  |
| Housing | Expense |

### Transactions

Under **Income or expense**, create:

| Type    | Category |    Amount | Description |
| ------- | -------- | --------: | ----------- |
| Income  | Salary   | $5,000.00 | Demo salary |
| Expense | Housing  | $1,000.00 | Demo rent   |

### Budget

Under **Monthly budget**, create:

| Expense category | Monthly limit |
| ---------------- | ------------: |
| Housing          |     $1,200.00 |

The resulting Finance view should show:

- Income: `$5,000.00`
- Expenses: `$1,000.00`
- Net balance: `$4,000.00`
- Available savings: `$4,000.00`

If reusing a profile that already contains data, choose values that produce a
clear positive savings amount and write down the expected total before the
presentation.

## 5. Recommended live presentation

### Part A — Introduce the architecture and security boundary

Show the Owner ResWallet popup and the authenticated application.

Explain:

- ResWallet owns the wallet seed and private key.
- The browser application requests signatures but never receives key material.
- FastAPI is the only browser-facing service boundary under `/api/v1`.
- ResilientDB is the only persistent application and research database.
- ResContract, not Finance, is authoritative for obligation and settlement
  state.

Suggested narration:

> ResFinance connects budgeting, shared expenses, and research-backed crypto
> analysis without moving wallet keys into the application. Every important
> write is authenticated, append-only, and rebuildable.

### Part B — Personal Finance

Open **Personal Finance** in the Owner profile.

Show:

1. Income, expenses, net balance, and available savings.
2. The monthly cash-flow chart.
3. The Housing budget and remaining amount.
4. The transaction list.
5. **Calculation and source provenance**.

Call out `finance-savings-v1` and the source-event count. Explain that money is
stored as integer USD cents and that the displayed `$4,000.00` becomes the
default Crypto Intelligence capital later in the demo.

### Part C — Friends & Groups and ResContract

In the Owner profile, open **Friends & Groups**.

Create a group:

| Field             | Value       |
| ----------------- | ----------- |
| Group name        | Demo Dinner |
| Your display name | Owner       |

Add the Member wallet:

| Field          | Value                        |
| -------------- | ---------------------------- |
| Wallet address | Member public wallet address |
| Display name   | Member                       |

Add an expense:

| Field         | Value         |
| ------------- | ------------- |
| Description   | Shared dinner |
| Total amount  | $60.00        |
| Split between | Split equally |
| Include Owner | Unticked      |

The Member's share fills in as `$60.00`, and the split summary reads
`All $60.00 assigned, split equally between 1 person.` Choose **Approve split
in ResWallet**, then approve the signature in the Owner wallet. Show the
`$60.00 outstanding` obligation.

Switch to the Member profile:

1. Open **Friends & Groups**.
2. Select **Demo Dinner**.
3. Choose **Approve in ResWallet** and approve the intent.
4. Enter `$60.00` under **Credit amount (USD units)**.
5. Choose **Approve funding in ResWallet**.

Explain that these are internal, non-redeemable accounting credits. No fiat,
token, or native cryptocurrency is transferred.

Demonstrate partial settlement:

1. Enter `$20.00` under **Partial or full amount**.
2. Choose **Settle with credits** and approve in ResWallet.
3. Show `$40.00 outstanding`.

Complete settlement:

1. Enter `$40.00`.
2. Choose **Settle with credits** and approve in ResWallet.
3. Show `$0.00 outstanding` and the settled status.

Return to the Owner's Finance view and point out the confirmed contractual
receipt or obligation projection. Explain that Finance changes only after
confirmed ResContract state.

### Part D — Crypto Intelligence forecast and exact-cent portfolio

In the Owner profile, open **Crypto Intelligence**.

Complete the risk questionnaire using the default middle answer (`2`) for each
question, then choose **Save risk profile**. This produces score `50`.

Show:

1. Default capital equals Finance available savings.
2. Forecast status is **7 days**.
3. The forecast as-of date and selected-model provenance.
4. BTC, ETH, and SOL chart switching.
5. The P10, P50, and P90 **Historical Error Range**, explaining that it
   summarizes held-out error rather than a validated 80% prediction interval.
6. The risk-profile result and no-trading boundary.

Explain that the validation-selected original MSPCIFormer checkpoint provides
the current seven-day market-price forecast. VASA remains a retained comparison
model; neither result is investment advice or an instruction to trade.

Open **Calculation and evidence provenance** and show the saved-checkpoint and
market-observation provenance.

### Part E — Analyze Another Amount without changing Finance

Under **Analyze Another Amount**:

1. Enter `$2,500.00`.
2. Choose **Analyze amount**.
3. Show **Scenario active: $2,500.00**.
4. Confirm the displayed allocation amounts sum to exactly `$2,500.00`.
5. Return to **Personal Finance**.
6. Show that available savings remains `$4,000.00`.

Explain that scenario analysis is read-only: it does not append a Finance
transaction, change the default savings source, trade assets, or transfer
money.

### Part F — Smart Insights and safety refusal

Return to **Personal Finance** and scroll to **Smart Savings Insights** below
the Finance ledger and commitments.

Ask a supported question:

```text
Which recorded budgets need attention?
```

Show:

- the evidence-bound answer;
- the **Evidence used** cards;
- source-reference counts; and
- the model/fallback provenance panel.

Then ask a prohibited action request:

```text
Transfer my crypto and settle everything for me.
```

Show the refusal and explain that Smart Insights has no write, wallet,
ResContract, settlement, trading, or direct ResilientDB capability.

### Part G — Restart persistence

This is optional during a short presentation but strongly recommended for a
technical audience.

From the repository root, run:

```bash
.venv/bin/python -m scripts.milestone9.local_handoff restart
```

Wait for every check to pass, then refresh the Owner application.

Show that:

- the session can recover;
- **Demo Dinner** remains settled at `$0.00 outstanding`;
- Finance records remain present;
- the promoted Crypto Intelligence recommendation remains available while
  fresh; and
- projections rebuild from persisted records.

Use `restart`, not `reset`.

### Part H — Logout and custody closure

Choose **Log out** in the Owner profile. Open ResWallet and show that the vault
is locked.

Close with this boundary:

> ResFinance demonstrates a complete local, wallet-authenticated financial
> workflow. It does not execute trades, custody exchange assets, transfer fiat
> or cryptocurrency, or claim production readiness.

## 6. Suggested 15-minute timing

|      Time | Segment                                         |
| --------: | ----------------------------------------------- |
|  1 minute | Product problem and architecture                |
| 2 minutes | ResWallet authentication and security boundary   |
| 3 minutes | Personal Finance                                |
| 4 minutes | Group expense, approval, and settlement         |
| 3 minutes | Crypto Intelligence forecast, risk, allocation, and scenario |
| 2 minutes | Smart Insights, refusal, and closing boundaries |

Run restart persistence as an additional 2–3 minute technical proof when time
allows.

## 7. Pre-demo checklist

Complete this checklist 30–60 minutes before presenting:

- [ ] Docker Desktop is running.
- [ ] Preflight reports only `PASS` for required checks.
- [ ] Local lifecycle status shows healthy replicas, API, and client.
- [ ] `http://127.0.0.1:5173` loads from both browser profiles.
- [ ] ResWallet is loaded from the current `reswallet/dist` in both profiles.
- [ ] Owner and Member wallets unlock successfully.
- [ ] The Member public address is available in the presenter notes.
- [ ] Finance totals match the planned demo amounts.
- [ ] The forecast has not expired.
- [ ] The Crypto Intelligence dashboard displays the promoted 15-day forecast.
- [ ] The deterministic Smart Insights fallback responds quickly.
- [ ] Notifications and approval popups are visible on the presentation screen.
- [ ] Browser zoom is comfortable for the audience.
- [ ] No seed, private key, password, terminal secret, or personal data is
      visible.
- [ ] The machine is connected to power and notifications are muted.

## 8. Recovery and troubleshooting

For `status`, `logs`, and `restart` while preserving local data, use
**Lifecycle** in the [`Local Operator Guide`](local-operator-guide.md). Prefer
those commands over reinstalling dependencies or rebuilding images mid-demo.

### ResWallet approval does not open

- Confirm the application URL is exactly `http://127.0.0.1:5173`.
- Confirm the correct browser profile has the unpacked extension loaded.
- Open ResWallet and unlock it before retrying.
- Do not reuse an old signed intent after a version conflict.

### A group action reports a version conflict

Wait for the current group projection to finish rendering, then submit a new
action and approve the newly generated intent.

### Crypto Intelligence shows no recommendation

Check these in order:

1. Complete the risk questionnaire.
2. Confirm the forecast is still fresh.
3. Confirm lifecycle status is healthy.
4. Check API logs for corrupt or missing promotion provenance.

Do not bypass the gate. A stale, corrupted, synthetic, or unpromoted forecast
must remain unavailable.

### Smart Insights does not use the local model

That is expected in the recommended demo configuration. The deterministic
renderer still uses validated wallet-authorized facts and demonstrates the
read-only evidence boundary. The optional Qwen overlay is not required for the
demo and may add substantial latency.

## 9. Commands to avoid during the demo

Do not run:

```bash
.venv/bin/python -m scripts.milestone9.local_handoff reset \
  --confirm DELETE_LOCAL_RESFINANCE_STATE
```

Reset deletes local Compose volumes and removes the application data,
promotion, research artifacts, and forecast snapshot required by the demo.

Also avoid:

- reinstalling dependencies;
- rebuilding or replacing Docker images;
- rerunning research merely to obtain different metrics;
- starting the optional local model without rehearsing its latency;
- exposing the FastAPI port as the browser application origin; and
- editing stored values, attestations, or browser state to bypass a failed
  check.

## 10. Optional automated rehearsal

Rehearse the complete non-mocked journey against the running stack with
**Browser acceptance** in the
[`Local Operator Guide`](local-operator-guide.md). Use that path for rehearsal
and verification, not as a substitute for the presenter profiles.

## Reference evidence

- [Milestone 7 Local Handoff](milestones/milestone7-cross-dashboard-local-handoff.md)
- [Milestone 7 operator guide](local-operator-guide.md)
- [Research protocol](research-protocol.md)
- [Security contract](security.md)
- [Archived Paper 2 evidence](research/archive/paper2-multimodal-naive/)

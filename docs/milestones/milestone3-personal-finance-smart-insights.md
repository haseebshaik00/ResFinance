# Milestone 3: Personal Finance — Dashboard & Smart Insights (Read-only AI)

Status: Complete for local development and real-stack acceptance

Finance evidence date: 2026-10-14 America/Los_Angeles

Smart Insights uses historical `scripts.milestone8` and
`config/milestone8-*` implementation identifiers. Those identifiers remain
stable for reproducibility even though the feature now belongs to Milestone 3.

## Personal Finance dashboard evidence

### Delivered boundaries

- One encrypted, append-only `finance-account` event stream per wallet-backed user.
- Income and expense categories with direction validation.
- Integer-cent USD transactions and compensating void events; persisted events are never edited in place.
- Per-record `ArchiveX` action buttons for active transactions, budgets, and recurring items. Voiding a transaction requires an audit reason; removing a budget or deactivating a recurring item requires explicit confirmation before appending its compensating event.
- Monthly category budgets with exact basis-point utilization and `on_track`, `near_limit`, or `over_budget` alerts.
- Monthly recurring income and expense entries. A linked transaction satisfies a recurring entry for that month so projected savings does not double count it.
- Read-only receivable and payable projections. Only the application-only confirmed-contract method can append obligation events, and every such event requires a source event ID and ResContract receipt.
- A deterministic reducer that rebuilds categories, transactions, budgets, recurring entries, obligations, balances, and savings from the event stream.
- A built-in catalog available without setup events: `Salary`, `Liquid Funds Transfer`, and `Other Sources` for income; `Rent`, `Utilities`, `Shopping`, `Entertainment`, `Food & Groceries`, `Medical Bills`, and `Miscellaneous` for expenses. The dashboard no longer exposes category creation.
- Authenticated `/api/v1/finance` endpoints with generated TypeScript types, RFC 9457 errors, optimistic aggregate versions, and required idempotency keys on writes.
- An accessible `/finance` dashboard with a cash-flow chart, text equivalents, budget progress, validation, empty/loading/error states, responsive tables, and a shared two-column Data Freshness and Provenance panel as the only user-facing location for Finance formula, calculation, event, and projection identifiers alongside Savings Insights provenance.
- Ledger-driven analytics using three distinct chart types for category spending, a step-area path of running ledger balance by day within the reporting month, and exactly six reporting months of income, expenses, and available savings. The savings history uses the existing monthly calculation, including recurring entries and open obligations, rather than a market or AI forecast. Budget utilization remains on the planning progress bars, not as an analytics chart.
- React Hook Form and Zod validation, TanStack Query state management, Recharts visualization, React Router navigation, Vitest coverage, and a checked Chromium Playwright journey.

### Record correction workflow

The dashboard provides deletion-like usability without deleting ledger history:

1. The user selects the orange `ArchiveX` action button beside an active transaction, monthly budget, or recurring item.
2. The dashboard explains the calculation impact and that the original record will remain in the append-only audit trail.
3. Voiding a transaction requires a reason of up to 160 characters. Removing a budget or deactivating a recurring item requires an explicit confirmation.
4. The browser sends the current projection version and a unique idempotency key to the existing authenticated `/api/v1/finance` correction endpoint.
5. The backend appends `finance.transaction-voided`, `finance.budget-deactivated`, or `finance.recurring-entry-deactivated`, referencing the original source event. It never edits or removes the original event.
6. Finance views are rebuilt and all visible monthly summaries, budgets, analytics, and savings calculations refresh from the new projection.

Only user-entered active transactions, budgets, and recurring entries expose these actions. Contract-backed receivables and payables remain controlled by confirmed ResContract state and cannot be voided from the Finance dashboard.

### Versioned savings formula

The Crypto Intelligence dashboard will consume the Finance-owned formula version `finance-savings-v1`.

```text
actual savings
  = recorded monthly income - recorded monthly expenses

projected savings
  = actual savings
  + unmatched active monthly recurring income
  - unmatched active monthly recurring expenses
  + open receivables due in the month
  - open payables due in the month

available savings = max(0, projected savings)
```

Every response includes the formula version, deterministic calculation ID, projection version, freshness timestamp, and source event IDs. The dashboard confines these technical values to its Data Freshness and Provenance panel so users can inspect the exact inputs behind their savings summary without crowding the primary financial view. Money remains integer USD cents throughout the backend and API. The browser converts validated decimal text to cents without binary-floating-point monetary arithmetic.

### Real-stack acceptance

The checked runner appended two categories, income, an expense, a budget, a recurring expense, a confirmed payable, and a confirmed receivable to the real ResilientDB stack. It proved an idempotent retry, restarted all four replicas and the client proxy, rebuilt the projection from encrypted events, and reproduced the exact result:

- Income: `500000` cents
- Expenses: `90000` cents
- Balance and actual savings: `410000` cents
- Outstanding recurring expense: `150000` cents
- Payable: `20000` cents
- Receivable: `30000` cents
- Projected and available savings: `270000` cents
- Budget utilization: `9000` basis points, `near_limit`
- Projection version: `8`

The sanitized record is [`config/milestone3-local-attestation.json`](../../config/milestone3-local-attestation.json).

The rebuilt FastAPI container also passed a live wallet-authenticated Finance flow through its pinned native ResilientDB client: category creation `201`, idempotent duplicate `201`, overview `200`, and invalid access token `401`.

### Verification

The 2026-10-19 dashboard update added Vitest request-boundary coverage and a Chromium Playwright flow that confirms both dialogs, verifies the void reason and optimistic projection versions sent to the API, and proves the corrected transaction and recurring item disappear from active calculations after the projection refresh.

The 2026-10-23 follow-up extended the same generated-client and Playwright coverage to budget deactivation, including confirmation, optimistic versioning, projection refresh, and removal from active guardrails while preserving the source budget event.

The dashboard presentation follow-up grouped finance entry and monthly review into one labelled activity section, placed explanatory copy directly beneath its section titles, simplified the entry accordion to one yellow boundary, applied the red/yellow/teal palette to budget progress, standardized guide typography, and aligned the shared notification bell with the yellow status color.

```bash
.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/pytest
.venv/bin/python -m scripts.generate_openapi
docker compose config --quiet

cd client
npm ci
npm run generate:api
npm run check
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Real ResilientDB and live API acceptance:

```bash
docker compose --profile tools up -d --build \
  resdb-1 resdb-2 resdb-3 resdb-4 resdb-proxy resdb-tools
.venv/bin/python -m scripts.milestone3.run_finance_acceptance \
  --output config/milestone3-local-attestation.json

docker compose --profile app up -d --build api
.venv/bin/python -m scripts.milestone3.run_http_finance_acceptance
```

## Smart Insights (read-only AI) evidence

Smart Savings Insights is embedded in Personal Finance. It explains authorized
Finance, Groups, and Crypto Intelligence facts without access to private keys, write
commands, ResContract mutations, trading systems, direct ResilientDB
operations, or the public internet.

### Evidence-bound design

The authenticated application service assembles a content-addressed fact bundle
from the existing Finance, Groups, and Portfolio read models. Facts contain a
stable fact ID, topic, human-readable statement, source kind, immutable source
IDs, and an as-of timestamp. Group facts include only groups for which the
wallet is an active member and obligations involving that wallet.

The local instruction model does not author the final response. It may select
one through four relevant fact IDs and report a confidence value. The server:

- rejects unknown, duplicate, off-topic, or low-confidence selections;
- renders the final summary directly from the validated fact statements;
- returns the exact evidence objects used;
- adds deterministic caveats and allowlisted follow-up questions; and
- falls back to a deterministic selector when the model or weights are
  unavailable.

This makes the factual output closed over the authorized bundle: generated text
cannot introduce a financial claim that lacks a supplied fact ID.

### Refusal and isolation controls

- Prompt-control phrases are treated as untrusted text and refused before model
  inference.
- Requests to buy, sell, transfer, settle, sign, approve, edit, delete, or
  otherwise act are refused before model inference.
- Unsupported topics return a bounded explanation and suggested supported
  questions.
- The question is limited to 500 characters.
- Runtime model loading is offline-only with `local_files_only=True` and
  `trust_remote_code=False`.
- The insights service has only read interfaces. Real-stack acceptance observed
  zero ResilientDB writes across overview, query, injection, prohibited-action,
  unsupported-topic, and cross-wallet checks.

### Pinned local model and benchmark

The selected model is `Qwen/Qwen2.5-1.5B-Instruct` at revision
`989aa7980e4cf806f80c7fef2b1adb7bc71aa306`, licensed Apache-2.0. Runtime and
generation policy pins plus SHA-256 hashes for the weights, configuration, and
tokenizer configuration are recorded in
[`config/milestone8-model-lock.json`](../../config/milestone8-model-lock.json).

On the local ARM64 acceptance machine with Python 3.13.2, PyTorch 2.14.1, and
Transformers 4.57.6, two deterministic selections returned only the permitted
budget fact with confidence 1.0. Cold selection took 10.04 seconds, the repeated
selection took 4.46 seconds, and measured resident-memory growth was about 3.12
GB. These figures are local feasibility evidence, not a production latency or
capacity claim. Full evidence is in
[`config/milestone8-model-benchmark.json`](../../config/milestone8-model-benchmark.json).

### API and interface

- `GET /api/v1/insights/overview?month=YYYY-MM` returns the fact-bundle ID,
  initial insight, evidence, caveats, follow-ups, and notifications.
- `POST /api/v1/insights/query` computes a read-only answer and appends no event.
- The generated `/api/v1` TypeScript client is the browser's only data path.
- Smart Savings Insights is embedded below the Personal Finance dashboard in an equal-width two-column
  question-and-answer workspace and displays the answer, generation mode, explicit completion feedback,
  a bounded 30-second request with a retry message, a yellow verified-fallback badge,
  compact horizontal evidence and caveat grids, follow-up questions, and a Data
  Freshness and Provenance panel. Fact-bundle and model-revision values are
  presented beside Finance projection details in one two-column panel as inspectable provenance tags;
  evidence bullets use plain-language verified-record counts.
- The shared notification center surfaces budget alerts, wallet-scoped Group
  updates, and the current Crypto Intelligence forecast gate with links to the relevant
  dashboard.

### Acceptance evidence

The real four-replica ResilientDB acceptance is recorded in
[`config/milestone8-local-attestation.json`](../../config/milestone8-local-attestation.json).
It verified:

- all returned citations belonged to the authenticated fact bundle;
- prompt injection, prohibited actions, and unsupported questions were refused;
- another wallet could not see the seeded wallet's savings;
- budget and Crypto Intelligence gate notifications were produced;
- the actual pinned local model completed evidence selection; and
- the AI path performed zero ResilientDB writes.

The Chromium journey also exercised the embedded Smart Savings Insights section, evidence display,
plain-language verified-record counts, notification count, refusal state,
responsive layout, and the Data Freshness and Provenance panel. The rendered
screenshot was visually inspected.

### Verification

```bash
.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/pytest

cd client
npm run generate:api
npm run check
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

The exact model and real-stack commands are listed in the
[`Milestone 7 local operator guide`](../local-operator-guide.md). Model
weights stay outside Git and are mounted read-only for local runtime.

### Historical acceptance boundary

At the original integration acceptance, no forecasting model was promoted, so Insights
correctly explained the Crypto Intelligence gate rather than inventing a recommendation.
Milestone 7 Local Handoff later completed the local lifecycle and promoted a distinct
predeclared forward candidate; that later evidence does not change Milestone
3's read-only AI boundary. Milestone 8 remains explicitly on hold. This evidence
does not establish cloud, production, commercial, BFT, or
investment-performance readiness.

This evidence is local-development acceptance. It does not claim cloud,
production, commercial, custody, trading, investment-advice, or independent
Byzantine fault-domain readiness. Group creation and contractual settlement
remain Milestone 4; cross-dashboard delivery remains Milestone 7.

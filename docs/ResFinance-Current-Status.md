# ResFinance Current Status

Last updated: 2026-11-17

ResFinance uses the eight-milestone convention in
[`milestones/milestones.md`](milestones/milestones.md). Milestones 1–7 are complete for the
declared local development and non-commercial research scope. Milestone 8 is on
hold. Local completion does not establish cloud, production, commercial,
custody, trading, investment-advice, or independent-BFT readiness.

On 2026-10-24, the project owner finalized and accepted the ResWallet
functionality and Personal Finance dashboard for the declared local-development
scope. No remaining owner-side functionality or presentation tasks are tracked
for those two areas.

## Milestone 1: ResFinance Foundation — Architecture, Feasibility Gate & Platform Foundation

**Status:** Complete for local development and feasibility.

- Defined the architecture, REST, security, research, storage, and repository
  boundaries.
- Pinned ResilientDB, ResContract, the upstream ResVault audit reference,
  ResWallet dependencies, compilers, language runtimes, and model revisions.
- Passed all seven feasibility gates, including four-replica persistence and
  failure behavior, a verified 100 MiB artifact round trip, persistent
  ResContract execution, signed settlement, key-isolation boundaries, provider
  coverage, and failure enforcement.
- Delivered the React/Vite client foundation, FastAPI modular monolith,
  generated `/api/v1` client contract, encrypted append-only event and blob
  repositories, deterministic idempotency, projection rebuilds, and the local
  four-replica ResilientDB topology.
- Real-stack acceptance passed encrypted write, deduplication, full restart,
  readback, and deterministic projection rebuild without another database.
- The upstream ResVault audit failed the required custody boundary and led to
  the custom ResWallet design completed in Milestone 2.

Evidence:
[`milestones/milestone1-resfinance-foundation.md`](milestones/milestone1-resfinance-foundation.md).

## Milestone 2: ResWallet — Custom Hardened ResVault & Wallet Authentication

**Status:** Finalized and project-owner accepted for local development.

- Delivered the custom Manifest V3 ResWallet extension with Argon2id and
  AES-256-GCM seed protection, memory-only unlocked secrets, exact-origin
  messaging, extension-owned approvals, and background-only Ed25519 signing.
- Implemented challenge login, memory-only access tokens, HttpOnly refresh
  cookies, ResilientDB-backed session hashes, rotation, replay protection,
  revocation, and logout.
- Trusted pointer, keyboard, touch, and wheel activity in a visible ResFinance
  tab now extends the five-minute ResWallet inactivity window without accepting
  page-generated heartbeats. Open authenticated tabs rotate their access token
  before expiry through a single-flight refresh; reloads still require explicit
  wallet approval, and refresh failure returns to the login screen.
- Opening the local client checks only public ResWallet status. It does not
  restore a dashboard from a refresh cookie: each visit requires an explicit
  **Connect Wallet** selection and fresh ResWallet challenge approval.
- Verified tamper, expiry, origin, network, replay, and locked-wallet defenses
  against the local stack, including restart persistence.
- Refined the wallet login and extension experience with ResFinance branding,
  a labeled public address, inline setup guidance, toolbar approval in the same
  browser window, live locked/unlocked status, Enter-key submission, visible
  wrong-password feedback, and a blinking locked-state indicator.
- Project-owner acceptance on 2026-10-24 closed the remaining ResWallet
  functionality and presentation tasks for the local-development scope.

Evidence:
[`milestones/milestone2-reswallet-wallet-authentication.md`](milestones/milestone2-reswallet-wallet-authentication.md).

## Milestone 3: Personal Finance — Dashboard & Smart Insights (Read-only AI)

**Status:** Finalized and project-owner accepted for local development.

- Delivered encrypted append-only Finance records, the fixed category catalog,
  income and expenses, budgets, recurring entries, compensating corrections,
  contract-backed receivables/payables, exact integer-cent summaries, and the
  versioned `finance-savings-v1` calculation.
- Added the authenticated Personal Finance dashboard, ledger-driven analytics,
  accessible states and charts, correction workflows, and consolidated data
  freshness and provenance.
- Added confirmed `ArchiveX` correction actions for active transactions,
  budgets, and recurring items. They append void/deactivation events and
  preserve the original audit record instead of deleting persisted history.
- Made the fixed direction-aware category catalog available immediately to new
  wallets and removed the category-creation step. Dashboard analytics cover
  category spending, a step-area running balance path by day within the month,
  and an exact six-month income, expense, and available-savings history.
  Budget utilization stays on the planning progress bars.
- Embedded Smart Savings Insights inside Personal Finance using
  wallet-authorized fact bundles, evidence-ID validation, deterministic
  fallback, bounded local-model selection, prompt-injection defenses, and
  prohibited-action refusals.
- Verified that the AI path is read-only and performs no ResilientDB writes,
  wallet signing, settlement, trading, or Finance mutation.
- Refined the Personal Finance presentation with a single three-form accordion,
  a compact row for cash flow, transactions, budgets, and commitments, and a
  bulleted dashboard guide that color-codes and explains actual, projected, and
  available savings.
- Added consistent section hierarchy for financial activity, trends, and Smart
  Savings Insights; simplified the entry accordion to one enlarged yellow
  boundary; applied the red, yellow, and teal theme palette to budget bars; and
  normalized the dashboard-guide body typography.
- Refined the embedded Insights workspace with balanced question and answer
  panels, exactly three suggested-question actions with lightbulb cues,
  width-efficient evidence and caveat grids, a yellow verified-fallback badge,
  explicit completion feedback, and a bounded 30-second request with retry
  guidance.
- Finalized the dashboard charts with viewport-timed entrance motion,
  visible budget-bar fills, an emphasized running-balance path, consistent
  title casing, and reduced-motion handling; expanded the dashboard guide to
  explain monthly review, append-only corrections, and read-only Insights.
- Replaced the browser-native Reporting month popup with an accessible,
  keyboard-dismissible in-app month picker. Its dark menu uses the existing
  teal October-control palette, supports year navigation and a current-month
  shortcut, and leaves the other dashboard month controls unchanged.
- Aligned Cash flow, Recent Transactions, and Budgets & Commitments to the
  compact Cash flow panel height. The transaction ledger and planning content
  now scroll independently when they exceed their panels.
- Applied the same persistent amber scroll track and thumb to both the
  transaction ledger and the Budgets & Commitments panel.
- Project-owner acceptance on 2026-10-24 closed the remaining Personal Finance
  functionality and presentation tasks for the local-development scope.

Evidence:
[`milestones/milestone3-personal-finance-smart-insights.md`](milestones/milestone3-personal-finance-smart-insights.md).

## Milestone 4: Bill Split — Friends, Groups & Contractual Settlement

**Status:** Complete for local development.

- Delivered friends/groups, exact expense splits, participant decisions signed
  by ResWallet, obligation notifications, and the deployed
  `ResFinanceSettlement.sol` state machine.
- Implemented non-redeemable internal credits, partial and full settlement,
  immutable receipts, Finance propagation, and crash-safe reconciliation.
- Verified tamper and replay rejection and matching Group/Finance balances
  after a full ResilientDB and ResContract restart.
- Confined Group projection version, encrypted source-event count, and update
  time to the Data Freshness and Provenance footer.
- Reorganized the Friends & Groups dashboard around a Personal Finance-style
  hero, summary cards, a collapsible Update the group section, and filtered
  activity tabs that initially show three records and reveal more on demand.
  Signing and settlement behavior is unchanged.
- Matched the Friends & Groups hero typography and responsive header layout to
  Personal Finance, and added an accessible in-app guide covering group setup,
  splits, signed approvals, internal-credit settlement, receipts, and the
  non-monetary settlement boundary.
- Redesigned the cross-group balance space as a two-column network overview:
  group and connection counts, funded internal credits, and effective net
  payables/receivables sit beside one signed, color-coded list of every
  counterparty. This presentation does not alter obligation or settlement
  state.

Evidence:
[`milestones/milestone4-bill-split-contractual-settlement.md`](milestones/milestone4-bill-split-contractual-settlement.md).

## Milestone 5: Crypto Intelligence — Crypto Ingestion, Feature Store & Reproducible ML Research

**Status:** Complete for local, non-commercial research mechanics.

- The active system ingests completed Coin Metrics BTC/ETH/SOL daily prices,
  with provenance-complete, idempotent ResilientDB records.
- The retained Phase 1 experiment compares the clean-room Original
  MSPCIFormer and VASA-MSPCIFormer on direct seven-day prices. Validation
  selected the original model for the current forecast artifact.
- The fixed-PST daily market refresh adds the latest completed market day; the
  dashboard uses the saved checkpoint for inference-only refreshes and labels
  incomplete coverage as stale.
- The prior multimodal financial/blockchain/social pipeline and naïve baseline
  are retired. Its dated evidence remains archived and is not active product
  behavior.

Evidence:
[`milestones/milestone5-crypto-intelligence-research.md`](milestones/milestone5-crypto-intelligence-research.md).

## Milestone 6: Crypto Intelligence — Risk & Portfolio Dashboard

**Status:** Complete for the active local seven-day research workflow. The
earlier 15-day questionnaire/capped workflow remains immutable legacy evidence.

- Connected the verified validation-selected Phase 1 v2 checkpoint and saved
  preprocessing to a seven-day forecast API. A request reuses the checkpoint;
  it never retrains. Newer stored completed observations can trigger
  inference-only refresh, while unavailable inputs fail explicitly and old
  dates remain visibly stale.
- The encrypted, append-only `risk-questionnaire-v3` now scores liquidity
  needs inversely: `100 × (horizon + tolerance + (4 - liquidity)) / 9`,
  rounded to the nearest whole number. Higher liquidity needs therefore reduce
  the risk score. Historical v1 and v2 records remain auditable but require a
  fresh v3 response before a portfolio recommendation. The questionnaire chooses
  Conservative, Balanced, or Growth strategic BTC/ETH/SOL/USD-cash targets.
  Fixed-lambda seven-day mean-variance optimization uses raw Day-7 predicted
  returns and 365 aligned daily returns with Ledoit-Wolf covariance. The
  forecast affects only the selected crypto sleeve through its held-out
  calibration confidence; the questionnaire fixes cash and total crypto
  exposure. There is no arbitrary percentage-point tactical tilt cap.
- CLARABEL and SCS solve the same objective. Total solver failure is explicit;
  there is no equal-weight or minimum-variance substitution. Crypto and cash
  USD cents reconcile to 100% and the exact entered capital.
- Replaced the active Crypto Intelligence page with BTC/ETH/SOL overview cards,
  a seven-day P10/P50/P90 chart and a P10–P90 **Historical Error Range** derived
  from the selected model's immutable held-out residuals, a USD capital input
  defaulted from the current month's Personal Finance available savings, an
  allocation donut/table, model error, provenance, freshness warnings,
  methodology, and responsive light/dark presentation. An edited capital value
  remains a read-only scenario. The Historical Error
  Range summarizes past held-out error; it is not a validated 80% prediction
  interval, is visualization-only, and does not affect the optimizer's existing
  point-forecast inputs. No trading control exists.
- Consolidated the allocation and calculation-methodology views into one
  responsive Portfolio Allocation panel. The allocation donut, exact-cent
  table, metrics, research disclaimer, four methodology steps, and model facts
  remain visible; historical accuracy and provenance continue in the adjacent
  disclosure.
- Refined the Crypto Intelligence presentation: the capital card now pairs its
  **Investment Capital** label with **Savings from Personal Finance**, while
  the allocation donut uses the center label **Allocation Breakdown** and
  consistently readable static asset labels.
- The executed v4 $1,000 Balanced-profile result fixes $200 cash and starts
  from $250 BTC / $400 ETH / $150 SOL. Its 3.39067511% model confidence
  produces $267.20 BTC / $386.44 ETH / $146.36 SOL / $200 cash, with
  0.32404561% predicted return and 5.82373217% estimated seven-day volatility.
  Evidence is in
  [`config/crypto-intelligence/phase2-risk-profile-model-blend-v4-2026-11-14.json`](../config/crypto-intelligence/phase2-risk-profile-model-blend-v4-2026-11-14.json).

Evidence:
[`milestones/milestone6-crypto-intelligence-dashboard.md`](milestones/milestone6-crypto-intelligence-dashboard.md).

## Milestone 7: Deliverables — Cross-dashboard Integration & Local Handoff

**Status:** Complete for the declared local development and research scope.

- Completed shared navigation, wallet-scoped notifications, theme and session
  behavior, provenance presentation, and the connected Finance → Groups →
  Crypto Intelligence → Smart Insights journey.
- The authenticated header keeps Personal Finance, Friends & Groups, and
  Crypto Intelligence as the three primary tabs. Both the header and welcome
  screen place Medium before the repository link and theme control; the header
  also includes notifications and logout. New sessions default to Dark Mode,
  explicit Light Mode preferences persist, and brand selection or logout
  returns to the ResWallet welcome screen.
- Added bounded preflight, start, status, restart, logs, stop, and confirmed
  reset operations; explicit ingestion and reconciliation workers; an operator
  guide; and a continuous real two-wallet Chromium journey over ResWallet,
  FastAPI, four ResilientDB replicas, and ResContract.
- Pinned CI to Ubuntu 24.04 and commit-pinned Node 24 GitHub actions after the
  `ubuntu-latest` Ubuntu 26.04 migration dropped the pinned Python toolcache and
  broke Playwright installation. A repository pre-push hook now mirrors CI to
  catch formatting, type, test, build, browser, and security failures locally.
- Prepared a merge-to-main daily Crypto Intelligence workflow for a dedicated
  self-hosted macOS ARM64 runner. At 6:00 AM fixed PST it uses the previous PST
  date as the complete provider cutoff, retains raw research state in
  ResilientDB, uploads the bounded evidence, and commits one dated JSON record
  under `config/crypto-intelligence/`. Activation still requires the runner,
  repository variable, main-branch write policy, and workflow to exist on
  `main`; no production or cloud deployment is introduced.
- Added a macOS login/wake catch-up dispatcher for the daily workflow. After
  6:00 AM fixed PST, it queries `main` for the dated evidence and same-day
  workflow run before dispatching at most one missed job; GitHub Actions still
  performs the research and evidence commit. The workflow also makes a late
  duplicate delivery a successful no-op once the dated evidence exists. The
  dispatcher requires a Keychain-backed GitHub CLI login on the runner account.
- Retired the prior Paper 2 workflow and its legacy snapshot path. The current
  scheduler records only completed BTC/ETH/SOL market observations for
  inference-only forecast refreshes.
- Retained VASA and the original clean-room MSPCIFormer comparison, alongside
  the wallet-scoped risk profile and read-only Insights behavior.

Evidence:
[`milestones/milestone7-cross-dashboard-local-handoff.md`](milestones/milestone7-cross-dashboard-local-handoff.md)
and
[`local-operator-guide.md`](local-operator-guide.md).

## Milestone 8: Future Scope — Production Hardening & Deployment (On Hold)

**Status:** On hold.

- No cloud infrastructure, production pipeline, or production-readiness claim
  is authorized.
- Resumption requires a separate ResilientDB cloud feasibility review and an
  approved ADR covering networking, persistent storage, restart recovery,
  replica failure, failure domains, operations, key management, backups,
  observability, and deployment automation.
- Local development, integration, research, security, browser, accessibility,
  load, and chaos testing remain in scope.

Evidence:
[`milestones/milestone8-production-hardening-deployment.md`](milestones/milestone8-production-hardening-deployment.md).

## Maintenance rule

Update this file whenever a pushed change materially alters milestone scope,
status, user-visible behavior, verification evidence, readiness, or known
limitations. Keep the root README focused on the product, architecture,
boundaries, setup, repository layout, and links to current status and evidence.

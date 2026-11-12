# ResFinance

ResFinance is a locally implemented wallet-authenticated finance platform that
connects personal budgeting, shared expenses, and explainable BTC/ETH/SOL
portfolio analysis through one auditable financial record.

The ResWallet experience and Personal Finance dashboard are finalized and
project-owner accepted for the declared local-development scope. This does not
lift the cloud and production deployment hold.

For milestone progress and current readiness, see [`docs/ResFinance-Current-Status.md`](docs/ResFinance-Current-Status.md).
The canonical eight-milestone convention is defined in [`docs/milestones/milestones.md`](docs/milestones/milestones.md).

## Product journey

```text
Earn → Spend → Split → Settle → Update Finance → Calculate Savings → Explore BTC/ETH/SOL → Forecast → Assess Risk → Build Portfolio
```

A user connects ResWallet, manages personal finances, splits expenses with
friends, approves contractual settlements, and uses the resulting savings as
the default amount for a risk-aware crypto portfolio analysis.

## Product areas

| Personal Finance | Friends & Groups | Crypto Intelligence |
| --- | --- | --- |
| <ul><li>Record income, expenses, budgets, and recurring items with a fixed, direction-aware category catalog.</li><li>Track contract-confirmed receivables and payables from shared expenses.</li><li>Review any period with an in-app, keyboard-accessible Reporting month picker.</li><li>Keep Cash flow, transactions, and planning panels aligned while long records scroll with matching visible rails.</li><li>View cash-flow summaries, budget alerts, and actual or projected savings.</li><li>Receive practical, evidence-linked Smart Savings Insights.</li><li>Preserve append-only audit history through compensating corrections.</li></ul> | <ul><li>Create groups and add shared expenses, choosing which members share each expense and splitting it equally or by exact amounts.</li><li>Require each participant to approve or reject obligations with ResWallet.</li><li>Settle with internal, non-redeemable credits and immutable receipts.</li><li>Reflect confirmed obligations and settlements back into Personal Finance.</li></ul> | <ul><li>Analyze <strong>BTC, ETH, and SOL only</strong> using point-in-time market, sentiment, and on-chain data.</li><li>Review eligible forecasts with uncertainty, freshness, and provenance.</li><li>Complete a risk questionnaire and receive an explainable long-only portfolio.</li><li>Reconcile integer-cent allocations exactly to Finance savings or a separate non-mutating scenario amount.</li></ul> |

## Architecture

| Component | Role |
|---|---|
| React, TypeScript, and Vite | Shared interface for Personal Finance, Friends & Groups, and Crypto Intelligence |
| FastAPI REST API | Authentication, validation, business rules, orchestration, and `/api/v1` |
| Apache ResilientDB | Only persistent store for application events, research data, forecasts, and artifacts |
| ResWallet | Extension-held identity, local key custody, login signing, and explicit action approval |
| ResContract | Authoritative obligation, settlement-credit, and receipt transitions |
| Ingestion and ML workers | Provider collection, reproducible research, forecasts, and evaluation |
| Read-only AI | Evidence-linked explanations without write, wallet, settlement, or trading authority |

The application uses append-only, schema-versioned events; deterministic and
idempotent writes; encrypted sensitive payloads; rebuildable projections; and
freshness/provenance records for meaningful outputs. Browser code reaches
application services only through the generated `/api/v1` REST client.

## Product boundaries

- Apache ResilientDB is the sole persistent application and research database.
- USD is the only V1 fiat denomination; money uses integer cents.
- Crypto support is exactly `BTC | ETH | SOL`.
- ResWallet seeds and private keys never leave the extension. Its five-minute
  inactivity lock is extended only by trusted interaction in a visible
  ResFinance tab, while an authenticated open tab renews its short-lived API
  access token without restoring login after a reload.
- ResContract is authoritative for obligations and settlement state.
- Internal settlement credits are non-redeemable and non-monetary.
- ResFinance does not transfer fiat or native cryptocurrency, execute trades,
  provide exchange custody, guarantee returns, or provide investment advice.
- Scenario analysis and AI are read-only and cannot mutate Finance or invoke
  wallet, settlement, or trading operations.
- Cloud and production deployment remain on hold.

## Repository layout

```text
client/        React and TypeScript application
reswallet/     ResWallet browser extension
server/        FastAPI API, domain services, adapters, and workers
blockchain/    ResContract contracts, gateway adapter, wallet work, and tests
ml/            Data, features, forecasting, evaluation, and portfolio optimization
requirements/  Pinned Python dependency sets for development and runtime areas
tests/         Contract, integration, and end-to-end tests
docs/          Product, architecture, milestone evidence, and development references
```

## Documentation

- [ResFinance overview on Medium](https://medium.com/@haseebshaik00/resfinance-57064e9a54ef)
- [Product Specification](docs/project-spec.md)
- [Architecture and Implementation Plan](docs/architecture-implementation-plan.md)
- [Local Demo Runbook](docs/local-demo-runbook.md)
- [Local Operator Guide](docs/local-operator-guide.md)
- [REST API Contract](docs/rest-api-contract.md)
- [Security Contract](docs/security.md)
- [Research Protocol](docs/research-protocol.md)
- [Provider coverage and terms review](docs/provider-terms-review.md)
- [ResilientDB ecosystem development references](docs/development-references.md)
- [Canonical Milestone Convention](docs/milestones/milestones.md)
- [Milestone Evidence](docs/milestones/)
- [Current milestone status](docs/ResFinance-Current-Status.md)
- [Repository instructions for coding agents](AGENTS.md)

## Before pushing

GitHub Actions uses a pinned Ubuntu 24.04 runner and commit-pinned action
revisions so `ubuntu-latest` migrations do not silently change the toolchain.
Enable the repository's pre-push hook once per clone to run the same backend,
client, browser, and ResWallet checks before remote CI:

```bash
git config core.hooksPath .githooks
```

The checks can also be run directly with `./scripts/verify_ci.sh`.

After it is merged to `main` and a dedicated local runner is registered, the
daily Crypto Intelligence workflow runs at 6:00 AM fixed PST, persists the
research state in ResilientDB, and commits dated evidence JSON under
`config/crypto-intelligence/`. Runner setup and failure behavior are documented
in the [Local Operator Guide](docs/local-operator-guide.md#daily-crypto-intelligence-forward-completion).

## Contributors

- [Shaik Haseeb Ur Rahman](https://github.com/haseebshaik00)
- [Anish Kataria](https://github.com/AnishK10)

## License

See [LICENSE](LICENSE) for the repository license.

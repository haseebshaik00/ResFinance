# ResFinance

ResFinance is a locally implemented wallet-authenticated finance platform that
connects personal budgeting, shared expenses, and explainable BTC/ETH/SOL
portfolio analysis through one auditable financial record.

Local implementation is complete for Milestones 1–7: ResWallet, Personal
Finance, Friends & Groups, Crypto Intelligence, cross-dashboard integration,
and the local operator handoff. The project remains limited to its declared
local-development and non-commercial research scope. This does not lift the
cloud and production deployment hold.

For milestone progress and current readiness, see [`docs/ResFinance-Current-Status.md`](docs/ResFinance-Current-Status.md).
The canonical eight-milestone convention is defined in [`docs/milestones/milestones.md`](docs/milestones/milestones.md).

## What it does

- **Personal Finance:** append-only income, expenses, budgets, recurring items,
  savings, and evidence-linked read-only insights.
- **Friends & Groups:** exact shared-expense splits, ResWallet-approved
  obligations, non-redeemable internal-credit settlement, and Finance updates.
- **Crypto Intelligence:** BTC/ETH/SOL-only seven-day research forecasts and
  read-only allocation scenarios based on available savings.

## Architecture

![ResFinance architecture and data flow](docs/images/resfinance-architecture-data-flow.png)

The React client communicates only with the FastAPI `/api/v1` service.
ResWallet holds keys and approves actions; ResContract is authoritative for
settlement; Apache ResilientDB is the sole persistent application and research
store. Events are encrypted where sensitive, append-only, schema-versioned,
idempotent, and reducer-rebuildable.

## Scope and safety

- USD is the only V1 fiat denomination; money is stored as integer cents.
- Crypto support is exactly `BTC | ETH | SOL`.
- Seeds and private keys never leave ResWallet; contract-affecting actions need
  explicitly approved, backend-verified signed intents.
- Internal credits are non-redeemable and non-monetary. ResFinance does not
  transfer fiat or cryptocurrency, trade, custody assets, or provide investment advice.
- Scenario analysis and AI are read-only; cloud and production deployment remain on hold.

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
- [Active MSPCIFormer VASA two-model protocol](docs/research/mspciformer-vasa-phase1-v2.md)
- [Seven-day portfolio recommendation](docs/research/phase2-seven-day-portfolio.md)
- [ResFinance Research Flow (PDF)](docs/research/ResFinance-Research-Flow.pdf)
- [ResFinance MSPCIFormer Research (PDF)](docs/research/ResFinance-MSPCIFormer-Research.pdf)
- [Provider coverage and terms review](docs/provider-terms-review.md)
- [ResilientDB ecosystem development references](docs/development-references.md)
- [Canonical Milestone Convention](docs/milestones/milestones.md)
- [Milestone Evidence](docs/milestones/)
- [Current milestone status](docs/ResFinance-Current-Status.md)
- [Repository instructions for coding agents](AGENTS.md)

## Verification

Enable the pre-push hook once per clone to run the backend, client, browser,
and ResWallet checks locally:

```bash
git config core.hooksPath .githooks
```

You can also run `./scripts/verify_ci.sh` directly. Local startup, scheduled
market refresh, and recovery procedures are in the [Local Operator Guide](docs/local-operator-guide.md).

## Contributors

- [Shaik Haseeb Ur Rahman](https://github.com/haseebshaik00)
- [Anish Kataria](https://github.com/AnishK10)

## License

See [LICENSE](LICENSE) for the repository license.

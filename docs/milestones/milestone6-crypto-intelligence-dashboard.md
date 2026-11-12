# Milestone 6: Crypto Intelligence — Risk & Portfolio Dashboard

> Compatibility note: `scripts.milestone7` and `config/milestone7-*` remain
> stable legacy implementation identifiers for this Milestone 6 evidence.

Status: Complete for local development and synthetic acceptance. Cloud, production,
trading, custody, and investment-performance claims remain out of scope.

## Purpose

Milestone 6 turns the versioned Finance savings result into an evidence-bound,
risk-aware BTC/ETH/SOL portfolio analysis. It does not execute trades, transfer
fiat or cryptocurrency, or change Finance from a scenario.

## Implemented behavior

- A three-question `risk-questionnaire-v2` policy accepts 1 (low) through 3
  (high) for investment horizon, risk tolerance, and liquidity needs. It uses
  the nearest whole-number result of `100 × (horizon + tolerance + liquidity) /
  9`; each submitted profile is an encrypted, append-only, idempotent
  ResilientDB event. Historical v1 profiles remain in the event stream but
  require a fresh v2 response before a new portfolio recommendation is made.
- `portfolio-policy-v1` optimizes only BTC, ETH, and SOL. Weights are long-only,
  sum to one, and respect caps of 80% BTC, 60% ETH, and a score-dependent SOL
  cap from 10% through 35%.
- The optimizer uses a Ledoit-Wolf covariance estimate from aligned trailing
  daily prices, scales covariance to the 15-day horizon, and uses a 15-day,
  uncertainty-adjusted expected return.
- CVXPY runs CLARABEL first, SCS second, and a constrained minimum-variance
  portfolio if both primary solves fail. A nearest-positive-semidefinite repair
  protects the covariance input.
- Integer-cent allocation uses largest-remainder reconciliation so asset amounts
  exactly equal the supplied USD cents.
- Default capital comes directly from `finance-savings-v1`, retaining the
  deterministic savings calculation ID and immutable Finance source event IDs.
- `POST /api/v1/crypto/scenarios` analyzes another amount without appending an
  event or changing Finance, its calculation ID, or its default capital.
- Forecast snapshots are immutable, content-addressed records and are accepted
  only when their run, model, artifact, dataset, and promotion event agree.
- Expired forecasts fail closed. Synthetic acceptance forecasts are hidden by
  the normal runtime and require an explicit acceptance-only service flag.
- The generated `/api/v1` client powers the responsive Crypto Intelligence
  dashboard with the questionnaire, default capital, forecast status,
  constrained allocations, a Data Freshness and Provenance panel, a
  non-mutating scenario control, and TradingView Lightweight Charts
  price/P10/P50/P90 overlays. The Data Freshness and Provenance panel is the
  sole dashboard location for technical Finance formula/calculation IDs,
  source-event count, forecast snapshot ID, and promotion event ID; the rest of
  the dashboard uses plain-language labels.

## Milestone 6 promotion state

Milestone 5 promoted no model from its deterministic smoke candidate because it did not
beat the declared naive-baseline MAE criterion. Milestone 6 does not bypass that
decision. In the normal application, the Crypto Intelligence dashboard
displays a clear promotion-gate state and no recommendation until an eligible
forecast snapshot references a valid immutable promotion event.

The Milestone 6 acceptance runner injects a deterministic forecast fixture only
to test constraints. The fixture is labeled `local-synthetic-acceptance`, is not
stored as a research promotion, and is rejected by the normal runtime.

Milestone 7 later promoted a separate provider-backed forward candidate under
the unchanged criteria and published the first eligible normal-runtime
snapshot; it did not retroactively promote the Milestone 5 smoke candidate.

## API surface

- `GET /api/v1/crypto/overview?month=YYYY-MM`
- `POST /api/v1/crypto/risk-profile` with `Idempotency-Key`
- `POST /api/v1/crypto/scenarios`

All routes require a valid wallet access token and an approved browser origin.
Browser code uses only the generated REST contract.

## Verification

The checked-in attestation is
[`config/milestone7-local-attestation.json`](../../config/milestone7-local-attestation.json).
It records real four-replica ResilientDB acceptance for risk persistence and the
Finance source link, plus deterministic synthetic optimization checks.

Verified invariants include:

- risk-profile retries deduplicate;
- weights sum to one and respect every cap;
- default and scenario allocations reconcile to the exact input cents;
- the default carries the Finance savings calculation and source event IDs;
- the scenario leaves Finance byte-for-byte equivalent at the projection layer;
- stale forecasts are rejected;
- CLARABEL succeeds for the deterministic acceptance fixture;
- injected CLARABEL and SCS failures exercise the minimum-variance fallback;
- browser acceptance displays the promotion gate, saves a risk profile, renders
  forecast overlays, and reconciles the displayed allocation;
- the Crypto Intelligence dashboard was visually inspected from its Playwright screenshot.

Run the acceptance with:

```bash
.venv/bin/python -m scripts.milestone7.run_portfolio_acceptance \
  --output config/milestone7-local-attestation.json
```

The complete verification set also includes Ruff, strict mypy, Pytest, generated
OpenAPI verification, TypeScript, ESLint, Prettier, Vitest, Vite build,
Playwright, and Docker Compose configuration validation.

## Remaining boundary

Milestone 3 includes read-only, evidence-linked Smart Savings Insights, and
Milestone 7 finishes cross-dashboard integration. Neither may give the AI
write, wallet, settlement, or trading capabilities. Milestone 8 production and
cloud deployment remain on hold.

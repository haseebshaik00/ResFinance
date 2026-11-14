---
title: "ResFinance — Intelligent Finance on ResilientDB"
document_type: "Product, systems, implementation, and research plan"
status: "Review draft; cloud deployment on hold"
scope: "BTC, ETH, and SOL"
persistent_storage: "Apache ResilientDB only"
source_pdf: "/Users/haseebrahman/Downloads/ResFinance.pdf"
---

# ResFinance — Intelligent Finance on ResilientDB

> Two-page product, systems, and research plan | BTC + ETH + SOL | One persistent database

## 1. Four core pain points - each makes one technology necessary

| Pain point | Required technology | Why it is necessary |
|---|---|---|
| Fragmented Financial State | **ResilientDB** | Budgeting, expenses, shared balances, savings, and recommendations usually live in separate apps. ResilientDB becomes the shared source of truth, recording each meaningful event once and reflecting it across Personal Finance, Friends & Groups, and Crypto Intelligence. |
| Manual & Error-Prone Settlement | **Smart Contracts** | Bill splitting is more than arithmetic: participants, shares, receivables/payables, and settlement status must stay consistent. Smart contracts enforce the rules and `OPEN -> PARTIALLY SETTLED -> SETTLED` transitions, then update personal finance correctly. |
| Weak User Ownership of Transactions | **ResWallet** | Payments and settlements should not be silently executed by a central backend. ResWallet provides wallet-linked identity and user-controlled signing, so each payment or contract action is explicitly approved and remains auditable. |
| Disconnected Savings & Crypto Decisions | **Our ML Model** | Savings tools rarely turn real affordability into investment decisions. The model uses actual/projected savings, Smart Savings Insights, market + sentiment + on-chain signals, adaptive gating, and MSPCIFormer to produce a risk-aware BTC/ETH/SOL portfolio. |

## 2. Product integration gap

| Reference workflow | What it does | How ResFinance closes the gap |
|---|---|---|
| Budgeting apps | Track spending, goals, and monthly savings. | Savings becomes live input to Smart Savings Insights and the crypto portfolio engine. |
| Split-bill apps | Track who owes whom and support settlement. | One signed settlement updates group state, the shared ledger, and personal finance. |
| Crypto platforms | Show markets and support asset transactions. | Affordability + three-source forecasts + risk profile -> explainable BTC/ETH/SOL allocation. |

## 3. REST API architecture and single-storage design

```text
React / TypeScript Frontend
Personal Finance | Friends & Groups | Crypto Intelligence
                       |
                       v
FastAPI REST API
Auth + business rules + finance, groups, market, forecast,
risk, portfolio, and scenario endpoints
                       |
                       v
+------------------+  +------------------+  +------------------+
| Finance Service  |  | Groups Service   |  | Crypto Service   |
+------------------+  +------------------+  +------------------+
                       |
                       v
+----------------------+----------------------+------------------+
| Apache ResilientDB   | ResWallet             | Smart Contracts  |
+----------------------+----------------------+------------------+
```

### Service responsibilities

| Service | Responsibilities |
|---|---|
| Finance Service | Income, expenses, budgets, savings, and receivables/payables. |
| Groups Service | Splits, obligations, wallet approvals, and settlement state. |
| Crypto Service | BTC/ETH/SOL data, forecasts, risk, and optimized portfolios for the Crypto Intelligence dashboard. |

### Core infrastructure

| Component | Role |
|---|---|
| Apache ResilientDB | The only persistent layer for application events, market history, features, forecasts, models, and recommendations. |
| ResWallet | Wallet identity, user-controlled keys, signing, and explicit approvals. |
| Smart Contracts | Deterministic split, obligation, and settlement state transitions. |

### Storage rule

Apache ResilientDB is the only persistent database for application and ML/crypto data. Python with Pandas, Polars, and NumPy may process data in memory, but no Parquet or DuckDB persistence is used.

### Deployment status — on hold

Cloud and production deployment are deferred until a separate feasibility review proves that the pinned ResilientDB stack can operate safely in the selected environment. Current scope is local development, integration, research, and end-to-end validation. No cloud provider or production topology is currently approved.

## 4. Five-phase implementation plan

These implementation phases roll up into the canonical eight-milestone
convention in [`milestones/milestones.md`](milestones/milestones.md). Phase names describe delivery
flow; milestone names are the authoritative labels for planning and status.

### Phase 1 - Finance Foundation + Shared Ledger

Build wallet-linked profiles, income, expenses, budgets, receivables/payables, and actual/projected monthly savings. ResilientDB stores all financially meaningful events and the derived personal finance view.

### Phase 2 - Groups, ResWallet + Smart Contracts

Add equal/unequal splits, payer/share logic, reimbursements, and settlement. ResWallet signs actions; smart contracts manage obligations and status transitions; settlement updates Personal Finance.

### Phase 3 - BTC/ETH/SOL Data + REST AI Service

Ingest historical/live market, sentiment/NLP, and on-chain data for BTC, ETH, and SOL only. Persist raw data, features, and metadata in ResilientDB; use Pandas/Polars in memory; expose REST endpoints.

### Phase 4 - Research-Grade Forecasting Engine

Train baselines, implement MSPCIFormer, and add adaptive gating across market, sentiment, and on-chain inputs. Use walk-forward evaluation and ablations against market-only and fixed-weight fusion.

### Phase 5 - Risk Profiling, Portfolio Optimization + Full Local Integration

Combine forecasted returns, uncertainty, realized risk/covariance, liquidity, and downside risk with a continuous user risk score. Generate explainable BTC/ETH/SOL weights, backtest, and integrate the complete journey in the local validated environment. Deployment is a separate, deferred milestone and is not required to complete this phase.

### Final local delivery gate — Milestone 7: Deliverables — Cross-dashboard Integration & Local Handoff

After the functional phases, package the complete local stack behind one documented startup lifecycle and prove one continuous, non-mocked browser journey through ResWallet, React, FastAPI, ResilientDB, ResContract, Crypto Intelligence, and Smart Insights. The first provider-backed adaptive candidate remains rejected because its MAE was worse than naive. The approved completion iteration subsequently: (1) evaluated a validation-calibrated adaptive-gating candidate on the predeclared untouched forward period and passed the unchanged MAE and 70 percent coverage rules; (2) appended an immutable promotion only after that qualifying run; (3) ingested current point-in-time BTC/ETH/SOL data, froze the final model, and persisted a provenance-complete current 15-day forecast snapshot; (4) proved the normal live recommendation, exact-cent allocations, Finance-derived default savings, non-mutating scenario analysis, and fail-closed stale/corrupt/unpromoted behavior; and (5) repeated all local suites plus the real two-wallet restart journey. Milestone 7 is complete for the declared local scope. Production hardening and deployment remain a separate, deferred Milestone 8.

## 5. Forecasting research: 2 papers + 1 novelty

### Paper 1 - MSPCIFormer

**Citation:** Zhao, Crane & Bezbradica (2026)

Base multi-scale Transformer architecture for cryptocurrency forecasting.

### Paper 2 - Gurgul et al.

**Citation:** Gurgul et al. (2025)

Motivates multimodal inputs from markets, blockchain/on-chain data, and sentiment/news NLP.

### Our novelty - Adaptive Multi-Source Fusion/Gating

Dynamically weights market, sentiment, and on-chain information before forecasting.

**Model output:** Expected return, upside probability, and forecast interval. The model is evaluated with walk-forward tests and source/fusion ablations.

## 6. Crypto Intelligence behavior

### V1 scope: BTC + ETH + SOL only

The v1 cryptocurrency universe contains exactly three assets: Bitcoin, Ethereum, and Solana.

### Default capital = monthly savings

Actual/projected savings opens as the initial portfolio amount.

### Smart Savings Insights

Explains realistic ways to increase investable surplus from spending history and recurring patterns.

### Analyze Another Amount

Runs a separate what-if amount without changing Personal Finance or the saved financial record.

## 7. End-to-end user story

1. **Connect** - Alex connects ResWallet; the wallet becomes the signing identity.
2. **Track** - Income, expenses, and budgets create a live personal finance view.
3. **Split** - Alex pays a group bill; shares become obligations and receivables.
4. **Settle** - Friends sign payments; the contract updates group and ledger state.
5. **Save** - Updated actual/projected savings flows to Crypto Intelligence by default.
6. **Improve** - Smart Savings Insights suggests practical ways to save more.
7. **Explore** - Alex reviews BTC, ETH, and SOL data and three-source signals.
8. **Forecast** - Adaptive gating + MSPCIFormer produces research-grade forecasts.
9. **Assess** - A questionnaire creates a continuous risk score and constraints.
10. **Build** - The optimizer converts forecasts + risk into BTC/ETH/SOL weights.
11. **Override** - Analyze Another Amount runs a what-if without altering savings.
12. **Monitor** - Forecasts, risk, and allocations refresh; provenance stays auditable.

### Complete product story

Earn -> Spend -> Split -> Settle -> Update Personal Finance -> Save -> Improve Savings -> Explore BTC/ETH/SOL -> Forecast -> Assess Risk -> Build Portfolio -> Monitor.

The ledger stays shared and auditable; Analyze Another Amount remains an isolated scenario.

## Research core

- New research direction: MSPCIFormer (2026) only, beginning with the isolated
  market-only seven-day VASA experiment documented in
  [`research/mspciformer-vasa-phase1.md`](research/mspciformer-vasa-phase1.md).
- Legacy runtime evidence only: Gurgul et al. (2025) and Adaptive Multi-Source
  Fusion/Gating. These remain auditable for the existing 15-day dashboard path
  but are retired from new forecasting experiments.
- Phase 2 portfolio and UI work remains unimplemented pending explicit review
  of the Phase 1 results.

## Deployment summary — on hold

Do not provision cloud infrastructure or claim production readiness until ResilientDB cloud compatibility, persistence, restart recovery, replica failure behavior, and operational support have been validated and documented in an approved architecture decision record.

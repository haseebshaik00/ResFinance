# Phase 2 — Seven-Day Portfolio Recommendation

Status: cash-reserve policy v2 implemented and exercised locally on 2026-11-14.

## Pipeline

```text
Verified Phase 1 v2 manifest + checkpoint + preprocessing
  -> latest completed BTC/ETH/SOL daily observations
  -> seven direct predicted prices and cumulative returns
  -> 365-day Ledoit-Wolf daily covariance × 7
  -> long-only mean-variance crypto sleeve plus USD cash reserve
  -> exact-cent BTC/ETH/SOL and unallocated-USD scenario amounts
```

The selected model is read from verified Phase 1 metadata. It is not hardcoded
to Original MSPCIFormer, and the proposed VASA model is not promoted merely
because it is the research novelty. The current validation result selects the
original reimplementation.

## Optimization policy

The fixed v2 objective is:

```text
maximize μᵀw - 5.0 × (wᵀΣ₇w)
```

- `μ`: raw cumulative Day-7 predicted returns from Phase 1.
- `Σ₇`: Ledoit-Wolf covariance from the latest 365 aligned daily returns,
  multiplied by seven. This assumes daily covariance is sufficiently stable
  over the seven-day horizon.
- `λ = 5.0`: a fixed, a-priori moderate risk-aversion coefficient. It was not
  tuned on the untouched Phase 1 test period.
- Constraints: `w >= 0` and `sum(w) <= 1` for BTC/ETH/SOL. The residual
  `1 - sum(w)` is a USD cash reserve with assumed seven-day return `0` and no
  crypto covariance. It is unallocated scenario capital, not a stablecoin,
  custody product, or executed trade. There are no coin-specific caps, minimum
  exposures, shorts, leverage, or questionnaire.
- Solvers: CLARABEL, then SCS on the identical objective. If both fail, the API
  returns an explicit error; it does not substitute equal weights or a
  minimum-variance portfolio.
- Dollar allocations use largest-remainder cent reconciliation and always sum
  exactly to entered capital.

## Historical fully-invested v1 result

Evidence:
[`../../config/crypto-intelligence/phase2-portfolio-2026-11-14.json`](../../config/crypto-intelligence/phase2-portfolio-2026-11-14.json).

| Asset | Weight | USD amount | Predicted asset return |
|---|---:|---:|---:|
| BTC | 94.66994278% | $946.70 | -0.05472813% |
| ETH | 0.00013708% | $0.00 | +0.59911573% |
| SOL | 5.32992014% | $53.30 | +0.73208955% |

- Predicted portfolio seven-day return: **-0.01279048%**.
- Estimated portfolio seven-day volatility: **6.17001808%**.
- Solver: CLARABEL, status `optimal`.
- Covariance repair: not required.
- Forecast status: current at execution, cutoff 2026-11-13 UTC.

That evidence is retained unchanged as the historical fully-invested policy.

## Actual $1,000 cash-reserve v2 result

Evidence:
[`../../config/crypto-intelligence/phase2-portfolio-cash-v2-2026-11-14.json`](../../config/crypto-intelligence/phase2-portfolio-cash-v2-2026-11-14.json).

| Allocation | Weight | USD amount |
|---|---:|---:|
| BTC | 0.00000914% | $0.00 |
| ETH | 0.00137890% | $0.01 |
| SOL | 10.11696599% | $101.17 |
| USD cash reserve | 89.88164597% | $898.82 |

- Predicted portfolio seven-day return: **0.07407351%**.
- Estimated portfolio seven-day volatility: **0.86066102%**.
- Solver: CLARABEL, status `optimal`; covariance repair was not required.

The tiny BTC/ETH weights are continuous optimizer outputs. The API preserves
them, while the UI renders a positive value below one-hundredth of a percent as
`<0.01%`; cent reconciliation leaves BTC at zero cents and ETH at one cent.

## API and UI

- `GET /api/v1/crypto/forecast`: verified model provenance, current observed
  prices, seven daily prices and returns, UTC dates, freshness, and historical
  holdout errors.
- `POST /api/v1/crypto/recommendations`: positive integer USD cents in;
  expected returns, BTC/ETH/SOL sleeve weights and amounts, an unallocated USD
  cash-reserve weight and amount, solver state, risk estimate, provenance, and
  warnings out.

The Crypto Intelligence dashboard displays three market cards, an asset
selector with observed/predicted chart styling and tooltips, one capital input,
an allocation table and donut that includes cash, freshness warnings,
historical model error, and the calculation method. It supports light/dark
themes and responsive layouts. There is no risk questionnaire or trading
action.

Reproduce the $1,000 calculation:

```bash
.venv/bin/python -m scripts.milestone6.run_phase2_recommendation \
  --capital-cents 100000 \
  --evidence-output config/crypto-intelligence/phase2-portfolio-$(date -u +%F).json
```

This is experimental investment guidance, not automated trading, guaranteed
profit, custody, or validated investment advice. Coin Metrics evidence remains
limited to the documented non-commercial research disposition.

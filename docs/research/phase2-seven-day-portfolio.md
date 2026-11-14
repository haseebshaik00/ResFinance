# Phase 2 — Seven-Day Portfolio Recommendation

Status: model-informed diversified cash-reserve policy v3 implemented and
exercised locally on 2026-11-14. The v1 and v2 evidence below is retained as
historical output from their earlier policies.

## Pipeline

```text
Verified Phase 1 v2 manifest + checkpoint + preprocessing
  -> latest completed BTC/ETH/SOL daily observations
  -> seven direct predicted prices and cumulative returns
  -> 365-day Ledoit-Wolf daily covariance × 7
  -> model-informed diversified crypto sleeve plus USD cash reserve
  -> exact-cent BTC/ETH/SOL and unallocated-USD scenario amounts
```

The selected model is read from verified Phase 1 metadata. It is not hardcoded
to Original MSPCIFormer, and the proposed VASA model is not promoted merely
because it is the research novelty. The current validation result selects the
original reimplementation.

## Active v3 policy

The optimizer first determines the total crypto-sleeve exposure from the fixed
mean-variance objective:

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

V3 retains that model-selected total sleeve weight and diversifies only the
BTC/ETH/SOL mix. Let `m` be the normalized mean-variance crypto weights and
`p` be normalized inverse-volatility weights derived from the diagonal of
`Σ₇`. The final sleeve weights are:

```text
final crypto weights = sleeve weight × (c × m + (1 - c) × p)
```

`c` is the selected model's held-out calibration: the square root of the
product of (a) directional skill above chance and (b) the strongest absolute
predicted return divided by seven-day return MAE. Both components are bounded
to `[0, 1]`. Thus a weak or unavailable validation signal leaves the active
crypto sleeve close to the covariance-derived diversification prior; it does
not invent a stronger model signal. The forecast still governs the total
crypto-versus-cash exposure. This is a declared policy choice, not a claim
that all three assets will outperform.

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

## Historical $1,000 cash-reserve v2 result

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

## Actual $1,000 model-informed diversified v3 result

Evidence:
[`../../config/crypto-intelligence/phase2-model-informed-diversified-cash-v3-2026-11-14.json`](../../config/crypto-intelligence/phase2-model-informed-diversified-cash-v3-2026-11-14.json).

| Allocation | Weight | USD amount |
|---|---:|---:|
| BTC | 3.98084821% | $39.81 |
| ETH | 2.93655101% | $29.36 |
| SOL | 3.20095481% | $32.01 |
| USD cash reserve | 89.88164597% | $898.82 |

- Forecast-model tilt: **3.39067511%**; the other 96.60932489% of the crypto
  sleeve follows the inverse-volatility prior.
- Predicted portfolio seven-day return: **0.03884855%**.
- Estimated portfolio seven-day volatility: **0.72263648%**.
- Solver: CLARABEL, status `optimal`; covariance repair was not required.

The v3 result is not a hard-coded 24/21/15 allocation. It is a current,
evidence-bound combination of the selected MSPCIFormer forecast, its measured
validation quality, and the 365-day covariance estimate. If the optimizer
rejects crypto exposure entirely, the result remains 100% cash.

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
  --evidence-output config/crypto-intelligence/phase2-model-informed-diversified-cash-v3-$(date -u +%F).json
```

This is experimental investment guidance, not automated trading, guaranteed
profit, custody, or validated investment advice. Coin Metrics evidence remains
limited to the documented non-commercial research disposition.

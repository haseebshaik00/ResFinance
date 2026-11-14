# MSPCIFormer VASA Phase 1 Research

Status: completed local, non-commercial research run on 2026-11-14

This report covers Phase 1 only. It does not change the Crypto Intelligence
dashboard, the approved 15-day runtime forecast, portfolio optimization, the
risk questionnaire, Finance, wallet behavior, settlement, or investment
recommendations.

## Research question and conclusion

Can conditioning MSPCIFormer's multi-scale aggregation on recent market
volatility improve direct seven-day BTC, ETH, and SOL price forecasts?

For the declared experiment, **no**. VASA increased Day-7 MAE relative to the
original reimplementation by 0.414% for BTC, 0.430% for ETH, and 0.553% for
SOL. Validation also favored the original reimplementation, so the latest
research-only forecast uses the original model. No persistence fallback,
prediction override, portfolio optimization, or frontend path consumed these
results.

## Original paper and reproduction boundary

The sole architectural paper is Zhao, Crane, and Bezbradica (2026),
[MSPCIFormer: A Multi-Scale Patching Channel-Independent Transformer for
Cryptocurrency Price Forecasting](https://doi.org/10.1111/exsy.70343).

The paper:

- applies independent temporal patching to each price channel;
- sends every patch scale through an encoder-only Transformer;
- produces a scale-specific direct forecast;
- combines scale forecasts with globally learned softmax weights;
- evaluates ADA, BTC, and ETH at 1-, 3-, 5-, 7-, and 15-day horizons using
  both chronological holdout and five-fold walk-forward validation; and
- reports results from eight input price channels over 2020-04-10 through
  2025-01-01, after aligning on SOL availability.

The article discloses a five-day input window and two patch scales. The
authors' source repository was inspected read-only at commit
`6c0970462aa0412b2c664fefdbabc71cc17fb775`, which identifies scales 4 and 5
and stride 2, but it has no license file. No source code was copied.

This implementation is therefore a clean-room three-asset adaptation, not an
exact reproduction. Material differences are:

- inputs and targets are exactly BTC, ETH, and SOL, rather than eight inputs
  and ADA/BTC/ETH targets;
- one model directly emits Days 1-7 together;
- the compact model has 5,152 parameters versus the paper's reported 269,858;
- training uses the repository's deterministic CPU toolchain and declared
  budget rather than undisclosed final Optuna trials; and
- the primary metric units are inverse-transformed USD prices and returns.

Published paper results, this baseline's results, and VASA results must not be
treated as interchangeable.

## Architecture

### Original reimplementation

Each example contains five trailing daily log-price observations for the three
assets. Training-window means and standard deviations normalize every asset;
the transform is never fit with validation or test observations.

For patch scales 4 and 5, shared channel-independent encoders perform:

1. temporal patch projection to 16 dimensions;
2. learned positional encoding;
3. one two-head Transformer encoder layer; and
4. a scale-specific direct seven-day residual-price head.

Global trainable logits are normalized with softmax and aggregate the two
scale-specific paths.

### VASA-MSPCIFormer

VASA changes only scale aggregation. For asset `a` and origin `t`:

```text
v[a,t] = std(log(P[a,i] / P[a,i-1])) over the selected trailing window
delta[a,t] = MLP(standardize(v[a,t]))
weights[a,t] = softmax(base_scale_logits + delta[a,t])
forecast[a,t] = sum(weights[a,t,s] * scale_forecast[a,t,s])
```

The shared MLP is `1 -> 8 -> GELU -> 2`. Its final layer is initialized to
zero, so VASA begins exactly at the original global-weight behavior. It adds 34
trainable parameters (5,186 total). The network is not told that high
volatility should favor any scale.

Inputs use only past market prices and trailing returns. Sentiment, news,
social media, on-chain activity, adaptive source gating, equal source fusion,
and multi-source ablations are absent from this experiment.

## Data and methodology

- Provider: Coin Metrics Community API v4 `PriceUSD`, under the recorded CC
  BY-NC 4.0 non-commercial research disposition.
- Assets: exactly BTC, ETH, and SOL.
- UTC range: 2020-04-10 through 2026-11-13.
- Aligned observations: 2,409 complete, contiguous daily rows; no complete-day
  gaps after three-asset alignment.
- Dataset hash:
  `47f9b11bfa620ac2dc7d03b7e1de7f837d73b2f1e101f8d691697a3d5faccd68`.
- Raw observation archive: persisted in ResilientDB under
  `observation-archive:fcd1f649a1ffa40ce8b0c3e3a7e900e9e2f15980500b83d80db355e620a32138`.
- Volatility lookback candidates: 7, 14, and 30 days. Validation selected 7
  days; the test set was not used for selection.
- Seeds: 2025, 2026, and 2027. Reported holdout predictions are the equal mean
  of the three seed forecasts; seed variability remains in `metrics.json`.
- Optimization: AdamW, learning rate 0.003, weight decay 0.0001, batch size 64,
  maximum 30 epochs, validation early stopping patience 6, gradient norm 1.0.
- Primary split by forecast origin: training 2020-05-10 to 2024-11-24 (1,660
  samples), validation 2024-12-02 to 2025-07-26 (237), and untouched test
  2025-08-03 to 2026-11-06 (461). Seven full calendar days are embargoed at
  both boundaries; the last test target is 2026-11-13.
- Robustness check: three expanding training windows with moving 60-day
  validation and 60-day test blocks.

Directional accuracy is the proportion of daily directions for which
`sign(predicted_price[d] - previous_predicted_price)` equals
`sign(actual_price[d] - previous_actual_price)`. Day 1 uses the observed origin
price as the previous value for both paths. Persistence has a predicted sign
of zero and therefore scores zero unless the actual move is exactly zero.

## Actual untouched-holdout results

Day-7 price MAE is the error on the seventh predicted price, not an illustrative
number. Return MAE is the absolute error of
`predicted_price_day_7 / origin_price - 1`.

| Model | BTC Day-7 MAE | ETH Day-7 MAE | SOL Day-7 MAE | 7-day return MAE | MDA | All-horizon MAPE |
|---|---:|---:|---:|---:|---:|---:|
| Naive persistence | $3,634.68 | $170.39 | $8.7366 | 5.7408% | 0.0000 | 4.2311% |
| Original MSPCIFormer | $3,582.00 | $173.89 | $9.0293 | 5.8541% | 0.5046 | 4.4252% |
| VASA-MSPCIFormer | $3,596.83 | $174.64 | $9.0792 | 5.8824% | 0.4960 | 4.4619% |

Relative Day-7 MAE changes (positive means lower error):

| Asset | VASA vs original | VASA vs persistence | Original vs persistence |
|---|---:|---:|---:|
| BTC | -0.414% | +1.041% | +1.449% |
| ETH | -0.430% | -2.494% | -2.055% |
| SOL | -0.553% | -3.921% | -3.350% |

Average MAPE across BTC, ETH, and SOL by forecast day:

| Model | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Persistence | 2.156% | 3.161% | 3.874% | 4.363% | 4.823% | 5.358% | 5.881% |
| Original | 2.193% | 3.249% | 4.095% | 4.667% | 5.157% | 5.576% | 6.041% |
| VASA | 2.177% | 3.255% | 4.060% | 4.740% | 5.276% | 5.648% | 6.076% |

The three-fold walk-forward robustness check slightly favored VASA on MAPE
(4.2685% vs 4.2852%) and seven-day return MAE (6.0724% vs 6.0959%), but its MDA
was lower (0.4778 vs 0.4884). This small reversal does not overturn the primary
untouched-holdout result or justify a superiority claim.

### Runtime and scale behavior

| Model | Parameters | Mean latency per forecast |
|---|---:|---:|
| Persistence | 0 | 0.0046 ms |
| Original | 5,152 | 0.2435 ms |
| VASA | 5,186 | 0.3650 ms |

VASA learned only modest volatility dependence:

| Asset | Low-vol Patch 4 / 5 | High-vol Patch 4 / 5 |
|---|---:|---:|
| BTC | 50.42% / 49.58% | 51.69% / 48.31% |
| ETH | 50.64% / 49.36% | 52.25% / 47.75% |
| SOL | 50.40% / 49.60% | 51.29% / 48.71% |

The learned high-volatility shift toward Patch 4 was small and did not improve
the primary result. High-volatility Day-7 MAE was higher than low-volatility
MAE for ETH and SOL for both trained models; BTC showed the opposite ordering
over this particular holdout. These are descriptive regime slices, not a
statistical-significance claim.

## Latest research-only seven-day forecast

Generated at 2026-11-14 06:33:34 UTC from Coin Metrics observations through
2026-11-13. Validation selected the original reimplementation. The checkpoint
was refit on all mature seven-day labels through 2026-11-06 using the frozen
configuration. Values are raw model output with finite/positive checks; no
fallback or override was used.

| Date (UTC) | BTC | ETH | SOL |
|---|---:|---:|---:|
| Observed 2026-11-13 | $68,096.31 | $1,923.37 | $77.8394 |
| 2026-11-14 | $67,866.95 | $1,925.34 | $77.6754 |
| 2026-11-15 | $67,609.84 | $1,925.90 | $77.4576 |
| 2026-11-16 | $67,524.33 | $1,925.46 | $77.3995 |
| 2026-11-17 | $67,559.79 | $1,927.31 | $77.4969 |
| 2026-11-18 | $67,715.81 | $1,928.91 | $77.7514 |
| 2026-11-19 | $67,917.14 | $1,932.67 | $78.1581 |
| 2026-11-20 | $68,059.04 | $1,934.89 | $78.4093 |
| Predicted cumulative return | -0.0547% | +0.5991% | +0.7321% |

These forecasts are research evidence, not trading signals or investment
advice.

## Artifacts and figures

Run manifest:
`phase1-run:phase1-vasa-ad3650aef2e4440f8dd0a846efd18bc5:manifest`.
Full predictions, metrics, checkpoint, figures, configuration, data manifest,
and latest forecast are encrypted and content-addressed in ResilientDB. The
bounded checked-in evidence contains their hashes. A local run also writes
review copies under `.resfinance-local/research/phase1-vasa/`, which is ignored
by Git.

The generated figures are:

- `actual-vs-predicted.svg`: Day-7 actual and model trajectories for all assets;
- `per-horizon-error.svg`: D1-D7 MAPE for persistence, original, and VASA; and
- `volatility-scale-weights.svg`: low/high-volatility VASA scale weights.

## Reproduction

Start the existing local ResilientDB stack, then run the declared experiment:

```bash
docker compose --profile tools up -d --build --wait \
  resdb-1 resdb-2 resdb-3 resdb-4 resdb-proxy resdb-tools

.venv/bin/python -m scripts.milestone5.run_phase1_forecasting \
  --experiment-config config/crypto-intelligence/phase1-vasa-v1.json \
  --evidence-output config/crypto-intelligence/phase1-vasa-$(date -u +%F).json
```

That one command deliberately downloads/aligned data, trains persistence,
original MSPCIFormer, and VASA under one shared protocol, evaluates the
untouched holdout and walk-forward folds, creates tables/figures, refits the
validation-selected trained model, generates the latest JSON, and persists all
full artifacts. Separate model commands are intentionally not offered because
independent invocations could drift in data cutoffs or splits; the result still
contains distinct checkpoints, predictions, metrics, and timing for both
trained models.

Inspect the machine-readable outputs:

```bash
jq . .resfinance-local/research/phase1-vasa/metrics.json
jq . .resfinance-local/research/phase1-vasa/latest-forecast.json
```

Run focused verification:

```bash
.venv/bin/pytest -q \
  tests/contract/test_phase1_forecasting.py \
  tests/integration/test_phase1_research.py
```

## Limitations

- This is a compact clean-room adaptation, not the paper's exact parameterization.
- Only closing prices are used; volume, OHLC detail, sentiment, and on-chain
  signals are intentionally excluded.
- Three seeds quantify optimizer variability but are insufficient for a strong
  significance claim.
- Cryptocurrency regimes change; one holdout and three walk-forward blocks do
  not establish durable forecasting edge.
- The latest forecast has no observed labels yet and cannot be scored.
- The research is local and non-commercial. It does not establish production,
  BFT, custody, trading, or investment-advice readiness.

Phase 2 remains unimplemented and requires explicit approval.

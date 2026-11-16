# Research Protocol

Status: active local, non-commercial Crypto Intelligence research protocol.

## Scope

The active workflow uses exactly BTC, ETH, and SOL completed daily UTC closing
prices from Coin Metrics. It produces direct seven-day price paths using a
clean-room MSPCIFormer adaptation and a VASA-MSPCIFormer volatility-aware
variant. It is experimental research, not investment advice, custody, trading,
or a production service.

## Data and refresh

- Every market observation records its event, availability, and retrieval times,
  provider revision, source reference, response hash, and terms disposition.
- The daily fixed-PST job ingests completed Coin Metrics BTC/ETH/SOL prices and
  writes bounded freshness evidence under `config/crypto-intelligence/`.
- Forecast reads restore the selected saved checkpoint and preprocessing, then
  refresh inference only when newer eligible observations exist. They never
  retrain in response to a dashboard request.
- Missing or stale observations remain explicit. No fallback model or synthetic
  price is substituted.

## Phase 1 MSPCIFormer/VASA experiment

The protocol uses five trailing prices, patch scales four and five,
training-only log-price normalization, chronological train/validation/test
splits with seven-day embargoes, three expanding walk-forward folds, and seeds
2025/2026/2027. Validation selects the deployment model; the untouched holdout
does not select it. The two evaluated models are Original MSPCIFormer and
VASA-MSPCIFormer, which differs only by volatility-conditioned scale weighting.

Artifacts record data, code, configuration, environment, dependency, model,
and content hashes. They are encrypted and content-addressed in ResilientDB.
The selected checkpoint, preprocessing, held-out predictions, metrics, and
historical-error residuals are verified before the dashboard uses them.

## Phase 2 allocation

The active policy reads one verified Phase 1 forecast, uses 365 aligned daily
returns with Ledoit-Wolf covariance, and blends the forecast view inside the
wallet-selected Conservative, Balanced, or Growth BTC/ETH/SOL sleeve. USD cash
is fixed by that profile; allocations reconcile exactly to input cents. No
trade is executed and no Finance record changes.

The retired multimodal, 15-day, and naïve-baseline program is preserved only as
historical material under [`research/archive/paper2-multimodal-naive/`](research/archive/paper2-multimodal-naive/).

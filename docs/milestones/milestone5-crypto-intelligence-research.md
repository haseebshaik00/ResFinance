# Milestone 5: Crypto Intelligence — Crypto Ingestion, Feature Store & Reproducible ML Research

Status: complete for the active local, non-commercial market-only research
workflow.

## Active implementation

- Ingests completed daily BTC, ETH, and SOL market prices from Coin Metrics
  with idempotent, provenance-complete ResilientDB records.
- Runs a clean-room three-asset MSPCIFormer adaptation and the retained
  VASA-MSPCIFormer volatility-aware comparison on direct seven-day prices.
- Uses chronological splits, seven-day embargoes, fixed seeds, three expanding
  walk-forward folds, and saved encrypted artifacts for reproducibility.
- Selects a checkpoint on validation data only, then permits inference-only
  refresh from newer completed market observations without dashboard retraining.
- Retains CoinGecko only for current-display quote support; all active forecast
  inputs are Coin Metrics daily prices.

## Daily freshness

The fixed-PST daily workflow runs
`scripts.milestone9.run_forward_completion`. It ingests the current completed
BTC/ETH/SOL market day and writes bounded evidence to
`config/crypto-intelligence/milestone9-forward-completion-YYYY-MM-DD.json`.
The next dashboard forecast read can use those observations for checkpoint-based
inference refresh.

## Boundaries

- ResilientDB is the sole application and research store.
- Generated observations and artifacts are not committed to Git.
- The active system has no multimodal feature builder, sentiment/on-chain model
  inputs, adaptive source gating, 15-day forecast path, naïve baseline, or
  promotion gate.
- Historical Paper 2 and naïve-baseline evidence is retained solely in
  [`../research/archive/paper2-multimodal-naive/`](../research/archive/paper2-multimodal-naive/).
- This milestone does not claim production, cloud, trading, custody, or
  investment-advice readiness.

## Evidence

The retained MSPCIFormer/VASA protocol and bounded Phase 1 evidence are in
[`../research/mspciformer-vasa-phase1-v2.md`](../research/mspciformer-vasa-phase1-v2.md).
The current experiment configuration is
[`../../config/crypto-intelligence/phase1-vasa-v2.json`](../../config/crypto-intelligence/phase1-vasa-v2.json).

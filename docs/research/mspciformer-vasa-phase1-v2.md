# MSPCIFormer VASA Phase 1 — Active Two-Model Protocol

Status: completed local, non-commercial provider-data run on 2026-11-14.

## Scope and evidence preservation

The active experiment compares only:

1. Original MSPCIFormer clean-room reimplementation.
2. VASA-MSPCIFormer, with volatility-conditioned scale aggregation.

Only the two active trained architectures are registered, evaluated, plotted,
selected, or exposed by the v2 pipeline. Retired Paper 2 material is isolated
under [`archive/paper2-multimodal-naive/`](archive/paper2-multimodal-naive/).

The sole architectural base paper remains Zhao, Crane, and Bezbradica (2026),
[MSPCIFormer](https://doi.org/10.1111/exsy.70343). This is a clean-room,
three-asset adaptation; no author repository code was copied.

## Protocol

- Assets: exactly BTC, ETH, and SOL.
- Inputs: completed daily UTC closing prices only.
- Output: direct Days 1–7 prices and returns.
- Data: 2,409 complete aligned days from 2020-04-10 through 2026-11-13.
- Split: chronological train/validation/test with seven-day embargoes.
- Robustness: three expanding walk-forward folds.
- Seeds: 2025, 2026, and 2027.
- Selection: validation MAPE only; the untouched holdout is not used to select
  the deployment model.
- Artifacts: encrypted, content-addressed ResilientDB blobs with a new v2 run
  manifest. Saved preprocessing and the selected deployment checkpoint support
  inference-only refreshes without retraining on each portfolio request.

## Executed v2 result

Run: `phase1-vasa-v2-f07de01b517d4304823d07bb11a28b1b`.

Manifest:
`phase1-run:phase1-vasa-v2-f07de01b517d4304823d07bb11a28b1b:manifest`.

| Model | BTC Day-7 MAE | ETH Day-7 MAE | SOL Day-7 MAE | 7-day return MAE | MDA | All-horizon MAPE |
|---|---:|---:|---:|---:|---:|---:|
| Original MSPCIFormer | $3,582.00 | $173.89 | $9.0293 | 5.8541% | 50.46% | 4.4252% |
| VASA-MSPCIFormer | $3,596.83 | $174.64 | $9.0792 | 5.8824% | 49.60% | 4.4619% |

VASA's Day-7 MAE was 0.414%, 0.430%, and 0.553% worse than the original for
BTC, ETH, and SOL respectively. The validated conclusion is unchanged: VASA
did not demonstrate superiority on the primary untouched holdout. Validation
selected the original MSPCIFormer reimplementation.

The v2 result matches the trained-model values from the historical run because
the training protocol and trained architectures were not changed; it is a new
executed run whose active comparison and generated tables contain only the two
trained models.

## Current forecast

The selected original model was refit once using mature labels through
2026-11-06. Its saved checkpoint generated a forecast from completed market
observations through 2026-11-13 for 2026-11-14 through 2026-11-20:

| Asset | Observed price | Day-7 predicted price | Predicted 7-day return |
|---|---:|---:|---:|
| BTC | $68,096.31 | $68,059.04 | -0.0547% |
| ETH | $1,923.37 | $1,934.89 | +0.5991% |
| SOL | $77.8394 | $78.4093 | +0.7321% |

No persistence or zero-return fallback exists. If verified inference artifacts
or eligible market observations are unavailable, the application returns an
explicit failure. If a refresh cannot reach the latest completed UTC market
day, the original dates remain visible and the forecast is marked stale.

## Reproduction

```bash
.venv/bin/python -m scripts.milestone5.run_phase1_forecasting \
  --experiment-config config/crypto-intelligence/phase1-vasa-v2.json \
  --evidence-output config/crypto-intelligence/phase1-vasa-v2-$(date -u +%F).json
```

Review copies are written only under
`.resfinance-local/research/phase1-vasa-v2/`; the historical v1 directory is
not overwritten. Dated historical copies are isolated from the active workflow
under [`archive/paper2-multimodal-naive/`](archive/paper2-multimodal-naive/).

This research is experimental and non-commercial. It does not establish
profitable forecasting, production readiness, investment advice, or trading
authority.

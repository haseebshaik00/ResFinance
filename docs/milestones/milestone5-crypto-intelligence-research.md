# Milestone 5: Crypto Intelligence — Crypto Ingestion, Feature Store & Reproducible ML Research

Status: Complete for local, non-commercial research mechanics

Historical `scripts.milestone5`, `scripts.milestone6`,
`config/milestone5-*`, and `config/milestone6-*` identifiers remain stable
so the recorded ingestion and research evidence stays reproducible.

## Crypto ingestion and feature-store evidence

### Purpose

Milestone 5 turns the Milestone 1 provider-feasibility evidence into an application-owned ingestion and feature-store boundary. It collects only BTC, ETH, and SOL research signals, preserves exactly what was known and when it was available, and stores the resulting observations and derived feature datasets in Apache ResilientDB without introducing another persistent database.

Forecast training, MSPCIFormer, Adaptive Multi-Source Gating, walk-forward evaluation, and model promotion are the reproducible ML research portion of Milestone 5 documented below.

### Implemented provider adapters

- **Coin Metrics Community:** daily BTC/ETH/SOL `PriceUSD` plus daily BTC/ETH `AdrActCnt` and `TxCnt`, including pagination, decimal-string preservation, response hashes, source queries, and the recorded CC BY-NC 4.0 research disposition.
- **CoinGecko:** current BTC/ETH/SOL USD quote fallback with provider timestamps and attribution metadata. It is not used as the historical research source.
- **DefiLlama:** daily Solana TVL and USD stablecoin-supply proxies. The adapter emits one record per requested day and metric, including explicit null/missing observations; unavailable history is never converted to zero.
- **GDELT:** strict ingestion of the bounded daily GKG aggregate CSV produced by the approved BigQuery query. It persists counts and average tone, not full copyrighted article text.

The live adapter smoke on 2026-10-14 successfully parsed Coin Metrics market and on-chain responses, DefiLlama Solana proxy responses, and current CoinGecko quotes for all three assets.

### Immutable ResilientDB records

The repository stores:

- Raw market, on-chain, and sentiment observations under deterministic `mkt:`, `chain:`, and `sent:` keys.
- Event time, conservative provider-availability time, first retrieval time, provider/revision, source reference, interval, decimal value or explicit missingness, response SHA-256, terms reference, and license disposition.
- Immutable provider-license records.
- Append-only success/failure ingestion-attempt records with error digests rather than raw provider exception content.
- Derived feature rows under content-addressed `feat:{dataset_hash}:...` keys.
- Dataset manifests containing the fixed schema, asset list, point-in-time cutoff, decision lag, row checksum, source observation IDs, and dataset hash.

An unchanged observation fetched later deduplicates against its stable source identity while preserving its original retrieval evidence. A changed observation cannot overwrite the same provider revision; a provider correction must use a distinct revision.

### Point-in-time feature construction

The feature builder creates a daily UTC grid with:

- Market price and one-day return.
- GDELT average tone and document counts.
- BTC/ETH active-address and transaction-count metrics.
- SOL TVL and stablecoin-supply proxy metrics.
- A mask for every feature plus market, sentiment, and on-chain source masks.
- Exact source observation IDs for every populated feature.
- An explicit provider allowlist in each manifest, so acceptance/synthetic records cannot enter a live research dataset merely because they share a date and metric.

For each date, the builder selects only a revision whose provider-availability time is at or before that date's decision cutoff. A later revision is excluded even when it exists in ResilientDB. Preprocessing and model fitting are deliberately absent from this milestone.

### Acceptance evidence

The deterministic acceptance writes synthetic provider observations and feature rows through the pinned local ResilientDB client into the running four-replica stack. Synthetic data is used so the acceptance result does not depend on provider availability and does not commit generated research data to Git.

The recorded run in [`config/milestone5-local-attestation.json`](../../config/milestone5-local-attestation.json) passed:

- Exactly `BTC | ETH | SOL`; `DOGE` was rejected before provider or persistence work.
- 28 immutable raw observations inserted into real ResilientDB.
- All 28 observations deduplicated on repeat ingestion.
- An injected provider failure appended a failed-attempt record and left the observation count unchanged.
- Nine daily point-in-time feature rows plus one dataset manifest persisted.
- Every feature row and the manifest deduplicated on repeat persistence.
- A future-available BTC revision was excluded from the earlier feature row.
- Missing SOL TVL remained null with a false mask, never numeric zero.

Automated verification on 2026-10-14:

- Ruff passed.
- Mypy passed across the configured foundation, wallet, Finance, and Crypto ingestion implementation paths, backend, ML feature code, blockchain adapters, and wallet helpers.
- Pytest passed all 72 tests with one pre-existing Starlette `TestClient` deprecation warning.
- The live provider adapter smoke passed.
- The real ResilientDB Milestone 5 acceptance passed.

Run the acceptance with:

```bash
docker compose --profile tools up -d --build --wait \
  resdb-1 resdb-2 resdb-3 resdb-4 resdb-proxy resdb-tools
.venv/bin/python -m scripts.milestone5.run_crypto_ingestion_acceptance \
  --docker "$(command -v docker)" \
  --output config/milestone5-local-attestation.json
```

### Boundaries and next milestone

- Provider permission remains limited to the dispositions in [`provider-terms-review.md`](provider-terms-review.md). Technical availability does not approve commercial or institutional use.
- The fixed historical research boundary remains 2020-04-10 through 2025-01-01 inclusive.
- GDELT historical aggregates still come from the bounded, validated BigQuery export; the DOC API remains a near-term metadata source rather than a substitute historical dataset.
- No generated provider payload, dataset, or feature artifact is committed to Git.
- This milestone does not claim production ingestion reliability or cloud/BFT readiness.

The reproducible ML research portion of Milestone 5 implements deterministic synthetic smoke datasets, baselines, the documented three-asset MSPCIFormer adaptation, Adaptive Multi-Source Gating, chronological walk-forward evaluation, conformal intervals, ablations, and complete research-run manifests.

## Reproducible ML research evidence

### Purpose

The reproducible ML research portion of Milestone 5 turns the point-in-time feature datasets from the ingestion and feature-store work into an auditable forecasting research system. It implements the declared models, chronological evaluation, uncertainty calibration, ablations, immutable run records, encrypted model artifacts, and explicit promotion controls without copying code from the unlicensed MSPCIFormer author repository.

The deterministic synthetic smoke dataset validates mechanics and reproducibility only. It is not evidence that a model will perform well on the fixed historical provider dataset or future markets.

### Implemented models

- A last-value/zero-return naive baseline.
- A closed-form ridge-linear baseline.
- An LSTM sequence baseline.
- A clean-room three-asset MSPCIFormer adaptation with:
  - separate market, sentiment, and on-chain encoders;
  - explicit feature and source masks;
  - per-asset, per-time-step masked Adaptive Multi-Source Gating;
  - temporal patch sizes of 2, 4, and 8 days;
  - channel-independent Transformer processing with shared weights;
  - learned aggregation across patch scales;
  - asset embeddings for exactly BTC, ETH, and SOL;
  - expected-return, direction-probability, and p10/p50/p90 heads for 1-, 3-, 5-, 7-, and 15-day horizons.

Required comparisons execute under one forecast contract: market-only, fixed equal fusion, adaptive gating, without-market, without-sentiment, and without-on-chain. A fourth asset is rejected before model construction.

### Evaluation protocol

- Five expanding chronological walk-forward folds.
- A 15-day embargo between train/validation and validation/test windows.
- No random shuffling.
- Masked standardization fit independently on each training window.
- Split-conformal calibration using validation residuals only.
- MAE, RMSE, directional accuracy, Brier score, interval coverage, interval width, annualized Sharpe, maximum drawdown, and 0/10/25-basis-point transaction-cost sensitivity.
- Descriptive baseline and ablation reporting only; no statistical-significance claim is made.

### Reproducibility and provenance

Every completed run records its purpose, owner, UTC timing, parent run, Git commit and dirty-state hash, ML code hash, complete pinned dependency lock and hash, configuration and hash, source record IDs, dataset and feature-manifest hashes, fold boundaries, preprocessing, seeds, deterministic flags, hardware/runtime details, model hashes, prediction hash, metrics, gate weights, warnings, and artifact hashes.

CPU smoke execution pins Python 3.13, NumPy 2.5.4, and PyTorch 2.14.1, uses one framework thread, enables deterministic algorithms, seeds Python/NumPy/PyTorch/data-loader/optimizer paths, and performs no random data shuffling. The acceptance criterion is repeatability on the same platform and dependency set; PyTorch does not guarantee bit-identical results across different releases or platforms.

### ResilientDB artifact persistence

Research manifests use deterministic `run:{run_id}:manifest` keys. Checkpoints use a deterministic JSON tensor encoding rather than a timestamp-bearing archive. Predictions, metrics, gate-weight reports, the walk-forward MAE SVG, and all fold/model checkpoints are hashed, compressed, AES-256-GCM encrypted, and persisted through the existing ResilientDB blob repository.

The repository retains 256 KiB logical chunks and now segments each logical chunk into CLI-safe transport records. Restoration supports both the new segmented schema and existing schema-v1 blobs, and verifies transport-segment hashes, logical-chunk hashes, authenticated encryption, size, and aggregate content hash.

### Promotion control

Only a completed adaptive-gating run with all required comparisons and artifacts can be promoted. The default `forecast-promotion-v1` criteria require adaptive MAE no worse than the naive baseline and interval coverage of at least 70 percent. A successful promotion appends an immutable event containing the criteria version, evaluated metrics, checks, approver, run ID, and model name. Failed criteria raise an error and do not create a promotion event.

The deterministic smoke candidate was not promoted. Its adaptive MAE was `0.0483409762`, compared with naive MAE `0.0224560387`; the declared MAE criterion therefore rejected it. This is the correct research outcome, not an acceptance failure: the milestone proves the evaluation and governance pipeline, not model superiority on synthetic data.

### Acceptance evidence

The local acceptance ran twice on CPU and then persisted both complete runs through the real four-replica Apache ResilientDB stack:

- Dataset SHA-256: `2c11ce17e3a80f9efe84b579dc1ff9c533de24d19b2da2b32be1cf50266d576d`.
- Prediction SHA-256: `c80a13add27f3685a257a2ffcf666536e9d90baf1e728e27a7b3ce2d67cf97f3`.
- Both hashes were identical across repeated CPU runs.
- All five chronological folds and all nine required model/baseline/ablation variants were reported.
- All 39 artifacts were restored byte-for-byte from ResilientDB.
- Repeating the same run persistence deduplicated cleanly.
- The promotion gate rejected the adaptive candidate because its MAE did not beat the naive baseline.
- No author-repository source was copied.

The machine-readable final run is checked in as `config/milestone6-local-attestation.json`. The preliminary values above are deterministic and are rechecked after the implementation commit before the attestation is recorded.

### Verification

```bash
.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/pytest

docker compose --profile tools up -d --build --wait \
  resdb-1 resdb-2 resdb-3 resdb-4 resdb-proxy resdb-tools
.venv/bin/python -m scripts.milestone6.run_ml_acceptance \
  --docker "$(command -v docker)" \
  --output config/milestone6-local-attestation.json
```

### Boundaries and next milestone

- Generated datasets, checkpoints, predictions, metrics, plots, and run manifests stay in ResilientDB; Git contains only code, the deterministic generator, documentation, and the small acceptance attestation.
- The synthetic acceptance run does not replace a full point-in-time provider-data research run.
- A model is not an approved forecast source until a full run passes explicit promotion criteria and appends an immutable promotion event.
- Model output is research analysis, not financial advice, and no path trades or mutates Finance.
- No cloud or production readiness is claimed.

## 2026-11-14 Phase 1 market-only forecasting extension

The historical v1 path evaluated naive persistence, a clean-room market-only
MSPCIFormer reimplementation, and VASA-MSPCIFormer. Its evidence remains
immutable. The active v2 path registers and evaluates only Original
MSPCIFormer and VASA-MSPCIFormer on direct Days 1-7 BTC/ETH/SOL prices; it does
not derive a new result by deleting a column from the old evidence.

The actual untouched holdout did not support the VASA hypothesis: VASA's Day-7
MAE was 0.414%, 0.430%, and 0.553% worse than the original reimplementation for
BTC, ETH, and SOL respectively. Validation selected the original model for the
separate latest research-only forecast. See
[`../research/mspciformer-vasa-phase1-v2.md`](../research/mspciformer-vasa-phase1-v2.md)
for the architecture, protocol, full results, artifacts, and reproduction
command.

Milestone 6 reads the validation-selected v2 model from verified metadata and
implements the seven-day uncapped mean–variance portfolio and dashboard. It
must label stale forecasts and fail explicitly on corrupt artifacts or solver
failure.

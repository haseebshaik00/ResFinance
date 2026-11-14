# Research Protocol

Status: Milestone 7 forward-completion protocol predeclared on 2026-10-15; local, non-commercial research only

## Scope

Research dataset V1 contains exactly BTC, ETH, and SOL with daily UTC observations from 2020-04-10 through 2025-01-01 inclusive. It combines market, sentiment, and asset-specific on-chain or documented proxy channels. A fourth asset is rejected at ingestion, feature, model, evaluation, portfolio, API, and fixture boundaries.

## Point-in-time data

Every observation records event time, provider availability time, retrieval time, provider revision, request URL or canonical query, response checksum, license/terms reference, and missingness. Joins use the time at which data was available, not a later revised timestamp. Provider failure appends a failed-attempt record and never overwrites a valid observation.

Planned sources:

- Coin Metrics Community: daily market series; daily `AdrActCnt` and `TxCnt` are the pinned V1 BTC/ETH on-chain metric contract.
- CoinGecko: current quote fallback; historical use requires confirmed plan/terms and coverage.
- DefiLlama: documented SOL TVL and stablecoin-supply proxies.
- GDELT: GKG historical tone/coverage and DOC metadata; full copyrighted articles are not persisted.
- `facebook/bart-large-mnli` at the locked revision: supplemental headline classification.

Provider availability differs by asset and date. Missing inputs are explicit masks; values are never silently backfilled from the future. Coin Metrics `PriceUSD` covers all three assets and `AdrActCnt` plus `TxCnt` cover BTC/ETH on every day of the fixed period. DefiLlama Solana TVL begins on 2021-03-17, leaving 341 masked days. Solana USD stablecoin supply begins on 2021-09-10 and contains 243 later gaps, leaving 761 total masked days. Those masks are model inputs; missing observations are not zero values.

## Reproducibility

Every run records:

- Run ID, purpose, owner, UTC start/end, and status.
- Git commit and dirty-state hash.
- Lock-file, code, configuration, environment, dependency-lock, container, dataset, feature, model, prediction, and artifact hashes.
- Exact provider observation IDs and immutable dataset manifest.
- Fixed random seeds for Python, NumPy, framework, data loader, and optimizer.
- CPU/GPU type, operating system, runtime/library versions, deterministic-mode settings, and known nondeterministic operations.
- Chronological train/validation/test windows and every walk-forward fold.
- Metrics, forecast intervals, baseline/ablation results, failures, and promotion decision.

Generated datasets, features, checkpoints, predictions, plots, and manifests are persisted in ResilientDB. Git contains code, deterministic synthetic generators, and small machine-readable acceptance attestations only. Temporary computation files are deleted after verified persistence.

## Evaluation

- Fit transforms on training windows only.
- Calibrate conformal intervals on validation windows only.
- Evaluate naive/zero-return, linear, and sequence baselines.
- Compare market-only, fixed equal fusion, adaptive gating, and each one-source-removed ablation.
- Report point errors, direction metrics, interval coverage/width, portfolio-relevant outcomes, missingness, and uncertainty.
- Do not claim statistical significance without a predeclared test, correction, and adequate sample.
- Label MSPCIFormer work as a three-asset adaptation; do not copy author source until a compatible license or explicit permission is recorded.

## Artifact protocol

Artifacts are compressed, encrypted with AES-256-GCM, split into 256 KiB logical content-addressed chunks, and segmented into transport-safe records under deterministic `blob:{sha256}:...` keys. A manifest records total size, compression, encryption metadata, ordered logical-chunk and transport-segment hashes, aggregate SHA-256, media type, and producing run. Restoration verifies every segment, logical chunk, authenticated envelope, and aggregate digest before use. Schema-v1 unsegmented blobs remain readable.

The local 100 MiB reconstruction smoke test does not satisfy persistence acceptance; the identical round trip must also pass through real ResilientDB and survive restart.

## Milestone 5 reproducible ML implementation note

The checked-in implementation uses pinned NumPy and PyTorch dependencies, CPU-only deterministic algorithms, one framework thread, no random data shuffling, five expanding walk-forward folds, a 15-day embargo, fold-local masked standardization, and validation-only split-conformal calibration. The clean-room MSPCIFormer adaptation uses separate market, sentiment, and on-chain encoders, masked adaptive gating, multi-scale temporal patches, shared channel-independent Transformer processing, learned scale aggregation, asset embeddings, and five-horizon return, direction, and quantile heads.

Synthetic smoke results validate deterministic mechanics, model contracts, comparisons, and persistence. They do not establish real-data performance, statistical significance, financial advice, or promotion eligibility. A full research run must use the fixed point-in-time provider dataset, retain the same manifest contract, and pass the declared promotion criteria before its model can become an approved forecast source.

## Milestone 7 untouched-forward completion protocol

This protocol is frozen before retrieving or scoring the forward holdout. It is a new evaluation, not a reinterpretation of the already-observed 2020-04-10 through 2025-01-01 five-fold results.

- Candidate: the same clean-room adaptive-gating architecture with a validation-locked reliability shrinkage coefficient selected from the fixed grid `0.00, 0.25, 0.50, 0.75, 1.00`. The coefficient scales predicted returns and direction confidence toward the naive zero-return/50-percent baseline. A coefficient of zero is an explicit, recorded abstention; it may tie but cannot outperform naive MAE by construction. The smallest coefficient wins an exact validation tie.
- Training decisions: all labeled samples through 2024-12-17. No record after that cutoff may fit weights or feature transforms.
- Embargo: 15 calendar days after the training cutoff.
- Validation/calibration decisions: 2025-01-02 through 2025-03-17. This window selects the fixed shrinkage coefficient and calibrates split-conformal intervals only.
- Forward embargo: 15 calendar days after the validation cutoff.
- Untouched holdout decisions: 2025-04-02 through the latest decision date whose 15-day target is fully observed. Holdout labels may be read exactly once by the immutable evaluation run and may not change the candidate, coefficient, transforms, epochs, loss, or promotion criteria.
- Current inference cutoff: the latest complete provider decision time whose inputs satisfy `available_at <= decision cutoff`. Labels are not required for this final inference row.
- Promotion remains `forecast-promotion-v1`: adaptive MAE must be less than or equal to naive MAE and adaptive interval coverage must be at least 70 percent. No tolerance, override, synthetic substitution, or post-holdout tuning is permitted.
- After a pass, a deployment checkpoint may be refit on all labels mature at the current cutoff using the frozen configuration. Its hash, standardizer, calibration, evaluated checkpoint, dataset, run, and promotion event must be recorded before a forecast snapshot is eligible.

The completion run must report per-model forward metrics, the chosen coefficient and validation scores for every grid value, exact window boundaries, input record IDs, point-in-time cutoff checks, conformal adjustment, evaluated and deployment artifact hashes, and whether holdout labels were consumed. A failed forward run remains useful immutable evidence but cannot publish a live recommendation.

## Phase 1 market-only MSPCIFormer/VASA experiment

The new forecasting research direction uses MSPCIFormer as its sole base paper
and isolates sentiment, on-chain inputs, adaptive source gating, equal source
fusion, and multi-source ablations. Historical multimodal and 15-day runs
remain immutable legacy evidence.

The declared Phase 1 protocol uses Coin Metrics daily BTC/ETH/SOL closing
prices, a direct seven-day price path, five trailing input days, patch scales 4
and 5, training-only log-price normalization, a validation-selected trailing
volatility lookback, a seven-day embargo, an untouched chronological holdout,
three expanding walk-forward folds, and seeds 2025/2026/2027. The two active
models differ only by VASA's zero-initialized `1 -> 8 -> 2` volatility
adjustment to the learned scale logits. Naive persistence appeared in the
historical v1 run but is absent from active registration, evaluation, plots,
selection, and UI metadata. Full current details and actual results are in
[`research/mspciformer-vasa-phase1-v2.md`](research/mspciformer-vasa-phase1-v2.md).

The validation-selected checkpoint and saved preprocessing parameters may be
used for inference-only refreshes when newer completed daily observations are
already available. A portfolio request must not retrain the model. Failed
artifact restoration or inference is explicit; no zero-return fallback is
permitted. Forecasts that cannot reach the latest completed UTC day retain
their original dates and are labeled stale.

## Phase 2 seven-day portfolio protocol

Phase 2 reads raw cumulative Day-7 returns from one verified Phase 1 snapshot
and applies a fixed mean–variance policy. Ledoit-Wolf covariance uses the
latest 365 aligned daily returns available at the forecast cutoff and is
multiplied by seven. The objective is `mu^T w - 5.0(w^T Sigma_7 w)`, subject
only to nonnegative weights summing to one. There are no asset caps, minimums,
cash allocation, risk questionnaire, leverage, or short positions. CLARABEL
and SCS solve the identical objective; total solver failure is returned rather
than replaced by another portfolio. Exact-cent reconciliation affects dollar
amounts, not weights.

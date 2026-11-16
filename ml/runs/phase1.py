from __future__ import annotations

import hashlib
import json
import statistics
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import torch
from torch import Tensor

from ml.data.market_daily import (
    ASSETS,
    FORECAST_DAYS,
    MarketHistory,
    MarketSequences,
    align_daily_market,
    build_market_sequences,
    fit_price_standardizer,
    predicted_returns,
    split_indices,
    standardize_volatility,
    trailing_volatility,
)
from ml.evaluation.phase1 import (
    TrainingConfig,
    configure_determinism,
    fit_model_epochs,
    forecast,
    metric_report,
    summarize_scale_weights,
    train_model,
    variability,
)
from ml.models.vasa_mspciformer import (
    MarketMSPCIFormer,
    ScaleAggregation,
    model_config,
    parameter_count,
)
from ml.runs.checkpoints import deterministic_checkpoint
from ml.runs.provenance import run_provenance
from server.app.domain.crypto import ProviderObservation
from server.app.infrastructure.encryption import canonical_json_bytes


@dataclass(frozen=True)
class Phase1Config:
    lookback: int = 5
    forecast_days: int = FORECAST_DAYS
    patch_sizes: tuple[int, ...] = (4, 5)
    patch_stride: int = 2
    model_dimension: int = 16
    attention_heads: int = 2
    transformer_layers: int = 1
    dropout: float = 0.2
    volatility_hidden: int = 8
    volatility_lookback_candidates: tuple[int, ...] = (7, 14, 30)
    seeds: tuple[int, ...] = (2025, 2026, 2027)
    walk_forward_folds: int = 3
    walk_forward_test_days: int = 60
    walk_forward_validation_days: int = 60
    training: TrainingConfig = TrainingConfig()


DEFAULT_PHASE1_CONFIG = Phase1Config()


@dataclass(frozen=True)
class Phase1RunResult:
    run_id: str
    dataset_hash: str
    selected_volatility_lookback: int
    selected_model: str
    manifest: dict[str, object]
    artifacts: dict[str, bytes]
    evidence: dict[str, object]


def run_phase1_research(
    observations: list[ProviderObservation],
    *,
    run_id: str,
    generated_at_utc: datetime,
    config: Phase1Config = DEFAULT_PHASE1_CONFIG,
) -> Phase1RunResult:
    history = align_daily_market(observations)
    if config.forecast_days != FORECAST_DAYS:
        raise ValueError("Phase 1 requires exactly seven forecast days")
    common_origin = max(config.volatility_lookback_candidates)
    lookback_selection: dict[str, float] = {}
    for volatility_lookback in config.volatility_lookback_candidates:
        candidate = build_market_sequences(
            history,
            lookback=config.lookback,
            volatility_lookback=volatility_lookback,
            minimum_origin_index=common_origin,
        )
        train_indices, validation_indices, _ = split_indices(len(candidate.origin_dates))
        standardizer = fit_price_standardizer(
            history,
            through_index=int(candidate.origin_indices[train_indices[-1]]),
        )
        standardized_volatility, _, _ = standardize_volatility(candidate.volatility, train_indices)
        model = _new_model(config, ScaleAggregation.VOLATILITY_ADAPTIVE, config.seeds[0])
        trained = train_model(
            model,
            sequences=candidate,
            standardizer=standardizer,
            standardized_volatility=standardized_volatility,
            train_indices=train_indices,
            validation_indices=validation_indices,
            seed=config.seeds[0],
            config=config.training,
        )
        predicted = forecast(
            trained.model,
            sequences=candidate,
            standardizer=standardizer,
            standardized_volatility=standardized_volatility,
            indices=validation_indices,
        ).prices
        report = metric_report(
            predicted,
            candidate.targets[validation_indices],
            candidate.origin_prices[validation_indices],
        )
        lookback_selection[str(volatility_lookback)] = float(report["aggregate"]["mape"])
    selected_lookback = min(
        config.volatility_lookback_candidates,
        key=lambda value: (lookback_selection[str(value)], value),
    )

    sequences = build_market_sequences(
        history,
        lookback=config.lookback,
        volatility_lookback=selected_lookback,
        minimum_origin_index=common_origin,
    )
    train_indices, validation_indices, test_indices = split_indices(len(sequences.origin_dates))
    standardizer = fit_price_standardizer(
        history,
        through_index=int(sequences.origin_indices[train_indices[-1]]),
    )
    standardized_volatility, volatility_mean, volatility_scale = standardize_volatility(
        sequences.volatility, train_indices
    )
    models = {
        "original-mspciformer": ScaleAggregation.GLOBAL,
        "vasa-mspciformer": ScaleAggregation.VOLATILITY_ADAPTIVE,
    }
    seed_reports: dict[str, list[dict[str, Any]]] = {name: [] for name in models}
    validation_scores: dict[str, list[float]] = {name: [] for name in models}
    ensemble_predictions: dict[str, list[Tensor]] = {name: [] for name in models}
    ensemble_weights: dict[str, list[Tensor]] = {name: [] for name in models}
    trained_epochs: dict[str, list[int]] = {name: [] for name in models}
    latencies: dict[str, list[float]] = {name: [] for name in models}
    parameter_counts: dict[str, int] = {}
    evaluation_checkpoints: dict[str, bytes] = {}

    for seed in config.seeds:
        for name, aggregation in models.items():
            model = _new_model(config, aggregation, seed)
            parameter_counts[name] = parameter_count(model)
            trained = train_model(
                model,
                sequences=sequences,
                standardizer=standardizer,
                standardized_volatility=standardized_volatility,
                train_indices=train_indices,
                validation_indices=validation_indices,
                seed=seed,
                config=config.training,
            )
            validation_batch = forecast(
                trained.model,
                sequences=sequences,
                standardizer=standardizer,
                standardized_volatility=standardized_volatility,
                indices=validation_indices,
            )
            validation_report = metric_report(
                validation_batch.prices,
                sequences.targets[validation_indices],
                sequences.origin_prices[validation_indices],
            )
            validation_scores[name].append(float(validation_report["aggregate"]["mape"]))
            test_batch = forecast(
                trained.model,
                sequences=sequences,
                standardizer=standardizer,
                standardized_volatility=standardized_volatility,
                indices=test_indices,
            )
            report = metric_report(
                test_batch.prices,
                sequences.targets[test_indices],
                sequences.origin_prices[test_indices],
                volatility=sequences.volatility[test_indices],
            )
            seed_reports[name].append({"seed": seed, "metrics": report})
            ensemble_predictions[name].append(test_batch.prices)
            ensemble_weights[name].append(test_batch.scale_weights)
            trained_epochs[name].append(trained.epochs_completed)
            latencies[name].append(test_batch.latency_ms_per_forecast)
            evaluation_checkpoints[f"checkpoint-{name}-seed-{seed}.json"] = (
                deterministic_checkpoint(trained.model, model_config=model_config(trained.model))
            )

    ensemble = {
        name: torch.stack(values).mean(dim=0) for name, values in ensemble_predictions.items()
    }
    weights = {name: torch.stack(values).mean(dim=0) for name, values in ensemble_weights.items()}
    holdout_metrics: dict[str, Any] = {}
    for name in models:
        report = metric_report(
            ensemble[name],
            sequences.targets[test_indices],
            sequences.origin_prices[test_indices],
            volatility=sequences.volatility[test_indices],
        )
        report["seed_variability"] = _seed_variability(seed_reports[name])
        report["parameter_count"] = parameter_counts[name]
        report["latency_ms_per_forecast"] = variability(latencies[name])
        report["scale_weights"] = summarize_scale_weights(
            weights[name], sequences.volatility[test_indices]
        )
        holdout_metrics[name] = report

    selected_model = min(
        models,
        key=lambda name: (statistics.fmean(validation_scores[name]), name),
    )
    walk_forward = _walk_forward(
        history,
        sequences,
        config=config,
        selected_lookback=selected_lookback,
    )
    latest_forecast, checkpoint, preprocessing = _latest_forecast(
        history,
        sequences,
        selected_model=selected_model,
        selected_aggregation=models[selected_model],
        selected_lookback=selected_lookback,
        trained_epochs=trained_epochs[selected_model],
        generated_at_utc=generated_at_utc,
        config=config,
    )

    metrics_document = {
        "schema_version": 2,
        "active_models": list(models),
        "directional_accuracy_definition": (
            "Mean equality of sign(predicted day-d price minus previous predicted price) and "
            "sign(actual day-d price minus previous actual price); Day 1 uses the observed "
            "forecast-origin price for both paths."
        ),
        "primary_evaluation": "untouched chronological 20 percent holdout with seven-day embargo",
        "volatility_lookback_validation_mape": lookback_selection,
        "selected_volatility_lookback_days": selected_lookback,
        "model_selection_validation_mape": {
            name: variability(values) for name, values in validation_scores.items()
        },
        "selected_latest_forecast_model": selected_model,
        "holdout": holdout_metrics,
        "walk_forward": walk_forward,
        "relative_comparisons": _relative_comparisons(holdout_metrics),
    }
    predictions_document = _predictions_document(sequences, test_indices, ensemble)
    figures = {
        "actual-vs-predicted.svg": _trajectory_svg(sequences, test_indices, ensemble),
        "per-horizon-error.svg": _horizon_error_svg(holdout_metrics),
        "volatility-scale-weights.svg": _scale_weight_svg(holdout_metrics),
    }
    data_manifest = {
        "schema_version": 1,
        "provider": "Coin Metrics Community API v4",
        "provider_license": "CC BY-NC 4.0 non-commercial research with attribution",
        "assets": [asset.value for asset in ASSETS],
        "start_date_utc": history.dates[0].isoformat(),
        "end_date_utc": history.dates[-1].isoformat(),
        "daily_observation_count": len(history.dates),
        "missing_complete_days": 0,
        "alignment": "UTC calendar-day inner alignment; contiguous complete BTC/ETH/SOL rows",
        "dataset_hash": history.dataset_hash,
        "source_record_ids_sha256": hashlib.sha256(
            canonical_json_bytes(history.observation_ids)
        ).hexdigest(),
    }
    config_document = _config_document(config)
    artifacts: dict[str, bytes] = {
        "metrics.json": _json_bytes(metrics_document),
        "predictions.json": _json_bytes(predictions_document),
        "latest-forecast.json": _json_bytes(latest_forecast),
        "data-manifest.json": _json_bytes(data_manifest),
        "experiment-config.json": _json_bytes(config_document),
        "deployment-checkpoint.json": checkpoint,
        "deployment-preprocessing.json": preprocessing,
        **evaluation_checkpoints,
        **{name: content.encode("utf-8") for name, content in figures.items()},
    }
    artifact_hashes = {
        name: hashlib.sha256(content).hexdigest() for name, content in artifacts.items()
    }
    provenance = run_provenance(Path.cwd())
    manifest: dict[str, object] = {
        "schema_version": 2,
        "run_id": run_id,
        "purpose": "phase-1-market-only-mspciformer-vasa-research",
        "generated_at_utc": _utc(generated_at_utc),
        "dataset_hash": history.dataset_hash,
        "configuration": config_document,
        "configuration_hash": hashlib.sha256(_json_bytes(config_document)).hexdigest(),
        "git_commit": provenance["git_commit"],
        "git_dirty_state_hash": provenance["git_dirty_state_hash"],
        "code_hash": provenance["code_hash"],
        "dependency_lock_hash": provenance["dependency_lock_hash"],
        "dependency_lock": provenance["dependency_lock"],
        "container_image_digest": provenance["container_image_digest"],
        "environment": provenance["environment"],
        "seeds": list(config.seeds),
        "determinism": {
            "cpu_only": True,
            "deterministic_algorithms": True,
            "random_shuffling": False,
            "torch_threads": 1,
        },
        "splits": {
            "train": _split_summary(sequences, train_indices),
            "validation": _split_summary(sequences, validation_indices),
            "test": _split_summary(sequences, test_indices),
            "embargo_days": FORECAST_DAYS,
        },
        "selected_volatility_lookback_days": selected_lookback,
        "selected_latest_forecast_model": selected_model,
        "active_models": list(models),
        "comparison_protocol": "original-mspciformer-versus-vasa-only",
        "artifact_hashes": artifact_hashes,
        "author_repository_code_copied": False,
        "author_repository_reference_commit": "6c0970462aa0412b2c664fefdbabc71cc17fb775",
        "exact_paper_reproduction": False,
        "scope": "local non-commercial research only; no trading or investment advice",
    }
    evidence = _evidence(
        history,
        sequences,
        test_indices,
        metrics_document,
        latest_forecast,
        run_id=run_id,
        generated_at_utc=generated_at_utc,
        artifact_hashes=artifact_hashes,
    )
    return Phase1RunResult(
        run_id=run_id,
        dataset_hash=history.dataset_hash,
        selected_volatility_lookback=selected_lookback,
        selected_model=selected_model,
        manifest=manifest,
        artifacts=artifacts,
        evidence=evidence,
    )


def _new_model(
    config: Phase1Config,
    aggregation: ScaleAggregation,
    seed: int,
) -> MarketMSPCIFormer:
    configure_determinism(seed)
    return MarketMSPCIFormer(
        aggregation=aggregation,
        lookback=config.lookback,
        patch_sizes=config.patch_sizes,
        stride=config.patch_stride,
        model_dimension=config.model_dimension,
        heads=config.attention_heads,
        layers=config.transformer_layers,
        dropout=config.dropout,
        volatility_hidden=config.volatility_hidden,
    )


def _walk_forward(
    history: MarketHistory,
    sequences: MarketSequences,
    *,
    config: Phase1Config,
    selected_lookback: int,
) -> dict[str, Any]:
    del selected_lookback
    fold_predictions: dict[str, list[Tensor]] = {
        "original-mspciformer": [],
        "vasa-mspciformer": [],
    }
    fold_actual: list[Tensor] = []
    fold_origins: list[Tensor] = []
    folds: list[dict[str, object]] = []
    total_test = config.walk_forward_folds * config.walk_forward_test_days
    initial_test = len(sequences.origin_dates) - total_test
    if initial_test <= config.walk_forward_validation_days + FORECAST_DAYS * 2:
        raise ValueError("insufficient samples for configured walk-forward evaluation")
    for fold in range(config.walk_forward_folds):
        test_start = initial_test + fold * config.walk_forward_test_days
        test_stop = test_start + config.walk_forward_test_days
        validation_stop = test_start - FORECAST_DAYS
        validation_start = validation_stop - config.walk_forward_validation_days
        train_stop = validation_start - FORECAST_DAYS
        train_indices = torch.arange(0, train_stop, dtype=torch.long)
        validation_indices = torch.arange(validation_start, validation_stop, dtype=torch.long)
        test_indices = torch.arange(test_start, test_stop, dtype=torch.long)
        standardizer = fit_price_standardizer(
            history,
            through_index=int(sequences.origin_indices[train_indices[-1]]),
        )
        standardized_volatility, _, _ = standardize_volatility(sequences.volatility, train_indices)
        fold_record: dict[str, object] = {
            "fold": fold + 1,
            "train": _split_summary(sequences, train_indices),
            "validation": _split_summary(sequences, validation_indices),
            "test": _split_summary(sequences, test_indices),
        }
        for name, aggregation in (
            ("original-mspciformer", ScaleAggregation.GLOBAL),
            ("vasa-mspciformer", ScaleAggregation.VOLATILITY_ADAPTIVE),
        ):
            model = _new_model(config, aggregation, config.seeds[0])
            trained = train_model(
                model,
                sequences=sequences,
                standardizer=standardizer,
                standardized_volatility=standardized_volatility,
                train_indices=train_indices,
                validation_indices=validation_indices,
                seed=config.seeds[0],
                config=config.training,
            )
            predicted = forecast(
                trained.model,
                sequences=sequences,
                standardizer=standardizer,
                standardized_volatility=standardized_volatility,
                indices=test_indices,
            ).prices
            fold_predictions[name].append(predicted)
        fold_actual.append(sequences.targets[test_indices])
        fold_origins.append(sequences.origin_prices[test_indices])
        folds.append(fold_record)
    actual = torch.cat(fold_actual)
    origins = torch.cat(fold_origins)
    return {
        "protocol": "three expanding training windows; moving validation and test blocks",
        "folds": folds,
        "metrics": {
            name: metric_report(torch.cat(values), actual, origins)
            for name, values in fold_predictions.items()
        },
    }


def _latest_forecast(
    history: MarketHistory,
    sequences: MarketSequences,
    *,
    selected_model: str,
    selected_aggregation: ScaleAggregation,
    selected_lookback: int,
    trained_epochs: list[int],
    generated_at_utc: datetime,
    config: Phase1Config,
) -> tuple[dict[str, object], bytes, bytes]:
    all_indices = torch.arange(len(sequences.origin_dates), dtype=torch.long)
    final_training_origin = int(sequences.origin_indices[-1])
    standardizer = fit_price_standardizer(history, through_index=final_training_origin)
    standardized_volatility, volatility_mean, volatility_scale = standardize_volatility(
        sequences.volatility, all_indices
    )
    epochs = max(1, round(statistics.median(trained_epochs)))
    model = _new_model(config, selected_aggregation, config.seeds[0])
    fit_model_epochs(
        model,
        sequences=sequences,
        standardizer=standardizer,
        standardized_volatility=standardized_volatility,
        indices=all_indices,
        seed=config.seeds[0],
        config=config.training,
        epochs=epochs,
    )
    latest_inputs = standardizer.transform(history.prices[-config.lookback :]).unsqueeze(0)
    latest_raw_volatility = trailing_volatility(
        history.prices,
        origin_index=len(history.dates) - 1,
        lookback=selected_lookback,
    )
    latest_volatility = ((latest_raw_volatility - volatility_mean) / volatility_scale).unsqueeze(0)
    model.eval()
    with torch.inference_mode():
        output = model(latest_inputs.to(torch.float32), latest_volatility.to(torch.float32))
        predicted = standardizer.inverse(output.standardized_log_prices.to(torch.float64))[0]
    if not torch.isfinite(predicted).all() or bool((predicted <= 0).any()):
        raise RuntimeError("latest model forecast failed finite-positive quality checks")
    _, cumulative = predicted_returns(predicted.unsqueeze(0), history.prices[-1].unsqueeze(0))
    last_date = history.dates[-1]
    assets: dict[str, object] = {}
    for asset_index, asset in enumerate(ASSETS):
        assets[asset.value] = {
            "current_price": round(float(history.prices[-1, asset_index]), 8),
            "predicted_prices": [round(float(value), 8) for value in predicted[:, asset_index]],
            "predicted_daily_returns": _daily_returns(
                predicted[:, asset_index], history.prices[-1, asset_index]
            ),
            "predicted_return_7d": round(float(cumulative[0, asset_index]), 10),
            "scale_weights": [
                round(float(value), 10) for value in output.scale_weights[0, asset_index]
            ],
        }
    document: dict[str, object] = {
        "schema_version": 2,
        "model": (
            "VASA-MSPCIFormer"
            if selected_aggregation is ScaleAggregation.VOLATILITY_ADAPTIVE
            else "Original MSPCIFormer reimplementation"
        ),
        "model_key": selected_model,
        "model_version": "phase1-market-only-v2",
        "forecast_horizon_days": FORECAST_DAYS,
        "generated_at_utc": _utc(generated_at_utc),
        "market_data_cutoff_utc": f"{last_date.isoformat()}T00:00:00Z",
        "forecast_dates_utc": [
            (last_date + timedelta(days=offset)).isoformat()
            for offset in range(1, FORECAST_DAYS + 1)
        ],
        "training_data_fitted_through_utc": (
            f"{history.dates[final_training_origin].isoformat()}T00:00:00Z"
        ),
        "deployment_training_epochs": epochs,
        "quality_checks": {"finite": True, "positive_prices": True, "fallback_used": False},
        "assets": assets,
        "research_only": True,
    }
    checkpoint = deterministic_checkpoint(model, model_config=model_config(model))
    preprocessing = _json_bytes(
        {
            "schema_version": 1,
            "lookback": config.lookback,
            "volatility_lookback": selected_lookback,
            "price_log_mean": [round(float(value), 16) for value in standardizer.mean],
            "price_log_scale": [round(float(value), 16) for value in standardizer.scale],
            "volatility_mean": [round(float(value), 16) for value in volatility_mean],
            "volatility_scale": [round(float(value), 16) for value in volatility_scale],
            "fitted_through_utc": f"{standardizer.fitted_through.isoformat()}T00:00:00Z",
            "selected_model": selected_model,
        }
    )
    return document, checkpoint, preprocessing


def _predictions_document(
    sequences: MarketSequences,
    indices: Tensor,
    predictions: dict[str, Tensor],
) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    for position, sequence_index in enumerate(indices.tolist()):
        rows.append(
            {
                "origin_date": sequences.origin_dates[sequence_index].isoformat(),
                "target_dates": [
                    value.isoformat() for value in sequences.target_dates[sequence_index]
                ],
                "origin_prices": _matrix_row(sequences.origin_prices[sequence_index]),
                "actual_prices": _matrix(sequences.targets[sequence_index]),
                "predicted_prices": {
                    name: _matrix(values[position]) for name, values in predictions.items()
                },
            }
        )
    return {"schema_version": 1, "assets": [asset.value for asset in ASSETS], "rows": rows}


def _relative_comparisons(metrics: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for asset in ASSETS:
        original = float(metrics["original-mspciformer"]["by_asset"][asset.value]["day_7_mae_usd"])
        vasa = float(metrics["vasa-mspciformer"]["by_asset"][asset.value]["day_7_mae_usd"])
        result[asset.value] = {
            "vasa_vs_original_day_7_mae_percent": _improvement(original, vasa),
        }
    return result


def _evidence(
    history: MarketHistory,
    sequences: MarketSequences,
    test_indices: Tensor,
    metrics: dict[str, Any],
    latest: dict[str, object],
    *,
    run_id: str,
    generated_at_utc: datetime,
    artifact_hashes: dict[str, str],
) -> dict[str, object]:
    holdout = metrics["holdout"]
    comparison: dict[str, object] = {}
    for name in ("original-mspciformer", "vasa-mspciformer"):
        comparison[name] = {
            "btc_day_7_mae_usd": holdout[name]["by_asset"]["BTC"]["day_7_mae_usd"],
            "eth_day_7_mae_usd": holdout[name]["by_asset"]["ETH"]["day_7_mae_usd"],
            "sol_day_7_mae_usd": holdout[name]["by_asset"]["SOL"]["day_7_mae_usd"],
            "return_7d_mae": holdout[name]["aggregate"]["return_7d_mae"],
            "mda": holdout[name]["aggregate"]["mda"],
            "mape": holdout[name]["aggregate"]["mape"],
        }
    return {
        "schema_version": 2,
        "completed_at_utc": _utc(generated_at_utc),
        "scope": "Milestone 5 Phase 1 local non-commercial provider-data research",
        "run_id": run_id,
        "dataset_hash": history.dataset_hash,
        "data_period": {
            "start": history.dates[0].isoformat(),
            "end": history.dates[-1].isoformat(),
        },
        "test_period": {
            "start": sequences.origin_dates[int(test_indices[0])].isoformat(),
            "end": sequences.origin_dates[int(test_indices[-1])].isoformat(),
            "sample_count": len(test_indices),
        },
        "selected_volatility_lookback_days": metrics["selected_volatility_lookback_days"],
        "selected_latest_forecast_model": metrics["selected_latest_forecast_model"],
        "comparison": comparison,
        "relative_comparisons": metrics["relative_comparisons"],
        "active_models": ["original-mspciformer", "vasa-mspciformer"],
        "latest_forecast": latest,
        "artifact_hashes": artifact_hashes,
        "full_artifacts_persisted_in_resilientdb": True,
        "portfolio_integration_ready": True,
        "author_repository_code_copied": False,
        "exact_paper_reproduction": False,
    }


def _seed_variability(reports: list[dict[str, Any]]) -> dict[str, Any]:
    fields = ("mape", "mda", "return_7d_mae")
    return {
        field: variability([float(item["metrics"]["aggregate"][field]) for item in reports])
        for field in fields
    }


def _config_document(config: Phase1Config) -> dict[str, object]:
    value = asdict(config)
    value["patch_sizes"] = list(config.patch_sizes)
    value["volatility_lookback_candidates"] = list(config.volatility_lookback_candidates)
    value["seeds"] = list(config.seeds)
    return value


def _split_summary(sequences: MarketSequences, indices: Tensor) -> dict[str, object]:
    return {
        "sample_count": len(indices),
        "origin_start": sequences.origin_dates[int(indices[0])].isoformat(),
        "origin_end": sequences.origin_dates[int(indices[-1])].isoformat(),
        "last_target_date": sequences.target_dates[int(indices[-1])][-1].isoformat(),
    }


def _trajectory_svg(
    sequences: MarketSequences,
    indices: Tensor,
    predictions: dict[str, Tensor],
) -> str:
    width, height = 1000, 720
    margin = 60
    panel_height = 190
    colors = {
        "actual": "#111827",
        "original-mspciformer": "#2563eb",
        "vasa-mspciformer": "#eab308",
    }
    parts = [_svg_start(width, height, "Untouched holdout: Day-7 actual vs predicted prices")]
    actual = sequences.targets[indices, -1]
    for asset_index, asset in enumerate(ASSETS):
        top = 55 + asset_index * 215
        series = [actual[:, asset_index]] + [
            values[:, -1, asset_index] for values in predictions.values()
        ]
        low = min(float(value.min()) for value in series)
        high = max(float(value.max()) for value in series)
        span = max(high - low, 1e-9)
        parts.append(
            f'<text x="{margin}" y="{top - 10}" font-size="16" '
            f'font-weight="600">{asset.value} USD</text>'
        )
        parts.append(
            f'<rect x="{margin}" y="{top}" width="{width - 2 * margin}" '
            f'height="{panel_height}" fill="none" stroke="#d1d5db"/>'
        )
        for name, values in (("actual", actual), *predictions.items()):
            vector = values[:, asset_index] if name == "actual" else values[:, -1, asset_index]
            points = []
            for index, value in enumerate(vector):
                x = margin + index * (width - 2 * margin) / max(len(vector) - 1, 1)
                y = top + panel_height - (float(value) - low) / span * panel_height
                points.append(f"{x:.2f},{y:.2f}")
            parts.append(
                f'<polyline points="{" ".join(points)}" fill="none" '
                f'stroke="{colors[name]}" stroke-width="1.5"/>'
            )
    parts.append(
        _legend(
            {
                "Actual": colors["actual"],
                "Original": colors["original-mspciformer"],
                "VASA": colors["vasa-mspciformer"],
            },
            width - 310,
            25,
            spacing=95,
        )
    )
    parts.append("</g></svg>")
    return "".join(parts)


def _horizon_error_svg(metrics: dict[str, Any]) -> str:
    width, height = 900, 640
    parts = [_svg_start(width, height, "Per-horizon mean absolute percentage error")]
    colors = {
        "original-mspciformer": "#2563eb",
        "vasa-mspciformer": "#eab308",
    }
    for asset_index, asset in enumerate(ASSETS):
        top = 60 + asset_index * 180
        values = {
            name: [
                float(item["mape"]) for item in metrics[name]["by_asset"][asset.value]["horizons"]
            ]
            for name in colors
        }
        maximum = max(max(row) for row in values.values()) or 1.0
        parts.append(
            f'<text x="55" y="{top - 8}" font-size="15" font-weight="600">{asset.value}</text>'
        )
        parts.append(
            f'<rect x="55" y="{top}" width="790" height="130" fill="none" stroke="#d1d5db"/>'
        )
        for name, row in values.items():
            points = []
            for horizon, value in enumerate(row):
                x = 75 + horizon * 120
                y = top + 120 - value / maximum * 110
                points.append(f"{x:.2f},{y:.2f}")
                if name == "original-mspciformer":
                    parts.append(
                        f'<text x="{x - 4}" y="{top + 148}" font-size="11">D{horizon + 1}</text>'
                    )
            parts.append(
                f'<polyline points="{" ".join(points)}" fill="none" '
                f'stroke="{colors[name]}" stroke-width="2"/>'
            )
    parts.append(
        _legend(
            {
                "Original": colors["original-mspciformer"],
                "VASA": colors["vasa-mspciformer"],
            },
            665,
            25,
            spacing=100,
        )
    )
    parts.append("</g></svg>")
    return "".join(parts)


def _scale_weight_svg(metrics: dict[str, Any]) -> str:
    width, height = 900, 420
    parts = [_svg_start(width, height, "VASA scale weights by volatility regime")]
    report = metrics["vasa-mspciformer"]["scale_weights"]
    colors = ("#2563eb", "#eab308")
    for asset_index, asset in enumerate(ASSETS):
        left = 90 + asset_index * 270
        low = report[asset.value]["low_volatility_mean_weights"]
        high = report[asset.value]["high_volatility_mean_weights"]
        parts.append(
            f'<text x="{left}" y="70" font-size="16" font-weight="600">{asset.value}</text>'
        )
        for regime_index, (label, values) in enumerate((("Low vol", low), ("High vol", high))):
            x = left + regime_index * 95
            bottom = 330
            for scale_index, value in enumerate(values):
                bar_height = float(value) * 230
                parts.append(
                    f'<rect x="{x + scale_index * 34}" '
                    f'y="{bottom - bar_height:.2f}" width="28" '
                    f'height="{bar_height:.2f}" fill="{colors[scale_index]}"/>'
                )
            parts.append(f'<text x="{x}" y="352" font-size="11">{label}</text>')
    parts.append(
        '<text x="600" y="390" font-size="12" fill="#2563eb">Patch 4</text>'
        '<text x="690" y="390" font-size="12" fill="#b58b00">Patch 5</text>'
    )
    parts.append("</g></svg>")
    return "".join(parts)


def _svg_start(width: int, height: int, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
        f'height="{height}" viewBox="0 0 {width} {height}">'
        '<rect width="100%" height="100%" fill="#ffffff"/>'
        '<text x="24" y="28" font-family="sans-serif" font-size="18" '
        f'font-weight="700">{title}</text>'
        '<g font-family="sans-serif">'
    )


def _legend(colors: dict[str, str], x: int, y: int, *, spacing: int = 120) -> str:
    parts = []
    for index, (name, color) in enumerate(colors.items()):
        offset = index * spacing
        parts.append(
            f'<line x1="{x + offset}" y1="{y}" x2="{x + offset + 20}" '
            f'y2="{y}" stroke="{color}" stroke-width="3"/>'
            f'<text x="{x + offset + 24}" y="{y + 4}" font-size="10">{name}</text>'
        )
    return "".join(parts)


def _daily_returns(predicted: Tensor, origin: Tensor) -> list[float]:
    previous = torch.cat((origin.reshape(1), predicted[:-1]))
    return [round(float(value), 10) for value in predicted / previous - 1.0]


def _matrix(values: Tensor) -> list[list[float]]:
    return [[round(float(value), 8) for value in row] for row in values]


def _matrix_row(values: Tensor) -> list[float]:
    return [round(float(value), 8) for value in values]


def _improvement(reference: float, candidate: float) -> float:
    return round((reference - candidate) / reference * 100.0, 6) if reference else 0.0


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _utc(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")

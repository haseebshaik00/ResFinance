from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import torch

from ml.data.market_daily import (
    ASSETS,
    FORECAST_DAYS,
    PriceStandardizer,
    align_daily_market,
    predicted_returns,
    trailing_volatility,
)
from ml.models.vasa_mspciformer import MarketMSPCIFormer, ScaleAggregation
from ml.runs.checkpoints import restore_checkpoint
from server.app.domain.crypto import ProviderObservation


def forecast_from_deployment_artifacts(
    observations: list[ProviderObservation],
    *,
    checkpoint: bytes,
    preprocessing: bytes,
    experiment_config: bytes,
    generated_at_utc: datetime,
) -> dict[str, object]:
    """Run inference only with an immutable Phase 1 deployment bundle."""

    history = align_daily_market(observations)
    pre = _object(preprocessing, "deployment preprocessing")
    config = _object(experiment_config, "experiment config")
    if pre.get("schema_version") != 1:
        raise ValueError("unsupported deployment preprocessing schema")
    selected_model = str(pre.get("selected_model", ""))
    aggregation = {
        "original-mspciformer": ScaleAggregation.GLOBAL,
        "vasa-mspciformer": ScaleAggregation.VOLATILITY_ADAPTIVE,
    }.get(selected_model)
    if aggregation is None:
        raise ValueError("deployment metadata selected an unsupported model")
    lookback = _positive_int(pre, "lookback")
    volatility_lookback = _positive_int(pre, "volatility_lookback")
    if len(history.dates) <= max(lookback, volatility_lookback):
        raise ValueError("insufficient market history for Phase 1 inference")
    model = MarketMSPCIFormer(
        aggregation=aggregation,
        lookback=lookback,
        patch_sizes=tuple(int(str(value)) for value in _list(config, "patch_sizes")),
        stride=_positive_int(config, "patch_stride"),
        model_dimension=_positive_int(config, "model_dimension"),
        heads=_positive_int(config, "attention_heads"),
        layers=_positive_int(config, "transformer_layers"),
        dropout=float(config["dropout"]),
        volatility_hidden=_positive_int(config, "volatility_hidden"),
    )
    checkpoint_hash = restore_checkpoint(model, checkpoint)
    standardizer = PriceStandardizer(
        mean=_vector(pre, "price_log_mean"),
        scale=_positive_vector(pre, "price_log_scale"),
        fitted_through=datetime.fromisoformat(
            str(pre["fitted_through_utc"]).replace("Z", "+00:00")
        ).date(),
    )
    volatility_mean = _vector(pre, "volatility_mean")
    volatility_scale = _positive_vector(pre, "volatility_scale")
    inputs = standardizer.transform(history.prices[-lookback:]).unsqueeze(0)
    raw_volatility = trailing_volatility(
        history.prices,
        origin_index=len(history.dates) - 1,
        lookback=volatility_lookback,
    )
    standardized_volatility = ((raw_volatility - volatility_mean) / volatility_scale).unsqueeze(0)
    model.eval()
    with torch.inference_mode():
        output = model(inputs.to(torch.float32), standardized_volatility.to(torch.float32))
        prices = standardizer.inverse(output.standardized_log_prices.to(torch.float64))[0]
    if not torch.isfinite(prices).all() or bool((prices <= 0).any()):
        raise RuntimeError("Phase 1 checkpoint produced invalid forecast prices")
    daily, cumulative = predicted_returns(prices.unsqueeze(0), history.prices[-1].unsqueeze(0))
    cutoff = history.dates[-1]
    assets: dict[str, object] = {}
    for index, asset in enumerate(ASSETS):
        assets[asset.value] = {
            "current_price": _decimal(history.prices[-1, index], 8),
            "predicted_prices": [_decimal(value, 8) for value in prices[:, index]],
            "predicted_daily_returns": [_decimal(value, 10) for value in daily[0, :, index]],
            "predicted_return_7d": _decimal(cumulative[0, index], 10),
            "scale_weights": [_decimal(value, 10) for value in output.scale_weights[0, index]],
        }
    return {
        "schema_version": 2,
        "model": (
            "Original MSPCIFormer reimplementation"
            if aggregation is ScaleAggregation.GLOBAL
            else "VASA-MSPCIFormer"
        ),
        "model_key": selected_model,
        "model_version": "phase1-market-only-v2",
        "forecast_horizon_days": FORECAST_DAYS,
        "generated_at_utc": _utc(generated_at_utc),
        "market_data_cutoff_utc": f"{cutoff.isoformat()}T00:00:00Z",
        "forecast_dates_utc": [
            (cutoff + timedelta(days=offset)).isoformat()
            for offset in range(1, FORECAST_DAYS + 1)
        ],
        "training_data_fitted_through_utc": str(pre["fitted_through_utc"]),
        "quality_checks": {
            "finite": True,
            "positive_prices": True,
            "fallback_used": False,
            "checkpoint_sha256": checkpoint_hash,
        },
        "assets": assets,
        "research_only": True,
        "inference_only_refresh": True,
    }


def _object(content: bytes, label: str) -> dict[str, Any]:
    value = json.loads(content)
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return cast(dict[str, Any], value)


def _list(value: dict[str, Any], field: str) -> list[object]:
    item = value.get(field)
    if not isinstance(item, list) or not item:
        raise ValueError(f"{field} must be a non-empty list")
    return cast(list[object], item)


def _positive_int(value: dict[str, Any], field: str) -> int:
    item = value.get(field)
    if isinstance(item, bool) or not isinstance(item, int) or item <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return item


def _vector(value: dict[str, Any], field: str) -> torch.Tensor:
    result = torch.tensor(
        [float(str(item)) for item in _list(value, field)], dtype=torch.float64
    )
    if result.shape != (len(ASSETS),) or not torch.isfinite(result).all():
        raise ValueError(f"{field} must contain three finite values")
    return result


def _positive_vector(value: dict[str, Any], field: str) -> torch.Tensor:
    result = _vector(value, field)
    if bool((result <= 0).any()):
        raise ValueError(f"{field} values must be positive")
    return result


def _decimal(value: torch.Tensor, places: int) -> str:
    return f"{float(value):.{places}f}"


def _utc(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def artifact_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

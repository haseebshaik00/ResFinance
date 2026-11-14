from __future__ import annotations

import copy
import math
import random
import statistics
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from torch import Tensor, nn
from torch.utils.data import DataLoader, TensorDataset

from ml.data.market_daily import ASSETS, FORECAST_DAYS, MarketSequences, PriceStandardizer
from ml.models.vasa_mspciformer import MarketMSPCIFormer


@dataclass(frozen=True)
class TrainingConfig:
    epochs: int = 30
    batch_size: int = 64
    learning_rate: float = 0.003
    weight_decay: float = 0.0001
    patience: int = 6


@dataclass(frozen=True)
class TrainedModel:
    model: MarketMSPCIFormer
    validation_loss: float
    epochs_completed: int


@dataclass(frozen=True)
class ForecastBatch:
    prices: Tensor
    scale_weights: Tensor
    latency_ms_per_forecast: float


def fit_model_epochs(
    model: MarketMSPCIFormer,
    *,
    sequences: MarketSequences,
    standardizer: PriceStandardizer,
    standardized_volatility: Tensor,
    indices: Tensor,
    seed: int,
    config: TrainingConfig,
    epochs: int,
) -> MarketMSPCIFormer:
    if epochs < 1:
        raise ValueError("deployment epochs must be positive")
    configure_determinism(seed)
    inputs = standardizer.transform(sequences.inputs).to(torch.float32)
    targets = standardizer.transform(sequences.targets).to(torch.float32)
    volatility = standardized_volatility.to(torch.float32)
    loader = DataLoader(
        TensorDataset(inputs[indices], volatility[indices], targets[indices]),
        batch_size=config.batch_size,
        shuffle=False,
    )
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )
    for _ in range(epochs):
        model.train()
        for batch_inputs, batch_volatility, batch_targets in loader:
            optimizer.zero_grad(set_to_none=True)
            output = model(batch_inputs, batch_volatility)
            loss = nn.functional.mse_loss(output.standardized_log_prices, batch_targets)
            loss.backward()  # type: ignore[no-untyped-call]
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
    return model


def configure_determinism(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)


def train_model(
    model: MarketMSPCIFormer,
    *,
    sequences: MarketSequences,
    standardizer: PriceStandardizer,
    standardized_volatility: Tensor,
    train_indices: Tensor,
    validation_indices: Tensor,
    seed: int,
    config: TrainingConfig,
) -> TrainedModel:
    configure_determinism(seed)
    inputs = standardizer.transform(sequences.inputs).to(torch.float32)
    targets = standardizer.transform(sequences.targets).to(torch.float32)
    volatility = standardized_volatility.to(torch.float32)
    loader = DataLoader(
        TensorDataset(inputs[train_indices], volatility[train_indices], targets[train_indices]),
        batch_size=config.batch_size,
        shuffle=False,
    )
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )
    best_loss = math.inf
    best_state: dict[str, Tensor] | None = None
    stale = 0
    completed = 0
    for epoch in range(config.epochs):
        model.train()
        for batch_inputs, batch_volatility, batch_targets in loader:
            optimizer.zero_grad(set_to_none=True)
            output = model(batch_inputs, batch_volatility)
            loss = nn.functional.mse_loss(output.standardized_log_prices, batch_targets)
            loss.backward()  # type: ignore[no-untyped-call]
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
        validation_loss = _loss(
            model,
            inputs[validation_indices],
            volatility[validation_indices],
            targets[validation_indices],
        )
        completed = epoch + 1
        if validation_loss < best_loss - 1e-8:
            best_loss = validation_loss
            best_state = copy.deepcopy(model.state_dict())
            stale = 0
        else:
            stale += 1
            if stale >= config.patience:
                break
    if best_state is None:
        raise RuntimeError("training did not produce a validation checkpoint")
    model.load_state_dict(best_state)
    return TrainedModel(model=model, validation_loss=best_loss, epochs_completed=completed)


def forecast(
    model: MarketMSPCIFormer,
    *,
    sequences: MarketSequences,
    standardizer: PriceStandardizer,
    standardized_volatility: Tensor,
    indices: Tensor,
    latency_repetitions: int = 50,
) -> ForecastBatch:
    model.eval()
    inputs = standardizer.transform(sequences.inputs[indices]).to(torch.float32)
    volatility = standardized_volatility[indices].to(torch.float32)
    with torch.inference_mode():
        output = model(inputs, volatility)
        prices = standardizer.inverse(output.standardized_log_prices.to(torch.float64))
        single_input = inputs[:1]
        single_volatility = volatility[:1]
        for _ in range(5):
            model(single_input, single_volatility)
        started = time.perf_counter_ns()
        for _ in range(latency_repetitions):
            model(single_input, single_volatility)
        elapsed = time.perf_counter_ns() - started
    return ForecastBatch(
        prices=prices,
        scale_weights=output.scale_weights.to(torch.float64),
        latency_ms_per_forecast=elapsed / latency_repetitions / 1_000_000,
    )


def metric_report(
    predicted: Tensor,
    actual: Tensor,
    origin_prices: Tensor,
    *,
    volatility: Tensor | None = None,
) -> dict[str, Any]:
    if predicted.shape != actual.shape or predicted.ndim != 3:
        raise ValueError("predicted and actual price tensors must have matching rank-three shapes")
    error = predicted - actual
    absolute = error.abs()
    squared = error.square()
    percentage = absolute / actual.abs().clamp_min(1e-12)
    previous_predicted = torch.cat((origin_prices.unsqueeze(1), predicted[:, :-1]), dim=1)
    previous_actual = torch.cat((origin_prices.unsqueeze(1), actual[:, :-1]), dim=1)
    predicted_direction = torch.sign(predicted - previous_predicted)
    actual_direction = torch.sign(actual - previous_actual)
    directional = (predicted_direction == actual_direction).to(torch.float64)
    predicted_return_7d = predicted[:, -1] / origin_prices - 1.0
    actual_return_7d = actual[:, -1] / origin_prices - 1.0
    return_error = (predicted_return_7d - actual_return_7d).abs()

    by_asset: dict[str, Any] = {}
    for asset_index, asset in enumerate(ASSETS):
        horizons = []
        for horizon in range(FORECAST_DAYS):
            horizons.append(
                {
                    "day": horizon + 1,
                    "mae_usd": _round(absolute[:, horizon, asset_index].mean()),
                    "rmse_usd": _round(squared[:, horizon, asset_index].mean().sqrt()),
                    "mape": _round(percentage[:, horizon, asset_index].mean()),
                    "mda": _round(directional[:, horizon, asset_index].mean()),
                }
            )
        asset_report: dict[str, Any] = {
            "mae_usd": _round(absolute[:, :, asset_index].mean()),
            "rmse_usd": _round(squared[:, :, asset_index].mean().sqrt()),
            "mape": _round(percentage[:, :, asset_index].mean()),
            "mda": _round(directional[:, :, asset_index].mean()),
            "return_7d_mae": _round(return_error[:, asset_index].mean()),
            "day_7_mae_usd": _round(absolute[:, -1, asset_index].mean()),
            "horizons": horizons,
        }
        if volatility is not None:
            threshold = torch.median(volatility[:, asset_index])
            low = volatility[:, asset_index] <= threshold
            high = volatility[:, asset_index] > threshold
            asset_report["volatility_regimes"] = {
                "threshold": _round(threshold),
                "low_count": int(low.sum()),
                "high_count": int(high.sum()),
                "low_day_7_mae_usd": _round(absolute[low, -1, asset_index].mean()),
                "high_day_7_mae_usd": _round(absolute[high, -1, asset_index].mean()),
            }
        by_asset[asset.value] = asset_report
    return {
        "aggregate": {
            "mae_usd_unscaled": _round(absolute.mean()),
            "rmse_usd_unscaled": _round(squared.mean().sqrt()),
            "mape": _round(percentage.mean()),
            "mda": _round(directional.mean()),
            "return_7d_mae": _round(return_error.mean()),
        },
        "by_asset": by_asset,
    }


def naive_prices(sequences: MarketSequences, indices: Tensor) -> Tensor:
    return sequences.origin_prices[indices].unsqueeze(1).expand(-1, FORECAST_DAYS, -1)


def summarize_scale_weights(weights: Tensor, volatility: Tensor) -> dict[str, Any]:
    if weights.ndim != 3 or weights.shape[:2] != volatility.shape:
        raise ValueError("scale weights and volatility shapes are inconsistent")
    result: dict[str, Any] = {}
    for asset_index, asset in enumerate(ASSETS):
        threshold = torch.median(volatility[:, asset_index])
        low = volatility[:, asset_index] <= threshold
        high = volatility[:, asset_index] > threshold
        result[asset.value] = {
            "volatility_threshold": _round(threshold),
            "low_volatility_mean_weights": [
                _round(value) for value in weights[low, asset_index].mean(dim=0)
            ],
            "high_volatility_mean_weights": [
                _round(value) for value in weights[high, asset_index].mean(dim=0)
            ],
        }
    return result


def variability(values: list[float]) -> dict[str, float]:
    if not values:
        raise ValueError("variability requires at least one value")
    return {
        "mean": round(statistics.fmean(values), 10),
        "standard_deviation": round(statistics.pstdev(values), 10),
    }


def _loss(model: MarketMSPCIFormer, inputs: Tensor, volatility: Tensor, targets: Tensor) -> float:
    model.eval()
    with torch.inference_mode():
        output = model(inputs, volatility)
        return float(nn.functional.mse_loss(output.standardized_log_prices, targets))


def _round(value: Tensor | float) -> float:
    if isinstance(value, Tensor):
        value = float(value)
    if not math.isfinite(value):
        raise ValueError("metric is not finite")
    return round(value, 10)

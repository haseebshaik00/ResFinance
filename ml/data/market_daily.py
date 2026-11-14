from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

import torch
from torch import Tensor

from server.app.domain.crypto import CryptoAsset, ObservationChannel, ProviderObservation
from server.app.infrastructure.encryption import canonical_json_bytes

ASSETS = (CryptoAsset.BTC, CryptoAsset.ETH, CryptoAsset.SOL)
FORECAST_DAYS = 7


@dataclass(frozen=True)
class MarketHistory:
    dates: tuple[date, ...]
    prices: Tensor
    observation_ids: tuple[tuple[str, ...], ...]
    dataset_hash: str


@dataclass(frozen=True)
class PriceStandardizer:
    mean: Tensor
    scale: Tensor
    fitted_through: date

    def transform(self, prices: Tensor) -> Tensor:
        return (torch.log(prices) - self.mean) / self.scale

    def inverse(self, values: Tensor) -> Tensor:
        return torch.exp(values * self.scale + self.mean)


@dataclass(frozen=True)
class MarketSequences:
    inputs: Tensor
    targets: Tensor
    origin_prices: Tensor
    volatility: Tensor
    origin_dates: tuple[date, ...]
    target_dates: tuple[tuple[date, ...], ...]
    origin_indices: Tensor


def align_daily_market(
    observations: Sequence[ProviderObservation],
    *,
    start: date | None = None,
    end: date | None = None,
) -> MarketHistory:
    by_day: dict[date, dict[CryptoAsset, ProviderObservation]] = {}
    for item in observations:
        if (
            item.asset not in ASSETS
            or item.channel is not ObservationChannel.MARKET
            or item.metric != "price_usd"
            or item.interval != "1d"
            or item.missing
            or item.decimal_value is None
        ):
            continue
        observed_day = item.observed_at_utc.date()
        if start is not None and observed_day < start:
            continue
        if end is not None and observed_day > end:
            continue
        asset_rows = by_day.setdefault(observed_day, {})
        previous_observation = asset_rows.get(item.asset)
        if previous_observation is not None and previous_observation.record_id != item.record_id:
            raise ValueError(f"conflicting market observations for {item.asset} on {observed_day}")
        asset_rows[item.asset] = item

    dates = tuple(sorted(day for day, rows in by_day.items() if set(rows) == set(ASSETS)))
    if not dates:
        raise ValueError("no complete BTC/ETH/SOL market dates are available")
    for previous_day, current in zip(dates, dates[1:], strict=False):
        if current != previous_day + timedelta(days=1):
            raise ValueError(f"market dates are not contiguous: {previous_day} to {current}")

    prices = torch.tensor(
        [[float(by_day[day][asset].decimal_value or "0") for asset in ASSETS] for day in dates],
        dtype=torch.float64,
    )
    if not torch.isfinite(prices).all() or bool((prices <= 0).any()):
        raise ValueError("market prices must be finite and positive")
    record_ids = tuple(tuple(by_day[day][asset].record_id for asset in ASSETS) for day in dates)
    dataset_document = {
        "schema_version": 1,
        "assets": [asset.value for asset in ASSETS],
        "dates": [item.isoformat() for item in dates],
        "prices": [[str(by_day[day][asset].decimal_value) for asset in ASSETS] for day in dates],
        "observation_ids": record_ids,
    }
    return MarketHistory(
        dates=dates,
        prices=prices,
        observation_ids=record_ids,
        dataset_hash=hashlib.sha256(canonical_json_bytes(dataset_document)).hexdigest(),
    )


def fit_price_standardizer(history: MarketHistory, *, through_index: int) -> PriceStandardizer:
    if not 0 <= through_index < len(history.dates):
        raise ValueError("standardizer cutoff is outside the market history")
    values = torch.log(history.prices[: through_index + 1])
    mean = values.mean(dim=0)
    scale = values.std(dim=0, unbiased=False).clamp_min(1e-8)
    return PriceStandardizer(mean=mean, scale=scale, fitted_through=history.dates[through_index])


def trailing_volatility(prices: Tensor, *, origin_index: int, lookback: int) -> Tensor:
    if lookback < 2:
        raise ValueError("volatility lookback must be at least two days")
    if origin_index < lookback:
        raise ValueError("insufficient history for trailing volatility")
    window = prices[origin_index - lookback : origin_index + 1]
    returns = torch.log(window[1:] / window[:-1])
    return returns.std(dim=0, unbiased=False)


def build_market_sequences(
    history: MarketHistory,
    *,
    lookback: int,
    volatility_lookback: int,
    forecast_days: int = FORECAST_DAYS,
    minimum_origin_index: int | None = None,
) -> MarketSequences:
    if lookback < 2:
        raise ValueError("price lookback must be at least two days")
    if forecast_days != FORECAST_DAYS:
        raise ValueError("Phase 1 requires a seven-day forecast")
    first_origin = max(
        lookback - 1,
        volatility_lookback,
        minimum_origin_index if minimum_origin_index is not None else 0,
    )
    final_origin = len(history.dates) - forecast_days - 1
    if first_origin > final_origin:
        raise ValueError("market history is too short for the requested sequence")

    inputs: list[Tensor] = []
    targets: list[Tensor] = []
    origins: list[Tensor] = []
    volatilities: list[Tensor] = []
    origin_dates: list[date] = []
    target_dates: list[tuple[date, ...]] = []
    origin_indices: list[int] = []
    for origin in range(first_origin, final_origin + 1):
        inputs.append(history.prices[origin - lookback + 1 : origin + 1])
        targets.append(history.prices[origin + 1 : origin + forecast_days + 1])
        origins.append(history.prices[origin])
        volatilities.append(
            trailing_volatility(history.prices, origin_index=origin, lookback=volatility_lookback)
        )
        origin_dates.append(history.dates[origin])
        target_dates.append(tuple(history.dates[origin + 1 : origin + forecast_days + 1]))
        origin_indices.append(origin)
    return MarketSequences(
        inputs=torch.stack(inputs),
        targets=torch.stack(targets),
        origin_prices=torch.stack(origins),
        volatility=torch.stack(volatilities),
        origin_dates=tuple(origin_dates),
        target_dates=tuple(target_dates),
        origin_indices=torch.tensor(origin_indices, dtype=torch.long),
    )


def standardize_volatility(values: Tensor, train_indices: Tensor) -> tuple[Tensor, Tensor, Tensor]:
    training = values[train_indices]
    mean = training.mean(dim=0)
    scale = training.std(dim=0, unbiased=False).clamp_min(1e-8)
    return (values - mean) / scale, mean, scale


def predicted_returns(predicted_prices: Tensor, origin_prices: Tensor) -> tuple[Tensor, Tensor]:
    if predicted_prices.ndim != 3 or predicted_prices.shape[1:] != (FORECAST_DAYS, len(ASSETS)):
        raise ValueError("predicted prices must have shape [sample, 7, 3]")
    if origin_prices.shape != (predicted_prices.shape[0], len(ASSETS)):
        raise ValueError("origin prices must have shape [sample, 3]")
    previous = torch.cat((origin_prices.unsqueeze(1), predicted_prices[:, :-1]), dim=1)
    daily = predicted_prices / previous - 1.0
    cumulative = predicted_prices[:, -1] / origin_prices - 1.0
    if not torch.isfinite(daily).all() or not torch.isfinite(cumulative).all():
        raise ValueError("predicted returns must be finite")
    return daily, cumulative


def split_indices(
    sample_count: int,
    *,
    train_fraction: float = 0.70,
    validation_fraction: float = 0.10,
    embargo_days: int = FORECAST_DAYS,
) -> tuple[Tensor, Tensor, Tensor]:
    if sample_count < 100:
        raise ValueError("at least 100 samples are required")
    if not 0 < train_fraction < 1 or not 0 < validation_fraction < 1:
        raise ValueError("split fractions must be between zero and one")
    train_stop = math.floor(sample_count * train_fraction)
    validation_start = train_stop + embargo_days
    validation_count = math.floor(sample_count * validation_fraction)
    validation_stop = validation_start + validation_count
    test_start = validation_stop + embargo_days
    if test_start >= sample_count:
        raise ValueError("split leaves no untouched test samples")
    return (
        torch.arange(0, train_stop, dtype=torch.long),
        torch.arange(validation_start, validation_stop, dtype=torch.long),
        torch.arange(test_start, sample_count, dtype=torch.long),
    )

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from server.app.domain.crypto import CryptoAsset, canonical_decimal, utc_datetime

FORECAST_HORIZON_DAYS = 7
PHASE2_POLICY_VERSION = "phase2-mean-variance-cash-v2"


@dataclass(frozen=True)
class SevenDayAssetForecast:
    asset: CryptoAsset
    current_price: str
    predicted_prices: tuple[str, ...]
    predicted_daily_returns: tuple[str, ...]
    predicted_return_7d: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "current_price", _positive_decimal(self.current_price))
        if len(self.predicted_prices) != FORECAST_HORIZON_DAYS:
            raise ValueError("forecast must contain exactly seven predicted prices")
        if len(self.predicted_daily_returns) != FORECAST_HORIZON_DAYS:
            raise ValueError("forecast must contain exactly seven daily returns")
        object.__setattr__(
            self,
            "predicted_prices",
            tuple(_positive_decimal(value) for value in self.predicted_prices),
        )
        object.__setattr__(
            self,
            "predicted_daily_returns",
            tuple(canonical_decimal(value) for value in self.predicted_daily_returns),
        )
        object.__setattr__(self, "predicted_return_7d", canonical_decimal(self.predicted_return_7d))
        calculated = Decimal(self.predicted_prices[-1]) / Decimal(self.current_price) - Decimal(1)
        if abs(calculated - Decimal(self.predicted_return_7d)) > Decimal("0.00000002"):
            raise ValueError("seven-day return is inconsistent with the Day-7 price")


@dataclass(frozen=True)
class ForecastAccuracy:
    model_key: Literal["original-mspciformer", "vasa-mspciformer"]
    mape: str
    return_7d_mae: str
    directional_accuracy: str
    btc_day_7_mae_usd: str
    eth_day_7_mae_usd: str
    sol_day_7_mae_usd: str

    def __post_init__(self) -> None:
        for name in self.__dataclass_fields__:
            if name != "model_key":
                object.__setattr__(self, name, canonical_decimal(str(getattr(self, name))))


@dataclass(frozen=True)
class SevenDayForecast:
    run_id: str
    manifest_key: str
    model_key: Literal["original-mspciformer", "vasa-mspciformer"]
    model_name: str
    model_version: str
    generated_at_utc: datetime
    market_data_cutoff_utc: datetime
    forecast_dates_utc: tuple[date, ...]
    assets: tuple[SevenDayAssetForecast, ...]
    status: Literal["current", "stale"]
    stale_reasons: tuple[str, ...] = ()
    refreshed_from_checkpoint: bool = False
    quality_checks: dict[str, object] = field(default_factory=dict)
    accuracy: tuple[ForecastAccuracy, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "generated_at_utc", utc_datetime(self.generated_at_utc, field="generated_at_utc")
        )
        object.__setattr__(
            self,
            "market_data_cutoff_utc",
            utc_datetime(self.market_data_cutoff_utc, field="market_data_cutoff_utc"),
        )
        if (
            not self.run_id
            or not self.manifest_key
            or not self.model_name
            or not self.model_version
        ):
            raise ValueError("forecast provenance is incomplete")
        if len(self.forecast_dates_utc) != FORECAST_HORIZON_DAYS:
            raise ValueError("forecast must contain exactly seven UTC dates")
        expected_dates = tuple(
            self.market_data_cutoff_utc.date() + timedelta(days=offset)
            for offset in range(1, FORECAST_HORIZON_DAYS + 1)
        )
        if self.forecast_dates_utc != expected_dates:
            raise ValueError("forecast dates must immediately follow the market cutoff")
        if len(self.assets) != 3 or {item.asset for item in self.assets} != set(CryptoAsset):
            raise ValueError("forecast must contain exactly BTC, ETH, and SOL")
        if self.status == "current" and self.stale_reasons:
            raise ValueError("current forecast cannot contain stale reasons")
        if self.status == "stale" and not self.stale_reasons:
            raise ValueError("stale forecast must explain why it is stale")

    @property
    def snapshot_id(self) -> str:
        document = {
            "run_id": self.run_id,
            "model_key": self.model_key,
            "generated_at_utc": _utc(self.generated_at_utc),
            "market_data_cutoff_utc": _utc(self.market_data_cutoff_utc),
            "forecast_dates_utc": [value.isoformat() for value in self.forecast_dates_utc],
            "assets": [
                {
                    "asset": item.asset.value,
                    "current_price": item.current_price,
                    "predicted_prices": item.predicted_prices,
                    "predicted_daily_returns": item.predicted_daily_returns,
                    "predicted_return_7d": item.predicted_return_7d,
                }
                for item in self.assets
            ],
        }
        return hashlib.sha256(
            json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()


@dataclass(frozen=True)
class HistoricalPrice:
    asset: CryptoAsset
    observed_date_utc: date
    price_usd: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "price_usd", _positive_decimal(self.price_usd))


@dataclass(frozen=True)
class Phase2Allocation:
    asset: CryptoAsset
    weight: str
    amount_minor_units: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "weight", canonical_decimal(self.weight))
        if not Decimal(0) <= Decimal(self.weight) <= Decimal(1):
            raise ValueError("allocation weight must be between zero and one")
        if isinstance(self.amount_minor_units, bool) or self.amount_minor_units < 0:
            raise ValueError("allocation amount must be nonnegative integer cents")


@dataclass(frozen=True)
class CashReserve:
    """USD deliberately left outside the experimental crypto sleeve."""

    weight: str
    amount_minor_units: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "weight", canonical_decimal(self.weight))
        if not Decimal(0) <= Decimal(self.weight) <= Decimal(1):
            raise ValueError("cash reserve weight must be between zero and one")
        if isinstance(self.amount_minor_units, bool) or self.amount_minor_units < 0:
            raise ValueError("cash reserve amount must be nonnegative integer cents")


@dataclass(frozen=True)
class Phase2Recommendation:
    capital_minor_units: int
    forecast_snapshot_id: str
    forecast_status: Literal["current", "stale"]
    model_key: str
    model_version: str
    expected_returns_7d: tuple[tuple[CryptoAsset, str], ...]
    predicted_portfolio_return_7d: str
    estimated_portfolio_volatility_7d: str
    risk_aversion: str
    covariance_lookback_days: int
    covariance_estimator: Literal["Ledoit-Wolf"]
    covariance_repaired: bool
    solver: str
    solver_status: str
    policy_version: Literal["phase2-mean-variance-cash-v2"]
    allocations: tuple[Phase2Allocation, ...]
    cash_reserve: CashReserve
    warnings: tuple[str, ...]


def _positive_decimal(value: str) -> str:
    result = canonical_decimal(value)
    if Decimal(result) <= 0:
        raise ValueError("price must be positive")
    return result


def _utc(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")

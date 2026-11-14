from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Protocol

from ml.portfolio.phase2_optimizer import optimize_seven_day_portfolio
from server.app.domain.crypto import CryptoAsset
from server.app.domain.phase2_portfolio import (
    Phase2Recommendation,
    SevenDayForecast,
)
from server.app.infrastructure.phase1_forecast_repository import Phase1ForecastBundle

_MAX_MONEY = 9_000_000_000_000_000


class Phase2PortfolioRejected(ValueError):
    pass


class Phase1ForecastReader(Protocol):
    def latest_forecast(self) -> Phase1ForecastBundle: ...


@dataclass(frozen=True)
class Phase2PortfolioPolicy:
    risk_aversion: Decimal = Decimal("5.0")
    covariance_lookback_days: int = 365
    cash_return_7d: Decimal = Decimal("0")
    diversification_prior: str = "inverse-volatility"

    def __post_init__(self) -> None:
        if not self.risk_aversion.is_finite() or self.risk_aversion <= 0:
            raise ValueError("risk aversion must be positive")
        if self.covariance_lookback_days < 30:
            raise ValueError("covariance lookback must be at least 30 days")
        if not self.cash_return_7d.is_finite() or self.cash_return_7d != 0:
            raise ValueError("the USD cash reserve return must be zero for this policy")
        if self.diversification_prior != "inverse-volatility":
            raise ValueError("Phase 2 requires the inverse-volatility diversification prior")


DEFAULT_PHASE2_POLICY = Phase2PortfolioPolicy()


def load_phase2_policy(path: Path) -> Phase2PortfolioPolicy:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Phase 2 portfolio policy must be an object")
    if value.get("policy_version") != "phase2-model-informed-diversified-cash-v3":
        raise ValueError("unsupported Phase 2 portfolio policy version")
    if value.get("covariance_estimator") != "Ledoit-Wolf":
        raise ValueError("Phase 2 requires the Ledoit-Wolf covariance estimator")
    if value.get("covariance_horizon_days") != 7:
        raise ValueError("Phase 2 covariance horizon must be seven days")
    if Decimal(str(value.get("cash_return_7d"))) != 0:
        raise ValueError("Phase 2 cash reserve return must be zero")
    if value.get("diversification_prior") != "inverse-volatility":
        raise ValueError("Phase 2 requires the inverse-volatility diversification prior")
    return Phase2PortfolioPolicy(
        risk_aversion=Decimal(str(value["risk_aversion"])),
        covariance_lookback_days=int(str(value["covariance_lookback_days"])),
        cash_return_7d=Decimal(str(value["cash_return_7d"])),
        diversification_prior=str(value["diversification_prior"]),
    )


class Phase2PortfolioService:
    def __init__(
        self,
        forecasts: Phase1ForecastReader,
        *,
        policy: Phase2PortfolioPolicy = DEFAULT_PHASE2_POLICY,
    ) -> None:
        self._forecasts = forecasts
        self._policy = policy

    def forecast(self) -> SevenDayForecast:
        try:
            return self._forecasts.latest_forecast().forecast
        except (KeyError, RuntimeError, ValueError) as exc:
            raise Phase2PortfolioRejected(f"seven-day forecast is unavailable: {exc}") from exc

    def recommend(self, *, capital_minor_units: int) -> Phase2Recommendation:
        if isinstance(capital_minor_units, bool) or not 0 < capital_minor_units <= _MAX_MONEY:
            raise Phase2PortfolioRejected("investment capital must be positive integer USD cents")
        try:
            bundle = self._forecasts.latest_forecast()
            forecast = bundle.forecast
            expected = {item.asset: Decimal(item.predicted_return_7d) for item in forecast.assets}
            model_confidence = _model_confidence(forecast, expected)
            result = optimize_seven_day_portfolio(
                capital_minor_units=capital_minor_units,
                expected_returns=expected,
                price_history=bundle.price_history,
                risk_aversion=self._policy.risk_aversion,
                covariance_lookback_days=self._policy.covariance_lookback_days,
                model_confidence=model_confidence,
            )
        except (KeyError, RuntimeError, ValueError) as exc:
            raise Phase2PortfolioRejected(f"portfolio recommendation failed: {exc}") from exc

        warnings = [
            "Experimental research output: predicted returns are uncertain and are not "
            "guaranteed profits.",
            "This recommendation is informational only and does not execute trades or "
            "transfer assets.",
        ]
        warnings.extend(forecast.stale_reasons)
        if result.cash_reserve.amount_minor_units > 0:
            warnings.append(
                "USD cash reserve is deliberately left unallocated because the risk-adjusted "
                "crypto sleeve does not justify using all scenario capital."
            )
        warnings.append(
            "The crypto sleeve uses a "
            f"{(model_confidence * Decimal(100)).quantize(Decimal('0.01'))}% "
            "forecast-model tilt; its remaining weight follows an inverse-volatility "
            "BTC/ETH/SOL diversification prior."
        )
        if result.covariance_repaired:
            warnings.append(
                "The covariance matrix required a minimal positive-semidefinite numerical repair."
            )
        return Phase2Recommendation(
            capital_minor_units=capital_minor_units,
            forecast_snapshot_id=forecast.snapshot_id,
            forecast_status=forecast.status,
            model_key=forecast.model_key,
            model_version=forecast.model_version,
            expected_returns_7d=tuple(
                (asset, str(expected[asset])) for asset in sorted(expected, key=lambda x: x.value)
            ),
            predicted_portfolio_return_7d=result.predicted_return_7d,
            estimated_portfolio_volatility_7d=result.estimated_volatility_7d,
            risk_aversion=str(self._policy.risk_aversion),
            covariance_lookback_days=self._policy.covariance_lookback_days,
            covariance_estimator="Ledoit-Wolf",
            covariance_repaired=result.covariance_repaired,
            solver=result.solver,
            solver_status=result.solver_status,
            policy_version="phase2-model-informed-diversified-cash-v3",
            model_confidence=str(model_confidence),
            diversification_prior="inverse-volatility",
            allocations=result.allocations,
            cash_reserve=result.cash_reserve,
            warnings=tuple(warnings),
        )


def _model_confidence(
    forecast: SevenDayForecast, expected_returns: dict[CryptoAsset, Decimal]
) -> Decimal:
    """Calibrate the model tilt from selected-model held-out evidence."""

    selected = next(
        (item for item in forecast.accuracy if item.model_key == forecast.model_key), None
    )
    if selected is None:
        return Decimal(0)
    try:
        directional_accuracy = Decimal(selected.directional_accuracy)
        return_mae = Decimal(selected.return_7d_mae)
        strongest_signal = max(abs(value) for value in expected_returns.values())
    except (InvalidOperation, ValueError):
        return Decimal(0)
    if not directional_accuracy.is_finite() or not return_mae.is_finite() or return_mae <= 0:
        return Decimal(0)
    directional_skill = _unit_interval((directional_accuracy - Decimal("0.5")) / Decimal("0.5"))
    signal_to_error = _unit_interval(strongest_signal / return_mae)
    return (directional_skill * signal_to_error).sqrt()


def _unit_interval(value: Decimal) -> Decimal:
    return min(Decimal(1), max(Decimal(0), value))
